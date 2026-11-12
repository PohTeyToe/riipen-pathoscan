import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { makeRun, render } from '../src/lib/synth'

const secondsLeft = async (page: Page) => {
  const [m, s] = (await page.getByRole('timer').textContent())!.split(':').map(Number)
  return m * 60 + s
}

test('the field app installs its service worker, works offline and keeps a timer across a reload', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 52.13, longitude: -106.67, accuracy: 9 })
  await page.clock.install()

  await page.goto('/app.html')
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)

  // The precache holds the app and none of the demo.
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname)
    return urls
  })
  expect(cached.some((u) => u.startsWith('/app.html'))).toBe(true)
  expect(cached.filter((u) => u === '/' || u.startsWith('/index.html') || u.startsWith('/assets/index-'))).toEqual([])

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('No runs yet.')).toBeVisible()

  // New run
  await page.getByRole('link', { name: 'New run' }).click()
  const start = page.getByRole('button', { name: 'Start run' })
  await expect(start).toBeDisabled()
  await page.getByLabel('Field name').fill('North 40')
  await page.getByLabel('Notes').fill('Wet after rain')
  await page.getByRole('button', { name: 'Add location' }).click()
  await expect(page.getByText('52.13000, -106.67000 ±9 m')).toBeVisible()
  await start.click()

  // Step 1: a 20 minute timer
  await expect(page.getByRole('heading', { name: 'Pre-heat the PathoBox' })).toBeVisible()
  await expect(page.getByText('Step 1 of 8')).toBeVisible()
  await expect(page.getByText("Set your phone's alarm too.")).toBeVisible()
  await expect(page.getByRole('timer')).toHaveText('20:00')
  await page.getByRole('button', { name: 'Start timer' }).click()
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()

  // Moving the phone's clock an hour forward while the guide is open doesn't end the timer.
  await page.clock.setSystemTime(Date.now() + 60 * 60_000)
  await page.waitForTimeout(1500)
  await expect(page.getByRole('timer')).not.toHaveText("Time's up")
  expect(await secondsLeft(page)).toBeGreaterThan(19 * 60)
  await page.clock.setSystemTime(Date.now())

  // Five minutes later the tab is reloaded, still offline: the time left comes from the stored start.
  await page.clock.fastForward('05:00')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pre-heat the PathoBox' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start timer' })).toHaveCount(0)
  const left = await secondsLeft(page)
  expect(left).toBeGreaterThan(14 * 60)
  expect(left).toBeLessThanOrEqual(15 * 60)

  // Done moves to step 2; Back returns with the timer still running.
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Label the tubes' })).toBeVisible()
  await expect(page.getByText('Step 2 of 8')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Pre-heat the PathoBox' })).toBeVisible()
  expect(await secondsLeft(page)).toBeLessThanOrEqual(15 * 60)

  // The run is listed, in progress.
  await page.getByRole('link', { name: '‹ Runs' }).click()
  const item = page.getByRole('listitem').filter({ hasText: 'North 40' })
  await expect(item).toContainText('In progress')

  // The demo at / is not the service worker's: offline it fails, online it loads uncontrolled.
  await expect(page.goto('/')).rejects.toThrow()
  await context.setOffline(false)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()
  // The demo renders and responds: its headline, the hero run, and a Lab control that redraws the slider.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A weak positive control fools a midpoint rule.')
  await expect(page.getByRole('img', { name: /Synthetic run of ten tubes/ })).toBeVisible()
  const light = page.getByRole('group', { name: 'What to change' }).getByRole('button', { name: 'Light colour' })
  await light.click()
  await expect(light).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('label[for="lab-slider"]')).toContainText('Light colour')
  expect(errors).toEqual([])
})

/** A synthetic run from the demo's own renderer, as a camera file. Seed 4: two positives and one tube the reader holds. */
function syntheticPhoto() {
  const img = render(makeRun(4), 1)
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data.buffer)
  return { name: 'tubes.png', mimeType: 'image/png', buffer: PNG.sync.write(png) }
}

