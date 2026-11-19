// PLACEHOLDER TEXT: a first pass at plain step text, for Taha to correct against a real kit. His text
// and pictures replace these steps and the advice lines.
// treatAt and coolMin are defaults until Ethan answers open questions 1 and 2 (see app-spec.md).
// The pictures are our own drawings of generic kit. Swapping one is a change to its import line.

import type { Assay } from './assay'
import pick from './sclerotinia/pick.svg'
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
    // PROPOSAL: sent to Ethan on Nov 19 (open question 6), waiting for him to confirm how growers pick samples.
    {
      id: 'pick',
      title: 'Pick the samples',
      body: "Walk across the field in a W. Stop at 8 plants spread along the way, not all in one spot. Pick 4 petals from each plant. Keep each plant's petals apart. Each plant is one sample.",
      image: { src: pick, alt: 'A field with a W-shaped path across it and 8 plants spread along the path, numbered 1 to 8.' },
    },
    {
      id: 'preheat',
      title: 'Pre-heat the PathoBox',
      body: 'Turn the PathoBox on. Let it warm up for about 20 minutes.',
      image: { src: preheat, alt: 'A heat box warming up, next to a clock with 20 minutes marked.' },
      timerMin: 20,
    },
    {
      id: 'label',
      title: 'Label the tubes',
      body: 'Write 1 to 8 on 8 tubes, one number each. These are the sample tubes. Write POS on one more tube and NEG on another. You now have 10 tubes.',
      image: { src: label, alt: 'A marker labels ten tubes in a rack: POS, NEG, then 1 to 8.' },
    },
    {
      id: 'mix',
      title: 'Add the mixes',
      body: 'Add test mix to tubes 1 to 8. Add test mix to NEG too. Add positive mix to POS, and to no other tube.',
      image: { src: mix, alt: 'One dropper adds positive mix to the POS tube; another adds test mix to NEG and the tubes 1 to 8.' },
    },
    {
      id: 'crush',
      title: 'Crush the petals',
      body: 'Take the 4 petals from one plant. Crush them together. Do the same for each of the 8 plants.',
      image: { src: crush, alt: 'Four petals, then a finger and thumb pressing them flat.' },
    },
    {
      id: 'dip',
      title: 'Dip the dipstick',
      body: 'Dip the dipstick 15 times. Then dip it 5 times. Then dip it 15 more times.',
      image: { src: dip, alt: 'A dipstick dipped into a tube 15 times, then 5 times, then 15 times.' },
    },
    {
      id: 'oil',
      title: 'Add oil and run',
      body: 'Add oil to the tubes. Put the tubes in the PathoBox. Start the run. It takes 30 minutes.',
      image: { src: oil, alt: 'A dropper adds a drop of oil to a tube, then the tubes go down into the heat box.' },
      timerMin: 30,
    },
    {
      id: 'shade',
      title: 'Keep the tubes out of the sun',
      body: 'Keep the tubes in the shade, out of direct sun. Shade lights them evenly.',
      image: { src: shade, alt: 'A hand held over the tubes keeps the sun off them.' },
    },
    {
      id: 'cool',
      title: 'Cool the tubes',
      body: `Let the tubes cool to room temperature. That takes about ${coolMin} minutes.`,
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
