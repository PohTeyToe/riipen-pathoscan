// The page states facts about the runs it shows. These tests hold it to them.
import { describe, expect, it } from 'vitest'
import labels from '../data/real/labels.json'
import { always, flips, MID, PLACEMENTS, allPosPastPc, naiveAllEight } from './caseStudy'
import { STORY, storyFacts } from './components/Hero'
import { LAB_SEED } from './components/Lab'
import { apportion } from './components/Scoreboard'
import { firstReadable } from './components/Workbench'
import type { Labels } from './lib/real'
import { isWrong, readRun, type RunView } from './run'

const NEUTRAL = { kelvin: 5500, ev: 0, drift: 0 }
const names = (v: RunView, idx: number[]) => idx.map((i) => v.labels[i])
const samples = (v: RunView) => v.roles.flatMap((r, i) => (r === 'sample' ? [i] : []))

/** The story's rule: the midpoint rule makes two wrong calls, the calibrated reader none, and the control reads weaker than three samples. */
const storyRule = (v: RunView) => {
  const f = storyFacts(v)
  return f.midWrong.length === 2 && f.calWrong.length === 0 && f.brighter.length === 3 && f.weakFlag
}
/** The lab's rule: the eval's per-run averages, one held, no calibrated mistakes, one fixed-cut mistake, no flags. */
const labRule = (v: RunView) => {
  const s = samples(v)
  const held = s.filter((i) => v.calibrated.tubes[i].call === 'held').length
  const calWrong = s.filter((i) => isWrong('sample', v.calibrated.tubes[i].call, v.truth[i])).length
  const naiveWrong = s.filter((i) => isWrong('sample', v.naive.tubes[i].call, v.truth[i])).length
  return held === 1 && calWrong === 0 && naiveWrong === 1 && v.calibrated.flags.length === 0
}

describe('the story run in the hero', () => {
  const v = readRun(STORY.seed, STORY.scenario, NEUTRAL)
  const f = storyFacts(v)

  it('shows what the captions say', () => {
    expect(names(v, f.brighter)).toEqual(['1', '3', '5'])
    expect(names(v, f.midWrong)).toEqual(['4', '8'])
    expect(f.midWrong.every((i) => v.truth[i] === 'neg' && v.midpoint.tubes[i].call === 'pos')).toBe(true)
    expect(names(v, f.calHeld)).toEqual(['4', '8'])
    expect(f.calWrong).toEqual([])
    expect(v.calibrated.flags).toEqual(['The positive control is weaker than 3 samples. Check it before trusting the run.'])
  })

  it('has a fixed cut that gets every sample right, as on the case-study photo', () => {
    expect(samples(v).filter((i) => isWrong('sample', v.naive.tubes[i].call, v.truth[i]))).toEqual([])
  })

  it('is the first weak-control seed that matches the rule', { timeout: 120_000 }, () => {
    expect(storyRule(v)).toBe(true)
    for (let seed = 1; seed < STORY.seed; seed++) expect(storyRule(readRun(seed, STORY.scenario, NEUTRAL)), `seed ${seed}`).toBe(false)
  })
})

describe('the lab run', () => {
  it('is the first typical seed that matches the eval averages', () => {
    expect(labRule(readRun(LAB_SEED, 'typical', NEUTRAL))).toBe(true)
    for (let seed = 1; seed < LAB_SEED; seed++) expect(labRule(readRun(seed, 'typical', NEUTRAL)), `seed ${seed}`).toBe(false)
  })
})

describe('the case-study numbers', () => {
  it('match the README and the outreach', () => {
    expect(PLACEMENTS).toBe(27)
    expect(MID).toBeCloseTo(10.9, 1)
    expect(always).toEqual(['168', '169'])
    expect(flips('PS163')).toBe(12)
    expect(flips('PS164')).toBe(1)
    expect(allPosPastPc).toBe(27)
    expect(naiveAllEight).toBe(26)
  })
})

describe('the page', () => {
  it('opens the real photos on the first one with both controls on every assay', () => {
    const images = (labels as unknown as Labels).images
    expect(images[firstReadable(images)].file).toBe('LAMP3_Fig2_c_cv1-6.jpg')
  })

  it('splits the waffle squares in proportion and always fills the grid', () => {
    const cells = apportion([
      { key: 'neg', n: 8563 },
      { key: 'pos', n: 5328 },
      { key: 'held', n: 1621 },
      { key: 'wrong', n: 488 },
    ])
    expect(cells.reduce((a, c) => a + c.cells, 0)).toBe(1000)
    expect(cells.map((c) => c.cells)).toEqual([535, 333, 101, 31])
  })
})
