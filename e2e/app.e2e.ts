import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { liquidCentre, makeRun, render } from '../src/lib/synth'

const secondsLeft = async (page: Page) => {
  const [m, s] = (await page.getByRole('timer').textContent())!.split(':').map(Number)
  return m * 60 + s
}

test('the field app installs its service worker, works offline and keeps a timer across a reload', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 52.13, longitude: -106.67, accuracy: 9 })
  await page.clock.install()

  await page.goto('/app.html')
  await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Pre-heat the PathoBox', exact: true })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Pre-heat the PathoBox', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start timer' })).toHaveCount(0)
  const left = await secondsLeft(page)
  expect(left).toBeGreaterThan(14 * 60)
  expect(left).toBeLessThanOrEqual(15 * 60)

  // Done moves to step 2; Back returns with the timer still running.
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Label the tubes', exact: true })).toBeVisible()
  await expect(page.getByText('Step 2 of 8')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Pre-heat the PathoBox', exact: true })).toBeVisible()
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

type Pt = [number, number]

/**
 * A synthetic run from the demo's own renderer, as a camera file, laid out as a row, two rows of five, a row
 * tilted 12 degrees, or a small row on a big sheet (tubes 23 px apart, so a ring's button reaches over its
 * neighbours). Seed 4: two positives and one tube the reader holds. `tubes` are the liquid centres in the
 * photo, in label order: +, −, then 1 to 8.
 */
function syntheticPhoto(layout: 'row' | '2x5' | 'tilted' | 'small' = 'row') {
  const run = makeRun(4)
  const scale = layout === 'small' ? 0.24 : 1
  const img = render(run, scale)
  const [W, H] = [img.width, img.height]
  const src = new Uint32Array(img.data.buffer)
  const tubes = run.tubes.map((_, i) => [liquidCentre(run, i).x * scale, liquidCentre(run, i).y * scale] as Pt)
  // The output size, where each output pixel comes from in the render, and where a render point goes.
  let [w, h] = [W, H]
  let from = (p: Pt) => p
  let to = (p: Pt) => p
  if (layout === '2x5') {
    // The left five tubes above the right five.
    ;[w, h] = [W / 2, 2 * H]
    from = ([x, y]) => (y < H ? [x, y] : [x + W / 2, y - H])
    to = ([x, y]) => (x < W / 2 ? [x, y] : [x - W / 2, y + H])
  } else if (layout === 'tilted') {
    // Turned about its centre, on a canvas big enough to keep the corners.
    const [cos, sin] = [Math.cos(Math.PI / 15), Math.sin(Math.PI / 15)]
    ;[w, h] = [Math.ceil(W * cos + H * sin), Math.ceil(W * sin + H * cos)]
    from = ([x, y]) => [W / 2 + (x - w / 2) * cos + (y - h / 2) * sin, H / 2 - (x - w / 2) * sin + (y - h / 2) * cos]
    to = ([x, y]) => [w / 2 + (x - W / 2) * cos - (y - H / 2) * sin, h / 2 + (x - W / 2) * sin + (y - H / 2) * cos]
  } else if (layout === 'small') {
    // In the middle of a sheet as wide as the app keeps a photo.
    ;[w, h] = [1400, 588]
    const [ox, oy] = [Math.round((w - W) / 2), Math.round((h - H) / 2)]
    from = ([x, y]) => [x - ox, y - oy]
    to = ([x, y]) => [x + ox, y + oy]
  }
  const out = new Uint32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [sx, sy] = from([x, y]).map(Math.round)
      out[y * w + x] = sx >= 0 && sx < W && sy >= 0 && sy < H ? src[sy * W + sx] : src[0] // paper beyond the render
    }
  const png = new PNG({ width: w, height: h })
  png.data = Buffer.from(out.buffer)
  return { file: { name: 'tubes.png', mimeType: 'image/png', buffer: PNG.sync.write(png) }, size: [w, h] as Pt, tubes: tubes.map(to) }
}

/** A finger's tap on the photo, at a point in its pixels, scrolled into view first as a grower would. */
async function tapPhoto(page: Page, size: Pt, [x, y]: Pt) {
  const svg = page.locator('.shot svg')
  const box = (await svg.boundingBox())!
  // Playwright fails the click if anything else, such as a ring's button, would take the tap at that point.
  await svg.click({ position: { x: (x * box.width) / size[0], y: (y * box.height) / size[1] } })
}

