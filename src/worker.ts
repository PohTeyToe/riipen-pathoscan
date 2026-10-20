// The live check: renders a batch of synthetic runs under the light and pH shift the sliders set, finds and
// measures every tube, and streams the measurements back. The page scores them with whatever reader and
// band are current, so moving the band or flipping the reader never re-renders.

import { LIVE, readSynthetic, scenarioFor } from './lib/evaluate'
import { makeRun, type Conditions } from './lib/synth'

let current = 0
self.onmessage = (e: MessageEvent<{ id: number; cond: Conditions }>) => {
  const { id, cond } = e.data
  current = id
  let i = 0
  const step = () => {
    if (current !== id) return
    const runs = []
    for (let k = 0; k < LIVE.chunk && i < LIVE.runs; k++, i++) {
      const seed = LIVE.firstSeed + i
      runs.push(readSynthetic(makeRun(seed, scenarioFor(seed), cond), LIVE.scale))
    }
    ;(self as unknown as Worker).postMessage({ id, runs, done: i >= LIVE.runs })
    if (i < LIVE.runs) setTimeout(step, 0)
  }
  step()
}
