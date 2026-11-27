import type { Assay } from './assay'
import { other } from './other'
import { sclerotinia } from './sclerotinia'

/** In the order New run offers them: the first is the default. */
export const assays: Record<string, Assay> = { sclerotinia, other }
