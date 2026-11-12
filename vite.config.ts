import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The field app (/app.html) works offline; the demo (/) stays a plain web page.
// vite-plugin-pwa only writes sw.js here. The manifest (public/app.webmanifest) and the
// registration (src/app/main.tsx) are ours, because the plugin would inject both into
// every HTML page, the demo included.

/** Shown on the Runs screen, so a tester can say which build they have. APP_BUILD overrides it (the e2e update test). */
function buildId(): string {
  if (process.env.APP_BUILD) return process.env.APP_BUILD
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

const BUILD = buildId()

/** Every built file app.html loads: its chunks, their CSS and the fonts that CSS uses. */
const appFiles = new Set<string>()
const appGraph: Plugin = {
  name: 'app-graph',
  apply: 'build',
  generateBundle(_, bundle) {
    appFiles.clear()
    const visit = (file: string) => {
      const chunk = bundle[file]
      if (appFiles.has(file) || chunk?.type !== 'chunk') return
      appFiles.add(file)
      chunk.viteMetadata?.importedCss.forEach((f) => appFiles.add(f))
      chunk.viteMetadata?.importedAssets.forEach((f) => appFiles.add(f))
      ;[...chunk.imports, ...chunk.dynamicImports].forEach(visit)
    }
    const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry && c.name === 'app')
    if (!entry) this.error('app-graph: no "app" entry chunk')
    visit(entry.fileName)
    // The build this service worker serves, so an open page can tell it's now older (src/app/update.ts).
    this.emitFile({ type: 'asset', fileName: 'app-version.json', source: JSON.stringify({ build: BUILD }) })
  },
}

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
  plugins: [
    react(),
    appGraph,
    VitePWA({
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ['app.html', 'app.webmanifest', 'app-version.json', 'app-icon-*.png', 'assets/*.{js,css,woff2}'],
        // Precache only what app.html loads, so the demo's chunks and fonts stay out.
        manifestTransforms: [async (entries) => ({ manifest: entries.filter((e) => !e.url.startsWith('assets/') || appFiles.has(e.url)), warnings: [] })],
        navigateFallback: '/app.html',
        navigateFallbackAllowlist: [/^\/app\.html/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rolldownOptions: {
      input: { index: 'index.html', app: 'app.html' },
    },
  },
  server: { port: 5102, strictPort: true },
  preview: { port: 5102, strictPort: true },
})
