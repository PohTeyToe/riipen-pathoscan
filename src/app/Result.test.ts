import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Features } from '../lib/find'
import { readCalibrated } from '../lib/readers'
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

/** A tube's measured colour at this Lab hue; `clipped` when the camera clipped it or the paper around it. */
const tube = (labHue: number, clipped = false): Features => {
  const rad = (labHue * Math.PI) / 180
  const lab = { L: 70, a: 40 * Math.cos(rad), b: 40 * Math.sin(rad) }
  return { raw: [200, 150, 80], rawHue: labHue, corrected: [0.8, 0.6, 0.3], lab, labHue, hueRange: [labHue, labHue], clipped, clear: 500, glare: 0, paperBeside: true }
}

/** The result screen's markup for a run read from these tubes and counted at treatAt. */
function markup(feats: (Features | null)[], treatAt = sclerotinia.treatAt): string {
  const read = readCalibrated(feats, ROLES, MODEL, BAND)
  const taps = Array(10).fill(null)
  const regions = ROLES.map(() => ({ x0: 0, y0: 0, x1: 9, y1: 9, cx: 5, cy: 5 }))
  const run: Run = { ...newRun(sclerotinia, { field: 'North 40', notes: '' }, 0, 'run-1'), read, roles: ROLES, regions, taps, ...tally(read, ROLES, taps, treatAt) }
  return renderToStaticMarkup(createElement(Result, { run, assay: sclerotinia, act: async () => {}, error: null })).replace(/&#x27;/g, "'")
}

/** The result screen's text. */
const screen = (feats: (Features | null)[], treatAt?: number) =>
  markup(feats, treatAt)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

/** The class of the paragraph that says `text`. */
const classOf = (html: string, text: RegExp) => new RegExp(`<p class="([^"]+)">${text.source}`).exec(html)?.[1]

describe('a failed run on the result screen', () => {
  const samples = Array.from({ length: 8 }, () => tube(40))
  it('says which control it could not find and asks for a retake, not fresh reagents', () => {
    const text = screen([tube(80), null, ...samples])
    expect(text).toContain('Run failed')
    expect(text).toContain("Can't find a negative control")
    expect(text).toContain('Retake the photo')
    expect(text).not.toContain('reagents')
  })
  it('asks for fresh reagents when the controls are too close', () => {
    const text = screen([tube(30), tube(20), ...samples])
    expect(text).toContain('too close to read against')
    expect(text).toContain('rerun with fresh reagents')
  })
})

describe('held tubes on the result screen', () => {
  it("shows each held tube's reason by it, and offers a retake when a reason asks for one", () => {
    const text = screen([tube(90), tube(10), tube(95), tube(50), tube(70, true), ...Array.from({ length: 5 }, () => tube(12))])
    expect(text).toContain('1 Positive')
    expect(text).toContain('2 Between the controls (')
    expect(text).toContain('3 Too bright here. Retake with less light. Look again: yellow or pink?')
    expect(text).toContain('Retake photo')
  })
  it('offers no retake when no reason asks for one', () => {
    const text = screen([tube(90), tube(10), tube(95), tube(50), ...Array.from({ length: 6 }, () => tube(12))])
    expect(text).toContain('Between the controls (')
    expect(text).not.toContain('Retake')
  })
  it('fails a run whose control is too bright, says so once, and offers a retake', () => {
    const text = screen([tube(90, true), tube(10), ...Array.from({ length: 8 }, () => tube(40))])
    expect(text).toContain('Run failed')
    expect(text.split('Too bright at the positive control. Retake with less light.')).toHaveLength(2)
    expect(text).toContain('Retake photo')
  })
})

describe('the lines above a read run', () => {
  // Sample 1 reads positive, but uneven light leaves its colour anywhere from the middle up: held, with a retake offered.
  const unsure = { ...tube(85), hueRange: [45, 85] as [number, number] }
  const negatives = Array.from({ length: 6 }, () => tube(12))
  it('offer a retake for tubes held only by the light plainly, not as a warning', () => {
    const html = markup([tube(90), tube(10), tube(95), unsure, ...negatives])
    expect(screen([tube(90), tube(10), tube(95), unsure, ...negatives])).toContain('1 of 8 positive Call the held tubes below.')
    expect(classOf(html, /1 tube was held only because this photo can't pin down its colour\. Retake/)).toBe('note')
    expect(html).toContain('Retake photo')
  })
  it('still warn about a weak positive control', () => {
    const html = markup([tube(60), tube(10), tube(95), unsure, ...negatives])
    expect(classOf(html, /The positive control is weaker than/)).toBe('alert')
  })
})

describe('a run saved under an older rule', () => {
  it('shows the outcome it was counted with, not a recount at the rule now', () => {
    const twoAndHeld = [tube(90), tube(10), tube(95), tube(95), tube(50), ...Array.from({ length: 5 }, () => tube(12))]
    expect(sclerotinia.treatAt).toBe(2)
    expect(screen(twoAndHeld)).toContain('2 of 8 positive Enough positives to treat.')
    expect(screen(twoAndHeld, 3)).toContain('2 of 8 positive Call the held tubes below.')
  })
})
