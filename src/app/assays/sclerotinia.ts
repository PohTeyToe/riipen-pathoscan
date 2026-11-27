// Guide copy follows the Sclerotinia Quick-Start Card, with field sampling and photo steps.
// Confirm the field sampling route and the cool-down reminder length with Ethan.
// The pictures are our own drawings of the kit. The PathoBox is drawn from the unit on the Quick-Start Card and in
// PathoScan's video, the same in every picture that shows it (assays.test.ts). Swapping one is a change to its import line.

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

// The Quick-Start Card calls for room temperature. This is a reminder interval: 5 minutes is a default until
// Ethan answers open question 2 (see app-spec.md).
const coolMin = 5

export const sclerotinia: Assay = {
  id: 'sclerotinia',
  name: 'Sclerotinia',
  tubes: 10,
  treatAt: 2, // Ethan's answer to open question 1 (Nov 24): treatment starts at two positives out of eight.
  coolMin,
  steps: [
    // PROPOSAL: sent to Ethan on Nov 19 (open question 6), not yet confirmed.
    {
      id: 'pick',
      title: 'Pick eight field samples',
      body: 'Choose one flowering canola plant at each of eight spots spread across the field. Collect four petals from each plant and keep them together as one numbered sample.',
      image: { src: pick, alt: 'Eight numbered flowering plants spread across a field.' },
    },
    {
      id: 'preheat',
      title: 'Warm up the PathoBox',
      body: "Turn on the PathoBox and start the 20-minute timer. Go on with the next steps while it warms up. Don't load it until its screen says it's ready.",
      image: { src: preheat, alt: 'The PathoBox warming up, with its blue screen, button and six-sided lid, next to a clock with 20 minutes marked.' },
      timerMin: 20,
    },
    {
      id: 'label',
      title: 'Label the reaction tubes',
      body: 'The reaction tubes are the ten tubes with a pink bead inside. Use the kit stickers to label two of them POS and NEG, and the other eight 1 to 8 to match your samples.',
      image: { src: label, alt: 'Stickers peeled off a sticker sheet label the ten tubes in the rack POS, NEG, and 1 to 8. Each tube has a pink bead.' },
    },
    {
      id: 'mix',
      title: 'Prepare the reaction tubes',
      body: 'Use the single-channel pipette from the kit to add Scl Test to tubes 1 to 8 and the NEG tube. Add Positive Test to the POS tube only.',
      image: { src: mix, alt: 'Positive Test goes in POS. Scl Test goes in NEG and tubes 1 to 8.' },
    },
    {
      id: 'crush',
      title: 'Crush the petals',
      body: 'Put four canola petals from one plant in its sample tube. Move the pestle up and down to crush them, then repeat for the other seven samples.',
      image: { src: crush, alt: 'Four petals go into the sample tube, and a pestle moves up and down to crush them.' },
    },
    {
      id: 'dip',
      title: 'Transfer each sample',
      body: 'For each sample, take a fresh dipstick. Dip it 15 times in the sample tube, 5 times in the wash tube, then 15 times in the reaction tube with the same number. Keep the tip off the bottom of the tubes, then throw the dipstick away.',
      image: { src: dip, alt: 'A dipstick dipped 15 times in the sample tube, 5 times in the wash tube, then 15 times in the reaction tube.' },
    },
    {
      id: 'oil',
      title: 'Run the test',
      body: "Add kit oil to all ten reaction tubes. When the PathoBox screen says it's ready, lift off the lid, put the tubes in, close the lid and press the button. Start the 30-minute timer.",
      image: { src: oil, alt: 'Oil goes into each reaction tube. The tubes go into the top of the PathoBox, the lid goes back on and the button is pressed.' },
      timerMin: 30,
    },
    {
      id: 'shade',
      title: 'Shade the tubes before the photo',
      body: 'When the 30 minutes are up, take the tubes out of the PathoBox. Lay all ten in a row on white paper, POS and NEG too, out of direct sun and in even shade.',
      image: { src: shade, alt: 'A hand keeps the sun off the tubes lying on white paper, labelled +, − and 1.' },
    },
    {
      id: 'cool',
      title: 'Cool the tubes',
      body: 'Let the tubes cool to room temperature before taking the photo. The timer is a reminder to check them. Yellow is positive, pink is negative.',
      image: { src: cool, alt: 'Yellow and pink tubes cooling on white paper: a thermometer going down, next to a clock.' },
      timerMin: coolMin,
    },
  ],
  advice: {
    treat: 'Enough positives to treat.',
    dontTreat: 'Too few positives to treat.',
    disclaimer: 'A guide, not a diagnosis.',
  },
}