test('a run goes from the guide to a photo, rings, control taps and a saved result that opens offline', async ({ page, context }) => {
  await page.goto('/app.html')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await toPhoto(page, 'Synthetic')
  await page.locator('input[type=file]').setInputFiles(syntheticPhoto())
  await expect(page.getByRole('heading', { name: '10 tubes' })).toBeVisible()
  const rings = page.locator('.shot ellipse')
  // The photo takes the tap; a ring is only drawn on it.
  const centre = async (i: number) => {
    const b = (await rings.nth(i).boundingBox())!
    return [b.x + b.width / 2, b.y + b.height / 2] as const
  }
  const tapRing = async (i: number) => page.mouse.click(...(await centre(i)))
  const continueBtn = page.getByRole('button', { name: 'Continue' })
  await expect(continueBtn).toBeEnabled()

  // A tap on empty paper adds an eleventh ring and Continue locks; a tap on that ring removes it.
  const photo = (await page.locator('.shot svg').boundingBox())!
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height * 0.99)
  await expect(page.getByRole('heading', { name: '11 of 10 tubes' })).toBeVisible()
  await expect(continueBtn).toBeDisabled()
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height * 0.99)
  await expect(page.getByRole('heading', { name: '10 tubes' })).toBeVisible()
  await tapRing(4)
  await expect(page.getByRole('heading', { name: '9 of 10 tubes' })).toBeVisible()
  await expect(continueBtn).toBeDisabled()
  await page.reload() // the photo was saved: the rings come back as found
  await expect(page.getByRole('heading', { name: '10 tubes' })).toBeVisible()
  await continueBtn.click()

  await expect(page.getByRole('heading', { name: 'Tap the positive control' })).toBeVisible()
  await tapRing(0)
  await expect(page.getByRole('heading', { name: 'Tap the negative control' })).toBeVisible()
  await tapRing(1)

  // Two positives, one held tube: no advice until the grower calls it.
  await expect(page.getByRole('heading', { name: '2 of 8 positive' })).toBeVisible()
  await expect(page.getByText('Call the held tubes below.')).toBeVisible()
  const held = page.getByRole('listitem').filter({ hasText: 'Look again: yellow or pink?' })
  await expect(held).toHaveCount(1)
  await held.getByRole('button', { name: 'Yellow' }).click()
  await expect(page.getByRole('heading', { name: '3 of 8 positive' })).toBeVisible()
  await expect(page.getByText('Enough positives to treat.')).toBeVisible()
  await expect(page.getByText('1 of the 3 positives are your calls.')).toBeVisible()

  // Saved: a reload opens the same result, and so does the list, offline.
  await page.reload()
  await expect(page.getByRole('heading', { name: '3 of 8 positive' })).toBeVisible()
  await expect(held.getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'true')
  await context.setOffline(true)
  await page.goto('/app.html')
  await expect(page.getByRole('listitem').filter({ hasText: 'Synthetic' })).toContainText('Treat')
  await page.getByRole('link', { name: /Synthetic/ }).click()
  await expect(page.getByRole('heading', { name: '3 of 8 positive' })).toBeVisible()
  await expect(page.locator('.shot img')).toHaveJSProperty('complete', true)
  expect(await page.locator('.shot img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1000)
  await expect(rings).toHaveCount(10)
  await context.setOffline(false)
})

/** A new run, through the guide to the Photo screen. */
async function toPhoto(page: Page, field: string) {
  await page.getByRole('link', { name: 'New run' }).click()
  await page.getByLabel('Field name').fill(field)
  await page.getByRole('button', { name: 'Start run' }).click()
  for (let i = 1; i <= 8; i++) {
    await expect(page.getByText(`Step ${i} of 8`)).toBeVisible()
    if (await page.getByRole('button', { name: 'Start timer' }).isVisible()) await page.getByRole('button', { name: 'Start timer' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Take photo' })).toBeVisible()
}

/** Tab until `target` has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('not reachable with Tab')
}

test('with the keyboard alone, rings can be removed, the controls picked and the run read', async ({ page }) => {
  await page.goto('/app.html')
  await toPhoto(page, 'Keys')
  const camera = async () => {
    await tabTo(page, page.locator('input[type=file]'))
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press(' ') // Space opens a file input; Enter doesn't in Chromium
    await (await chooser).setFiles(syntheticPhoto())
  }
  await camera()
  await expect(page.getByRole('heading', { name: '10 tubes' })).toBeVisible()
  await expect(page.getByRole('group', { name: '10 rings' })).toHaveAccessibleDescription('Adding a ring needs a tap on the photo.')

  // Removing is a key press; adding back takes a tap, so a retake brings the ring back.
  await tabTo(page, page.getByRole('button', { name: 'Ring 3, tap to remove' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '9 of 10 tubes' })).toBeVisible()
  await camera()
  await expect(page.getByRole('heading', { name: '10 tubes' })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Continue' }))
  await page.keyboard.press('Enter')

  // A positive control in the middle of the row is refused; the end one is taken.
  await expect(page.getByRole('heading', { name: 'Tap the positive control' })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Tube 5' }))
  await page.keyboard.press(' ')
  await expect(page.getByText('Put the positive control at one end of the row.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tap the positive control' })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Tube 1', exact: true }))
  await page.keyboard.press(' ')
  await expect(page.getByRole('heading', { name: 'Tap the negative control' })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Tube 2', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '2 of 8 positive' })).toBeVisible()
})

// Runs last: it rebuilds dist under the running preview server.
test('a new version waits until the grower taps Reload, then takes over in every open tab', async ({ page, context }) => {
  await page.goto('/app.html')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
  const first = (await page.getByText(/^Build /).textContent())!
  await expect(page.getByText('New version ready.')).toHaveCount(0)
  const other = await context.newPage()
  await other.goto('/app.html')
  await expect(other.getByText(first)).toBeVisible()

  execSync('npx vite build', { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, APP_BUILD: 'e2e-next' }, stdio: 'ignore' })
  await page.reload() // the browser looks for a new sw.js on navigation

  await expect(page.getByText('New version ready.')).toBeVisible({ timeout: 20_000 })
  await expect(other.getByText('New version ready.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(first)).toBeVisible() // still the old version
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByText('Build e2e-next')).toBeVisible()
  await expect(page.getByText('New version ready.')).toHaveCount(0)

  // The other tab's new version already took over from the first tab; its Reload must still work.
  await other.getByRole('button', { name: 'Reload' }).click()
  await expect(other.getByText('Build e2e-next')).toBeVisible()
})
