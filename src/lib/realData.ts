// Browser side: the label file loads on its own chunk after the first paint. Scripts read it with fs.
import type { Labels } from './real'

export const loadLabels = (): Promise<Labels> => import('../../data/real/labels.json').then((m) => m.default as unknown as Labels)
