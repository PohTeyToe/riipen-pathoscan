import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assays } from '.'

describe('assay guides', () => {
  it.each(Object.values(assays))('$name has a picture with a description on every step', (assay) => {
    for (const step of assay.steps) {
      expect(step.image?.src, step.title).toBeTruthy()
      expect(step.image?.alt.length, step.title).toBeGreaterThan(20)
    }
    expect(new Set(assay.steps.map((s) => s.image?.src)).size).toBe(assay.steps.length)
  })
})

// The drawings in each assay's folder: small, self-contained, and still for reduced motion.
const dir = fileURLToPath(new URL('.', import.meta.url))
const drawings = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.svg'))

describe('step drawings', () => {
  it.each(drawings)('%s', (file) => {
    const svg = readFileSync(join(dir, file), 'utf8')
    expect(svg.length).toBeLessThan(6 * 1024)
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/) // nothing fetched from outside
    if (svg.includes('animation')) {
      expect(svg).toContain('@media (prefers-reduced-motion:reduce){*{animation:none!important}}')
      expect(svg).not.toContain('infinite')
    }
  })
})
