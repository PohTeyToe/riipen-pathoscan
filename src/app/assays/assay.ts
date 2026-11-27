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
  id: 'sclerotinia'
  name: string
  steps: Step[]
  /**
   * PathoScan's spray rule: treat at `treatAt` positives out of exactly `samples` samples. A run with another
   * number of samples gets no advice. A run keeps the treatAt it was read under, in its `rule`.
   */
  rule: { treatAt: number; samples: number }
  /** Minutes to cool before the photo. Open question 2 for Ethan. */
  coolMin: number
  advice: { treat: string; dontTreat: string; disclaimer: string }
}
