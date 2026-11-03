import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import evalData from '../data/eval.json'
import { discRegion, findRegions, measure } from '../src/lib/find'
import type { Band, Model } from '../src/lib/readers'
import { checkOutput, matchPoints, readGroups } from './batch'

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 })
const { model, band } = evalData.params as { model: Model; band: Band }

describe('matchPoints', () => {
  it('gives a region to the point inside it, whatever order the names come in', () => {
    const regions = [box(15, 35, 44, 64)]
    expect(matchPoints([[1, 50], [30, 50]], regions, 15)).toEqual([null, 0])
    expect(matchPoints([[30, 50], [1, 50]], regions, 15)).toEqual([0, null])
  })
  it('falls back to the nearest free region within reach', () => {
    expect(matchPoints([[50, 50]], [box(0, 0, 10, 10), box(55, 45, 65, 55)], 8)).toEqual([1])
    expect(matchPoints([[50, 50]], [box(0, 0, 10, 10)], 8)).toEqual([null])
  })
})

describe('readGroups', () => {
  // Three tubes on white: yellow (positive), pink (negative), and two samples of each.
  const w = 200
  const h = 40
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const colours = [[235, 180, 40], [225, 80, 120], [235, 175, 45], [225, 85, 120]]
  colours.forEach((c, k) => {
    for (let y = 10; y < 30; y++) for (let x = 20 + k * 45; x < 40 + k * 45; x++) data.set([...c, 255], (y * w + x) * 4)
  })
  const img = { width: w, height: h, data }
  const { paper } = findRegions(img)
  const feats = [0, 1, 2, 3].map((k) => measure(img, discRegion(30 + k * 45, 20, 8), paper))
  const names = ['pc', 'nc', 's1', 's2']

  it('lets two groups share their controls', () => {
    const two = readGroups(names, feats, [{ pc: ['pc'], nc: ['nc'], samples: ['s1'] }, { pc: ['pc'], nc: ['nc'], samples: ['s2'] }], model, band)
    const one = readGroups(names, feats, [{ pc: ['pc'], nc: ['nc'], samples: ['s1', 's2'] }], model, band)
    expect(two.tubes.map((t) => t?.call)).toEqual(one.tubes.map((t) => t?.call))
    expect(two.tubes[2]?.call).toBe('pos')
    expect(two.tubes[3]?.call).toBe('neg')
    expect(two.groups[0]).toEqual([1, 2])
    expect(two.flags).toEqual([])
  })
  it('refuses a tube that is a sample twice, or a control and a sample', () => {
    expect(() => readGroups(names, feats, [{ pc: ['pc'], nc: ['nc'], samples: ['s1'] }, { pc: ['pc'], nc: ['nc'], samples: ['s1'] }], model, band)).toThrow(/sample in two groups/)
    expect(() => readGroups(names, feats, [{ pc: ['pc'], nc: ['nc'], samples: ['s1'] }, { pc: ['s1'], nc: ['nc'], samples: ['s2'] }], model, band)).toThrow(/sample in one group and a pc in another/)
    expect(() => readGroups(names, feats, [{ pc: ['pc'], nc: ['nc'], samples: ['s1'] }, { pc: ['nc'], nc: ['pc'], samples: ['s2'] }], model, band)).toThrow(/tube nc is a nc in one group and a pc in another/)
    expect(() => readGroups(names, feats, [{ pc: ['pc'], nc: ['x'], samples: [] }], model, band)).toThrow(/unknown tube x/)
  })
})

describe('checkOutput', () => {
  const LONG = '\\\\?\\' // Windows' long-path prefix
  const repo = resolve(__dirname, '..')
  const tmp = mkdtempSync(join(tmpdir(), 'read-runs-'))
  const manifest = join(tmp, 'manifest.json')
  writeFileSync(manifest, '[]')
  it('accepts a new file outside the repo', () => {
    expect(() => checkOutput(manifest, join(tmp, 'out.json'), repo)).not.toThrow()
  })
  it('refuses the manifest itself, however it is spelled', () => {
    expect(() => checkOutput(manifest, manifest, repo)).toThrow(/is the manifest/)
    if (process.platform === 'win32') {
      expect(() => checkOutput(manifest, manifest.toUpperCase(), repo)).toThrow(/is the manifest/)
      expect(() => checkOutput(manifest, LONG + manifest, repo)).toThrow(/is the manifest/)
    }
  })
  it('refuses any path inside the repo', () => {
    expect(() => checkOutput(manifest, join(repo, 'out.json'), repo)).toThrow(/outside this repo/)
    expect(() => checkOutput(manifest, join(repo, '..review.json'), repo)).toThrow(/outside this repo/)
    if (process.platform === 'win32') expect(() => checkOutput(manifest, LONG + join(repo, 'review.json'), repo)).toThrow(/outside this repo/)
  })
  it('refuses a link that leads into the repo', () => {
    const link = join(tmp, 'demo-link')
    symlinkSync(repo, link, 'junction')
    expect(() => checkOutput(manifest, join(link, 'out.json'), repo)).toThrow(/outside this repo/)
  })
})
