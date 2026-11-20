import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readCalibrated } from '../lib/readers'
import type { Features } from '../lib/find'
import { sclerotinia } from './assays/sclerotinia'
import { BAND, MODEL, ROLES } from './reader'
import { Result, yourCalls } from './Result'
import { newRun, tally, type Run } from './run'

describe('the line on calls that decided a result', () => {
  it('agrees with one call and with many', () => {
    expect(yourCalls(1, 3)).toBe('1 of the 3 positives is your call.')
    expect(yourCalls(2, 3)).toBe('2 of the 3 positives are your calls.')
  })
})

/** A tube's measured colour at this Lab hue, read from the given white. */
const tube = (labHue: number, paperFrom: Features['paperFrom'] = 'local'): Features => {
  const rad = (labHue * Math.PI) / 180
  return { raw: [200, 150, 80], rawHue: labHue, corrected: [0.8, 0.6, 0.3], lab: { L: 70, a: 40 * Math.cos(rad), b: 40 * Math.sin(rad) }, labHue, clear: 500, glare: 0, paperFrom }
}

/** The result screen's text for a run read from these tubes. */
function screen(feats: Features[]): string {
  const read = readCalibrated(feats, ROLES, MODEL, BAND)
  const taps = Array(10).fill(null)
  const run: Run = { ...newRun(sclerotinia, { field: 'North 40', notes: '' }, 0, 'run-1'), read, roles: ROLES, regions: ROLES.map(() => ({ x0: 0, y0: 0, x1: 9, y1: 9, cx: 5, cy: 5 })), taps, ...tally(read, ROLES, taps, 3) }
  const html = renderToStaticMarkup(createElement(Result, { run, assay: sclerotinia, act: async () => {}, error: null }))
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
}

describe('a failed run on the result screen', () => {
  const samples = Array.from({ length: 8 }, () => tube(40))
  it('says a lamp spoiled the photo and asks for a retake in even light, not fresh reagents', () => {
    const text = screen([tube(80), tube(20, 'none'), ...samples])
    expect(text).toContain('Run failed')
    expect(text).toContain('retake it in even light')
    expect(text).not.toContain('reagents')
  })
  it('asks for fresh reagents when the controls are too close', () => {
    const text = screen([tube(30), tube(20), ...samples])
    expect(text).toContain('too close to read against')
    expect(text).toContain('rerun with fresh reagents')
  })
})
