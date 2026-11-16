// PLACEHOLDER TEXT: Taha's final step text and pictures replace these steps and the advice lines.
// treatAt and coolMin are defaults until Ethan answers open questions 1 and 2 (see app-spec.md).
// The pictures are our own drawings of generic kit. Swapping one is a change to its import line.

import type { Assay } from './assay'
import preheat from './sclerotinia/preheat.svg'
import label from './sclerotinia/label.svg'
import mix from './sclerotinia/mix.svg'
import crush from './sclerotinia/crush.svg'
import dip from './sclerotinia/dip.svg'
import oil from './sclerotinia/oil.svg'
import shade from './sclerotinia/shade.svg'
import cool from './sclerotinia/cool.svg'

const coolMin = 5

export const sclerotinia: Assay = {
  id: 'sclerotinia',
  name: 'Sclerotinia',
  tubes: 10,
  treatAt: 3,
  coolMin,
  steps: [
    {
      title: 'Pre-heat the PathoBox',
      body: 'Turn the PathoBox on and let it warm up.',
      image: { src: preheat, alt: 'A heat box warming up, next to a clock with 20 minutes marked.' },
      timerMin: 20,
    },
    {
      title: 'Label the tubes',
      body: 'Label the 8 sample tubes, POS and NEG.',
      image: { src: label, alt: 'A marker labels ten tubes in a rack: POS, NEG, then 1 to 8.' },
    },
    {
      title: 'Add the mixes',
      body: 'Add test mix to the 8 sample tubes and NEG, and positive mix to POS.',
      image: { src: mix, alt: 'One dropper adds positive mix to the POS tube; another adds test mix to NEG and the tubes 1 to 8.' },
    },
    {
      title: 'Crush the petals',
      body: 'Crush 4 petals for each sample.',
      image: { src: crush, alt: 'Four petals, then a finger and thumb pressing them flat.' },
    },
    {
      title: 'Dip the dipstick',
      body: 'Dip it 15 times, then 5 times, then 15 times.',
      image: { src: dip, alt: 'A dipstick dipped into a tube 15 times, then 5 times, then 15 times.' },
    },
    {
      title: 'Add oil and run',
      body: 'Add oil to the tubes and start the run in the PathoBox.',
      image: { src: oil, alt: 'A dropper adds a drop of oil to a tube, then the tubes go down into the heat box.' },
      timerMin: 30,
    },
    {
      title: 'Shade the tubes from direct sun',
      body: 'Keep the tubes in shade so the light falls evenly.',
      image: { src: shade, alt: 'A hand held over the tubes keeps the sun off them.' },
    },
    {
      title: 'Cool the tubes',
      body: 'Let the tubes cool to room temperature.',
      image: { src: cool, alt: 'The tubes cooling: a thermometer going down, next to a clock.' },
      timerMin: coolMin,
    },
  ],
  advice: {
    treat: 'Enough positives to treat.',
    dontTreat: 'Too few positives to treat.',
    disclaimer: 'A guide, not a diagnosis.',
  },
}
