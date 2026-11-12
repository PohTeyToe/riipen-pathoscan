// One file per pathogen in this folder. Adding one means a new file, not new code.

export interface Step {
  title: string
  body: string
  image?: string
  timerMin?: number
}

export interface Assay {
  id: 'sclerotinia'
  name: string
  tubes: 10
  steps: Step[]
  /** Positives needed for "treat". Open question 1 for Ethan. */
  treatAt: number
  /** Minutes to cool before the photo. Open question 2 for Ethan. */
  coolMin: number
  advice: { treat: string; dontTreat: string; disclaimer: string }
}
