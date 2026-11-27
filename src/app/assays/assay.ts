// One file per pathogen in this folder. Adding one means a new file, not new code.

export interface Step {
  /** Saved runs keep progress under this id: never change or reuse one. */
  id: string
  title: string
  body: string
  /** A picture of the step's action, and its description for screen readers. */
  image?: { src: string; alt: string }
  timerMin?: number
}

export interface Assay {
  /** Saved runs name their test by this id: never change or reuse one. */
  id: string
  /** The test as New run, the run list and the CSV name it. */
  name: string
  steps: Step[]
  /**
   * PathoScan's spray rule for this test, if it has given one: treat at `treatAt` positives out of exactly
   * `samples` samples, and what the result says either side. A test with no rule, or a run with another number
   * of samples, gets no advice. A run keeps the treatAt it was read under, in its `rule`.
   */
  rule?: { treatAt: number; samples: number; treat: string; dontTreat: string }
  /** Minutes to cool before the photo. Open question 2 for Ethan. */
  coolMin?: number
}
