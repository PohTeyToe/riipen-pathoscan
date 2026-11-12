// PLACEHOLDER TEXT: Taha's final step text and pictures replace these steps and the advice lines.
// treatAt and coolMin are defaults until Ethan answers open questions 1 and 2 (see app-spec.md).

import type { Assay } from './assay'

const coolMin = 5

export const sclerotinia: Assay = {
  id: 'sclerotinia',
  name: 'Sclerotinia',
  tubes: 10,
  treatAt: 3,
  coolMin,
  steps: [
    { title: 'Pre-heat the PathoBox', body: 'Turn the PathoBox on and let it warm up.', timerMin: 20 },
    { title: 'Label the tubes', body: 'Label the 8 sample tubes, POS and NEG.' },
    { title: 'Add the mixes', body: 'Add test mix to the 8 sample tubes and NEG, and positive mix to POS.' },
    { title: 'Crush the petals', body: 'Crush 4 petals for each sample.' },
    { title: 'Dip the dipstick', body: 'Dip it 15 times, then 5 times, then 15 times.' },
    { title: 'Add oil and run', body: 'Add oil to the tubes and start the run in the PathoBox.', timerMin: 30 },
    { title: 'Shade the tubes from direct sun', body: 'Keep the tubes in shade so the light falls evenly.' },
    { title: 'Cool the tubes', body: 'Let the tubes cool to room temperature.', timerMin: coolMin },
  ],
  advice: {
    treat: 'Enough positives to treat.',
    dontTreat: 'Too few positives to treat.',
    disclaimer: 'A guide, not a diagnosis.',
  },
}
