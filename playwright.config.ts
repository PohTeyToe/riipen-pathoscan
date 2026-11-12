import { defineConfig, devices } from '@playwright/test'

// Builds and serves the production bundle: the service worker only exists there.
// Its own port, so a running dev server on 5102 can't be picked up by mistake.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5112', ...devices['Pixel 7'] },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npm run build && npx vite preview --port 5112 --strictPort',
    url: 'http://localhost:5112/app.html',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
