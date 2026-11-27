import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assays } from '.'

describe('assay guides', () => {
  it.each(Object.values(assays))('$name has a picture with a description on every step', (assay) => {
    for (const step of assay.steps) {
      expect(step.image?.src, step.title).toBeTruthy()
      expect(step.image?.alt.length, step.title).toBeGreaterThan(20)
    }
    expect(new Set(assay.steps.map((s) => s.image?.src)).size).toBe(assay.steps.length)
  })
})

// The drawings in each assay's folder: small, self-contained, and gentle.
const dir = fileURLToPath(new URL('.', import.meta.url))
const drawings = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg'))

/** Seconds until every animation in the drawing has stopped: the longest run plus the longest extra delay. */
function motionEnds(svg: string): number {
  const seconds = (t: string) => parseFloat(t) * (t.endsWith('ms') ? 0.001 : 1)
  const runs = [...svg.matchAll(/animation:([^;}!]+)/g)].map(([, value]) => {
    const words = value.trim().split(/\s+/)
    const [duration = 0, delay = 0] = words.filter((w) => /^[\d.]+m?s$/.test(w)).map(seconds)
    const count = words.includes('infinite') ? Infinity : Number(words.find((w) => /^[\d.]+$/.test(w)) ?? 1)
    return duration * count + delay
  })
  const delays = [...svg.matchAll(/animation-delay:([\d.]+m?s)/g)].map(([, t]) => seconds(t))
  return Math.max(0, ...runs) + Math.max(0, ...delays)
}

describe('step drawings', () => {
  it.each(drawings)('%s', (file) => {
    const svg = readFileSync(join(dir, file), 'utf8')
    expect(svg.length).toBeLessThan(6 * 1024)
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/) // nothing fetched from outside
    expect(motionEnds(svg)).toBeLessThanOrEqual(5)
  })

  it('draws the PathoBox the same way in every picture that shows it', () => {
    const boxes = new Map<string, string>()
    for (const file of drawings) {
      const box = readFileSync(join(dir, file), 'utf8').match(/<g id="box"[\s\S]*?<!--\/box-->/)?.[0]
      if (box) boxes.set(basename(file), box)
    }
    expect([...boxes.keys()].sort()).toEqual(['oil.svg', 'preheat.svg'])
    expect(new Set(boxes.values()).size).toBe(1)
  })

  it('counts every animation, its repeats and its delays', () => {
    expect(motionEnds('<style>.a{animation:x 1.2s ease-in 3}.a+.a{animation-delay:.6s}</style>')).toBeCloseTo(4.2)
    expect(motionEnds('<style>.a{animation:x 500ms linear 2 1s}</style>')).toBe(2)
    expect(motionEnds('<style>.a{animation:x 1s infinite}</style>')).toBe(Infinity)
    expect(motionEnds('<style>.a{animation:x 2s}</style>')).toBe(2)
    expect(motionEnds('<svg/>')).toBe(0)
  })
})
