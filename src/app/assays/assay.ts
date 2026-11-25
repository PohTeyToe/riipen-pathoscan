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
  tubes: 10
  steps: Step[]
  /** Positives needed for "treat". A saved run keeps the one it was last counted under, in its `rule`. */
  treatAt: number
  /** Minutes to cool before the photo. Open question 2 for Ethan. */
  coolMin: number
  advice: { treat: string; dontTreat: string; disclaimer: string }
}
