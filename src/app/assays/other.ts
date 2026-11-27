import type { Assay } from './assay'

// A PathoBox test this app has no guide or spray rule for. The run goes straight to the photo, and the tubes are
// read the same way, with the count and the calls but no advice.
export const other: Assay = { id: 'other', name: 'Another PathoBox test', steps: [] }