/** Taps every tube in label order and goes on to the result. */
async function label(page: Page, photo: ReturnType<typeof syntheticPhoto>) {
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Tap the tubes in order: +, −, then 1 to 8.')).toBeVisible()
  for (const [i, tube] of photo.tubes.entries()) {
    await tapPhoto(page, photo.size, tube)
    await expect(page.getByRole('heading', { name: `${i + 1} of 10 labelled`, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Continue' }).click()
}

test('a run goes from the guide to a photo, rings, labels tapped in order and a saved result that opens offline', async ({ page, context }) => {
  await page.goto('/app.html')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await toPhoto(page, 'Synthetic')
  const photo = syntheticPhoto()
  await page.locator('input[type=file]').setInputFiles(photo.file)
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
  const rings = page.locator('.shot ellipse')
  const continueBtn = page.getByRole('button', { name: 'Continue' })
  await expect(continueBtn).toBeEnabled()

  // A tap on empty paper adds an eleventh ring and Continue locks; a tap on that ring removes it.
  const paper: Pt = [photo.size[0] / 2, photo.size[1] * 0.99]
  await tapPhoto(page, photo.size, paper)
  await expect(page.getByRole('heading', { name: '11 of 10 tubes', exact: true })).toBeVisible()
  await expect(continueBtn).toBeDisabled()
  await tapPhoto(page, photo.size, paper)
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
  await tapPhoto(page, photo.size, photo.tubes[4])
  await expect(continueBtn).toBeDisabled()
  await page.reload() // the photo was saved: the rings come back as found
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()

  // Each tap labels a tube at once; a wrong tap is undone by tapping it again, with every label after it.
  await continueBtn.click()
  await expect(page.getByRole('heading', { name: '0 of 10 labelled', exact: true })).toBeVisible()
  for (const i of [0, 1, 3]) await tapPhoto(page, photo.size, photo.tubes[i])
  await expect(page.getByRole('heading', { name: '3 of 10 labelled', exact: true })).toBeVisible()
  await expect(page.locator('.shot text').filter({ hasText: /./ })).toHaveText(['+', '−', '1'])
  await tapPhoto(page, photo.size, photo.tubes[1])
  await expect(page.getByRole('heading', { name: '1 of 10 labelled', exact: true })).toBeVisible()
  await expect(continueBtn).toBeDisabled()
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) await tapPhoto(page, photo.size, photo.tubes[i])
  await expect(continueBtn).toBeDisabled()
  await tapPhoto(page, photo.size, photo.tubes[9])
  await expect(page.locator('.shot text')).toHaveText(['+', '−', '1', '2', '3', '4', '5', '6', '7', '8'])
  await continueBtn.click()

  // Two positives, one held tube: no advice until the grower calls it.
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(page.getByText('Call the held tubes below.')).toBeVisible()
  const held = page.getByRole('listitem').filter({ hasText: 'Look again: yellow or pink?' })
  await expect(held).toHaveCount(1)
  await held.getByRole('button', { name: 'Yellow' }).click()
  await expect(page.getByRole('heading', { name: '3 of 8 positive', exact: true })).toBeVisible()
  await expect(page.getByText('Enough positives to treat.')).toBeVisible()
  await expect(page.getByText('1 of the 3 positives are your calls.')).toBeVisible()

  // Saved: a reload opens the same result, and so does the list, offline.
  await page.reload()
  await expect(page.getByRole('heading', { name: '3 of 8 positive', exact: true })).toBeVisible()
  await expect(held.getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'true')
  await context.setOffline(true)
  await page.goto('/app.html')
  await expect(page.getByRole('listitem').filter({ hasText: 'Synthetic' })).toContainText('Treat')
  await page.getByRole('link', { name: /Synthetic/ }).click()
  await expect(page.getByRole('heading', { name: '3 of 8 positive', exact: true })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()
}

/** Tab until `target` has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('not reachable with Tab')
}

test('with the keyboard alone, rings can be removed, the tubes labelled and the run read', async ({ page }) => {
  await page.goto('/app.html')
  await toPhoto(page, 'Keys')
  const camera = async () => {
    await tabTo(page, page.locator('input[type=file]'))
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press(' ') // Space opens a file input; Enter doesn't in Chromium
    await (await chooser).setFiles(syntheticPhoto().file)
  }
  await camera()
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: '10 rings' })).toHaveAccessibleDescription('Adding a ring needs a tap on the photo.')

  // An assistive tech click (detail 0, no position) removes that ring; it isn't a tap on the photo.
  await page.getByRole('button', { name: 'Ring 3, tap to remove' }).dispatchEvent('click')
  await expect(page.getByRole('heading', { name: '9 of 10 tubes', exact: true })).toBeVisible()
  await camera()
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()

  // Removing is a key press, and focus moves on to the next ring, or back to the one before after the last.
  const ring = (n: number) => page.getByRole('button', { name: `Ring ${n}, tap to remove` })
  await tabTo(page, ring(10))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '9 of 10 tubes', exact: true })).toBeVisible()
  await expect(ring(9)).toBeFocused()
  await page.keyboard.press(' ')
  await expect(page.getByRole('heading', { name: '8 of 10 tubes', exact: true })).toBeVisible()
  await expect(ring(8)).toBeFocused()
  await tabTo(page, ring(3))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '7 of 10 tubes', exact: true })).toBeVisible()
  await expect(ring(3)).toBeFocused() // the ring that was 4
  // Adding back takes a tap, so a retake brings the rings back.
  await camera()
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Continue' }))
  await page.keyboard.press('Enter')

  // Labelling: an assistive tech click labels that ring only, and a second one undoes it.
  await expect(page.getByRole('heading', { name: '0 of 10 labelled', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ring 4: tap to label +' }).dispatchEvent('click')
  await expect(page.getByRole('heading', { name: '1 of 10 labelled', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /labelled/ })).toHaveAccessibleName('Ring 4, labelled +: tap to undo')
  await page.getByRole('button', { name: 'Ring 4, labelled +: tap to undo' }).dispatchEvent('click')
  await expect(page.getByRole('heading', { name: '0 of 10 labelled', exact: true })).toBeVisible()

  // The synthetic row reads left to right as +, −, then 1 to 8: Enter or Space on rings 1 to 10 in turn.
  for (let n = 1; n <= 10; n++) {
    await tabTo(page, page.getByRole('button', { name: new RegExp(`^Ring ${n}: tap to label`) }))
    await page.keyboard.press(n % 2 ? 'Enter' : ' ')
    await expect(page.getByRole('heading', { name: `${n} of 10 labelled`, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Ring 2, labelled −: tap to undo' })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Continue' }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
})

test('two rows of five and a tilted row are labelled by taps in order and read', async ({ page }) => {
  await page.goto('/app.html')
  for (const layout of ['2x5', 'tilted'] as const) {
    await toPhoto(page, layout)
    const photo = syntheticPhoto(layout)
    await page.locator('input[type=file]').setInputFiles(photo.file)
    await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
    await label(page, photo)
    await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Done' }).click()
  }
})

test("a finger on a tube whose ring was removed adds it back, though a neighbour's ring button covers it", async ({ page }) => {
  await page.goto('/app.html')
  await toPhoto(page, 'Close tubes')
  const photo = syntheticPhoto('small')
  await page.locator('input[type=file]').setInputFiles(photo.file)
  const rings = page.locator('.shot ellipse')
  await expect(rings).not.toHaveCount(0)
  const n = await rings.count() // the finder misses some tubes this small; that's not what this tests
  // The point a finger hits on a ring, and whether a ring's button (an ellipse in its box) covers it.
  const centre = async (i: number) => {
    const b = (await rings.nth(i).boundingBox())!
    return [b.x + b.width / 2, b.y + b.height / 2] as const
  }
  const covered = async ([x, y]: readonly [number, number]) => {
    for (const b of await Promise.all((await page.locator('.hits button').all()).map((el) => el.boundingBox())))
      if (((x - b!.x - b!.width / 2) / (b!.width / 2)) ** 2 + ((y - b!.y - b!.height / 2) / (b!.height / 2)) ** 2 < 1) return true
    return false
  }
  // Both points first: a ring added back goes last, so the rings' order changes.
  for (const at of [await centre(3), await centre(6)]) {
    await page.mouse.click(...at)
    await expect(rings).toHaveCount(n - 1)
    expect(await covered(at)).toBe(true) // a neighbour's button reaches over the tube
    await page.mouse.click(...at)
    await expect(rings).toHaveCount(n)
  }
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
