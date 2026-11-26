import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { darken as darkenBy, makeRun, photograph, type Conditions, type Img, type Lamp, type Layout } from '../src/lib/synth'

// run.ts imports package.json, which this runner can't load, so its reader version is read from the source.
const READER_VERSION = readFileSync(new URL('../src/app/run.ts', import.meta.url), 'utf8').match(/READER_VERSION = '([^']+)'/)![1]

const secondsLeft = async (page: Page) => {
  const [m, s] = (await page.getByRole('timer').textContent())!.split(':').map(Number)
  return m * 60 + s
}

/** The paths the service worker has cached. */
function precached(page: Page) {
  return page.evaluate(async () => {
    const paths: string[] = []
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) paths.push(new URL(req.url).pathname)
    return paths
  })
}

test('the field app installs its service worker, works offline and keeps a timer across a reload', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 52.13, longitude: -106.67, accuracy: 9 })
  await page.clock.install()

  await page.goto('/app.html')
  await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)

  // The precache holds the app and none of the demo.
  const cached = await precached(page)
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

  // Step 1 has no timer; step 2 has a 20 minute one.
  await expect(page.getByRole('heading', { name: 'Pick eight field samples', exact: true })).toBeVisible()
  await expect(page.getByText('Step 1 of 9')).toBeVisible()
  await expect(page.getByRole('timer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Warm up the PathoBox', exact: true })).toBeVisible()
  await expect(page.getByText('Step 2 of 9')).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'Warm up the PathoBox', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start timer' })).toHaveCount(0)
  const left = await secondsLeft(page)
  expect(left).toBeGreaterThan(14 * 60)
  expect(left).toBeLessThanOrEqual(15 * 60)

  // Done moves to step 3; Back returns with the timer still running.
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Label the reaction tubes', exact: true })).toBeVisible()
  await expect(page.getByText('Step 3 of 9')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Warm up the PathoBox', exact: true })).toBeVisible()
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
 * neighbours). Seed 0: two positives and one tube the reader holds, the paper short of clipping. `tubes` are
 * the liquid centres in the photo, in label order: +, −, then 1 to 8. `cond` pins the run's light as makeRun
 * does; `lamp`: a lamp of that colour temperature at one edge of the photo (`from`, the left by default),
 * fading to daylight at the far edge, or with 0 a plain shade, 15% darker there; `ev`: stops added to the
 * run's exposure; `darken`: stops the photo is darkened by after the camera clipped it. All as
 * scripts/lamp-sweep.ts makes them (synth.ts photograph and darken). `edit` changes the camera's pixels. `above`:
 * rows of paper added above the tubes, for a photo taller than the layout's own.
 */
function syntheticPhoto(
  layout: Layout = 'row',
  {
    seed = 0,
    cond,
    lamp,
    from = 'left',
    ev = 0,
    darken = 0,
    edit,
    above = 0,
  }: { seed?: number; cond?: Conditions; lamp?: number; from?: Lamp['from']; ev?: number; darken?: number; edit?: (img: Img, tubes: Pt[]) => void; above?: number } = {},
) {
  const run = makeRun(seed, 'typical', cond)
  run.ev += ev
  const shot = photograph(run, layout, lamp === undefined ? undefined : { kelvin: lamp, from })
  let img = darken ? darkenBy(shot.img, darken) : shot.img
  let tubes = shot.tubes
  if (above) {
    const data = new Uint32Array(img.width * (img.height + above)).fill(new Uint32Array(img.data.buffer)[0])
    data.set(new Uint32Array(img.data.buffer), img.width * above)
    img = { width: img.width, height: img.height + above, data: new Uint8ClampedArray(data.buffer) }
    tubes = tubes.map(([x, y]) => [x, y + above])
  }
  edit?.(img, tubes)
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data.buffer)
  return { file: { name: 'tubes.png', mimeType: 'image/png', buffer: PNG.sync.write(png) }, size: [img.width, img.height] as Pt, tubes, run }
}

/** The exported CSV, downloaded: its rows by column name. */
async function exportCsv(page: Page) {
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }))
  const downloaded = page.waitForEvent('download')
  await arm(page)
  await page.getByRole('button', { name: 'Export' }).click()
  const csv = readFileSync((await (await downloaded).path())!, 'utf8')
  const [head, ...rows] = csv.slice(1).trimEnd().split('\r\n').map((line) => line.split(','))
  return (name: string) => rows.map((r) => r[head.indexOf(name)])
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
  const photo = syntheticPhoto('row', { seed: 12 }) // one positive and one held tube: the grower's call decides the run
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

  // One positive, one held tube: no advice until the grower calls it.
  await expect(page.getByRole('heading', { name: '1 of 8 positive', exact: true })).toBeVisible()
  await expect(page.getByText('Call the held tubes below.')).toBeVisible()
  const held = page.getByRole('listitem').filter({ hasText: 'Look again: yellow or pink?' })
  await expect(held).toHaveCount(1)
  await held.getByRole('button', { name: 'Yellow' }).click()
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(page.getByText('Enough positives to treat.')).toBeVisible()
  await expect(page.getByText('1 of the 2 positives is your call.')).toBeVisible()

  // Saved: a reload opens the same result, and so does the list, offline.
  await page.reload()
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(held.getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'true')
  await context.setOffline(true)
  await page.goto('/app.html')
  await expect(page.getByRole('listitem').filter({ hasText: 'Synthetic' })).toContainText('Treat')
  await page.getByRole('link', { name: /Synthetic/ }).click()
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(page.locator('.shot img')).toHaveJSProperty('complete', true)
  expect(await page.locator('.shot img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1000)
  await expect(rings).toHaveCount(10)

  // Export, still offline. With no file sharing it downloads: a BOM, a header and one row per tube.
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }))
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloaded
  const bytes = readFileSync((await download.path())!)
  const csv = bytes.toString('utf8')
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  const [head, ...rows] = csv.slice(1).trimEnd().split('\r\n').map((line) => line.split(','))
  const column = (name: string) => rows.map((r) => r[head.indexOf(name)])
  expect(column('Tube')).toEqual(['POS', 'NEG', '1', '2', '3', '4', '5', '6', '7', '8'])
  for (const [name, value] of [['Field', 'Synthetic'], ['Result', 'Treat'], ['Positives', '2'], ['Samples', '8'], ['Treat at', '2']])
    expect(column(name)).toEqual(Array(10).fill(value))
  // The held tube is the grower's Yellow, and it counts.
  expect(column('Reader call').filter((c) => c === 'Held')).toHaveLength(1)
  expect(column('Grower call').filter(Boolean)).toEqual(['Positive'])
  expect(column('Final call').filter((c) => c === 'Positive')).toHaveLength(3) // the positive control and 2 samples
  expect(download.suggestedFilename()).toBe(`pathoscan-synthetic-${column('Date')[0]}.csv`)

  // Where the phone can share files, Export shares the same file instead.
  await page.evaluate(() => {
    const shared = ((window as unknown as { shared: unknown }).shared = [] as { name: string; type: string; bytes: number[] }[])
    Object.defineProperty(navigator, 'canShare', { value: ({ files }: ShareData) => files?.length === 1 })
    Object.defineProperty(navigator, 'share', {
      value: async ({ files }: ShareData) => shared.push({ name: files![0].name, type: files![0].type, bytes: [...new Uint8Array(await files![0].arrayBuffer())] }),
    })
  })
  await page.getByRole('button', { name: 'Export' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([{ name: download.suggestedFilename(), type: 'text/csv', bytes: [...bytes] }])
  await context.setOffline(false)
})

/** Steps in the Sclerotinia guide. */
const steps = 9

/** A new run, on its first guide step, with a fake clock on the page (in step with real time until arm moves it). */
async function newRun(page: Page, field: string) {
  await page.clock.install()
  await page.getByRole('link', { name: 'New run' }).click()
  await page.getByLabel('Field name').fill(field)
  await page.getByRole('button', { name: 'Start run' }).click()
  await expect(page.getByText(`Step 1 of ${steps}`)).toBeVisible()
}

/**
 * Moves the page's clock on past the wait before a new screen's buttons take a tap (useArmed in ui.tsx: two frames,
 * then a second), so a test doesn't spend real seconds on it.
 */
const arm = (page: Page) => page.clock.runFor(1100)

/** A new run, through the guide to the Photo screen. Each step shows its own picture, loaded, and fits the screen. Returns the pictures. */
async function toPhoto(page: Page, field: string) {
  await newRun(page, field)
  const pictures = new Set<string>()
  for (let i = 1; i <= steps; i++) {
    await expect(page.getByText(`Step ${i} of ${steps}`)).toBeVisible()
    const picture = page.getByRole('main').getByRole('img')
    await expect(picture).toHaveAccessibleName(/\w+ \w+ \w+/)
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)
    pictures.add(await picture.evaluate((img: HTMLImageElement) => img.src))
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0)
    await arm(page)
    if (await page.getByRole('button', { name: 'Start timer' }).isVisible()) {
      await page.getByRole('button', { name: 'Start timer' }).click()
      await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
      await arm(page)
    }
    await page.getByRole('button', { name: 'Done' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()
  await arm(page)
  await expect(page.locator('input[type=file]')).toBeEnabled()
  expect(pictures.size).toBe(steps)
  return pictures
}

test('offline on a 360 x 740 phone, every guide step shows its picture with no scrolling', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/app.html')
  await page.evaluate(() => navigator.serviceWorker.ready)
  const cached = await precached(page)
  await context.setOffline(true)
  await page.reload()
  // Each picture is its own file, as a photo swapped in would be, and came from the precache.
  for (const src of await toPhoto(page, 'Pictures')) expect(cached).toContain(new URL(src).pathname)
})

/**
 * A finger's two taps on the middle of `target`, `ms` apart on the page's paused clock. The second comes once
 * `opened`, the screen the first tap opens, is on show.
 */
async function doubleTap(page: Page, target: Locator, ms: number, opened: Locator) {
  const box = (await target.boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.touchscreen.tap(x, y)
  await expect(opened).toBeVisible()
  await page.clock.runFor(ms)
  await page.touchscreen.tap(x, y)
}

/** Stops the page's clock: from here on, time passes only by runFor. */
const pauseClock = async (page: Page) => page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)

/** The steps the run has finished, once any write a tap started is stored. */
async function finished(page: Page) {
  const run = (await storedRun(page, runId(page))) as { steps: Record<string, { done?: boolean }> }
  return Object.keys(run.steps).filter((s) => run.steps[s].done)
}

test('the second tap of a double tap, even a slow one, never acts on the screen its first tap opened', async ({ page }) => {
  await page.goto('/app.html')
  await pauseClock(page)
  const done = page.getByRole('button', { name: 'Done' })
  const start = page.getByRole('button', { name: 'Start timer' })
  const step = (i: number) => page.getByText(`Step ${i} of ${steps}`)
  // Each second tap lands on the main button of the screen the first one opened. A button that took it would
  // have written by the time the next one is armed.
  await page.getByRole('link', { name: 'New run' }).click()
  await page.getByLabel('Field name').fill('Double tap')
  await doubleTap(page, page.getByRole('button', { name: 'Start run' }), 700, step(1))
  await arm(page)
  expect(await finished(page)).toEqual([])
  await doubleTap(page, done, 120, step(2))
  await arm(page)
  await expect(page.getByRole('timer')).toHaveText('20:00') // not started
  await doubleTap(page, start, 350, done)
  await arm(page)
  expect(await finished(page)).toEqual(['pick'])
  await doubleTap(page, done, 700, step(3))
  await arm(page)
  await doubleTap(page, done, 950, step(4))
  await arm(page)
  await expect(step(4)).toBeVisible()
  expect(await finished(page)).toEqual(['pick', 'preheat', 'label'])

  // The last step's Done, then Take photo: the camera doesn't open.
  for (let i = 4; i < steps; i++) {
    if (await start.isVisible()) {
      await start.click()
      await expect(done).toBeVisible()
      await arm(page)
    }
    await done.click()
    await expect(step(i + 1)).toBeVisible()
    await arm(page)
  }
  await start.click()
  await expect(done).toBeVisible()
  await arm(page)
  let chooser = false
  page.on('filechooser', () => (chooser = true))
  await doubleTap(page, done, 700, page.getByRole('heading', { name: 'Take photo', exact: true }))
  await arm(page)
  expect(chooser).toBe(false)
  expect(await finished(page)).toHaveLength(steps)

  // Continue on the labelled photo, then Done on the result: the result stays on show.
  const photo = syntheticPhoto()
  await page.locator('input[type=file]').setInputFiles(photo.file)
  await page.getByRole('button', { name: 'Continue' }).click()
  for (const tube of photo.tubes) await tapPhoto(page, photo.size, tube)
  const result = page.getByRole('heading', { name: '2 of 8 positive', exact: true })
  await doubleTap(page, page.getByRole('button', { name: 'Continue' }), 700, result)
  // Until it is armed, Done is no link at all, so a middle click can't follow it either.
  await expect(page.getByRole('link', { name: 'Done' })).toHaveCount(0)
  await arm(page)
  await expect(page.getByRole('link', { name: 'Done' })).toHaveCount(1)
  await expect(result).toBeVisible()
  expect(page.url()).toContain('#/run/')
})

/** Shows or hides the page, as switching apps or tabs does. Headless, a page is always in view, so its state is set here. */
const setVisible = (page: Page, visible: boolean) =>
  page.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', { value: visible ? 'visible' : 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visible)

test('a new step takes no tap until it has been in view for a second, whether the page was hidden before it was drawn or after', async ({ page }) => {
  await page.goto('/app.html')
  await newRun(page, 'Hidden')
  await pauseClock(page)
  await arm(page)
  const start = page.getByRole('button', { name: 'Start timer' })
  const done = page.getByRole('button', { name: 'Done' })

  // Hidden before step 2 is drawn: time hidden counts for nothing.
  await setVisible(page, false)
  await done.click()
  await expect(page.getByText(`Step 2 of ${steps}`)).toBeVisible()
  await page.clock.runFor(10_000)
  await expect(start).toBeDisabled()
  await setVisible(page, true)
  await page.clock.runFor(900)
  await expect(start).toBeDisabled()
  await page.clock.runFor(200)
  await expect(start).toBeEnabled()

  // Hidden 600 ms into Done's wait: back in view, the wait starts again.
  await start.click()
  await expect(done).toBeVisible()
  await page.clock.runFor(600)
  await setVisible(page, false)
  await page.clock.runFor(10_000)
  await expect(done).toBeDisabled()
  await setVisible(page, true)
  await page.clock.runFor(900)
  await expect(done).toBeDisabled()
  await page.clock.runFor(200)
  await expect(done).toBeEnabled()
})

/** The middle of the ring nearest the point `at` in the photo, on screen. */
async function ringCentre(page: Page, at: Pt) {
  const rings = await page.locator('.shot ellipse').all()
  const near = await Promise.all(rings.map(async (r) => Math.hypot(Number(await r.getAttribute('cx')) - at[0], Number(await r.getAttribute('cy')) - at[1])))
  const box = (await rings[near.indexOf(Math.min(...near))].boundingBox())!
  return [box.x + box.width / 2, box.y + box.height / 2] as Pt
}

test('on a 390 x 844 phone, a tall photo is as wide as the screen, and scrolled to its end the last tube is clear of the actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app.html')
  await toPhoto(page, 'Tall photo')
  const photo = syntheticPhoto('2x5', { above: 150 }) // 500 x 990: the tubes low in a photo taller than 9:16
  await page.locator('input[type=file]').setInputFiles(photo.file)
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
  expect((await page.locator('.shot svg').boundingBox())!.width).toBe(390)
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  const [x, y] = await ringCentre(page, photo.tubes[9])
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.shot'), [x, y])).toBe(true)
  await label(page, photo)
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
})

// A laptop, as shared on a call for a demo. Its own browser settings: not a phone.
const { defaultBrowserType: _, ...laptop } = devices['Desktop Chrome']
test.describe('on a 1280 x 720 laptop', () => {
  test.use(laptop)

  test('timer steps fit the screen, the photo takes its height beside the actions, the result shows the held tube beside the photo, and Export downloads', async ({ page }) => {
    await page.goto('/app.html')
    await toPhoto(page, 'Laptop') // every step, timer steps 2, 7 and 9 too, with no scrolling
    const photo = syntheticPhoto('2x5')
    await page.locator('input[type=file]').setInputFiles(photo.file)
    await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'Continue' })).toBeInViewport({ ratio: 1 })
    const box = (await page.locator('.shot svg').boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual((await page.locator('.bar').boundingBox())!.height)
    expect(box.y + box.height).toBeLessThanOrEqual(720)
    expect(box.height).toBeGreaterThan(560) // the height under the bar, less a margin
    expect(box.width / box.height).toBeCloseTo(photo.size[0] / photo.size[1], 2)
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0)
    await label(page, photo)

    await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('listitem').filter({ hasText: 'Look again: yellow or pink?' })).toBeInViewport({ ratio: 1 })
    await expect(page.locator('.shot img')).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0)

    // Chrome on Windows can share a file, but its share box saves nothing: a laptop downloads the file.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { value: () => true })
      Object.defineProperty(navigator, 'share', { value: async () => void ((window as unknown as { shared: boolean }).shared = true) })
    })
    const downloaded = page.waitForEvent('download')
    await arm(page)
    await page.getByRole('button', { name: 'Export' }).click()
    expect((await downloaded).suggestedFilename()).toMatch(/^pathoscan-laptop-.+\.csv$/)
    expect(await page.evaluate(() => (window as unknown as { shared?: boolean }).shared)).toBeUndefined()
  })

  test('where the browser offers to install the app, Runs offers it in words true on a laptop too', async ({ page }) => {
    await page.goto('/app.html')
    await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible()
    await page.evaluate(() => {
      const offer = Object.assign(new Event('beforeinstallprompt'), { prompt: async () => void ((window as unknown as { asked: boolean }).asked = true) })
      dispatchEvent(offer)
    })
    await page.getByRole('button', { name: 'Install this app' }).click()
    expect(await page.evaluate(() => (window as unknown as { asked?: boolean }).asked)).toBe(true)
    await expect(page.getByRole('button', { name: /^Install/ })).toHaveCount(0)
  })
})

/** Puts a run into the phone's store exactly as given, as another version of the app might have saved it. */
function storeRaw(page: Page, run: { id: string }) {
  return page.evaluate(
    (run) =>
      new Promise((done, fail) => {
        const open = indexedDB.open('pathoscan-field')
        open.onsuccess = () => {
          const tx = open.result.transaction('runs', 'readwrite')
          tx.objectStore('runs').put(run, run.id)
          tx.oncomplete = () => done(open.result.close())
          tx.onerror = () => fail(tx.error)
        }
      }),
    run,
  )
}

test('a run saved mid-guide by the 8-step app opens on its cool-down, each timer on its own step', async ({ page }) => {
  await page.goto('/app.html')
  await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible()
  // Stored as the 8-step app did: progress by position in preheat, label, mix, crush, dip, oil, shade, cool.
  const min = 60_000
  const now = Date.now()
  const old = {
    schema: 1,
    id: 'saved-by-8-steps',
    assay: 'sclerotinia',
    field: 'Old app',
    notes: '',
    createdAt: now - 90 * min,
    steps: [{ done: true, timerStartedAt: now - 80 * min }, ...Array(4).fill({ done: true }), { done: true, timerStartedAt: now - 40 * min }, { done: true }, { done: false, timerStartedAt: now - 2 * min }],
    taps: Array(10).fill(null),
    appVersion: '0.0.0',
    readerVersion: '1',
  }
  await storeRaw(page, old)
  await page.goto(`/app.html#/run/${old.id}`)
  await expect(page.getByRole('heading', { name: 'Cool the tubes', exact: true })).toBeVisible()
  await expect(page.getByText('Step 9 of 9')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
  const left = await secondsLeft(page)
  expect(left).toBeGreaterThan(2 * 60)
  expect(left).toBeLessThanOrEqual(3 * 60)
  // Back: the shade step has no timer, and the oil step's 30 minutes ran out 10 minutes ago.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Shade the tubes before the photo', exact: true })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Run the test', exact: true })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveText("Time's up")
})

test('a run saved by a newer version of the app is left alone, and Reload is offered', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/app.html')
  await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible()
  const future = { schema: 5, id: 'saved-by-a-newer-app', field: 'Future', createdAt: Date.now(), steps: 'a shape this app has never seen' }
  await storeRaw(page, future)
  await page.reload()
  await expect(page.getByRole('status')).toContainText('New version ready.')
  await expect(page.getByRole('status').getByRole('button', { name: 'Reload' })).toBeVisible()
  await expect(page.getByText('Future')).toHaveCount(0)
  await page.goto(`/app.html#/run/${future.id}`)
  await expect(page.getByText('Reload to open this run.')).toBeVisible()
  // With Reload on offer, a run that isn't there is still just not found.
  await page.goto('/app.html#/run/never-saved')
  await expect(page.getByText('Run not found.')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('New version ready.')
  await expect(page.getByText('Reload to open this run.')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('every step picture moves, and none move when the phone asks for reduced motion', async ({ page }) => {
  await page.goto('/app.html')
  const pictures = [...(await toPhoto(page, 'Motion'))]
  // Open each drawing as its own page, where emulated media reaches its styles, and count the animations running.
  const running = async () => {
    const counts: number[] = []
    for (const src of pictures) {
      await page.goto(src)
      counts.push(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length))
    }
    return counts
  }
  expect((await running()).filter((n) => n > 0).length).toBe(pictures.length - 1) // shade.svg is the one still picture
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await running()).toEqual(pictures.map(() => 0))
})

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
    await arm(page) // each photo opens a new Photo screen, its camera locked for a moment
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

test('under a warm lamp at one end of the rack, the reader holds the tubes it cannot read and calls none wrong', async ({ page }) => {
  // Seed 70: positives 5 and 8 turned only part way, so the lamp's cast, left uncorrected, reads them as
  // negative. Through the app's own path: the camera file, the saved JPEG, the rings, the taps, the export.
  await page.goto('/app.html')
  await toPhoto(page, 'Lamp')
  const photo = syntheticPhoto('row', { seed: 70, lamp: 3000 })
  await page.locator('input[type=file]').setInputFiles(photo.file)
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
  await label(page, photo)
  await expect(page.getByText('Call the held tubes below.')).toBeVisible()
  const column = await exportCsv(page)
  const truth = photo.run.tubes.map((t) => (t.truth === 'pos' ? 'Positive' : 'Negative'))
  const calls = column('Reader call')
  expect(calls.filter((c, i) => c !== 'Held' && c !== truth[i])).toEqual([])
  expect([calls[6], calls[9]]).not.toContain('Negative')
  expect(column('Reader version')).toEqual(Array(10).fill(READER_VERSION))
})

for (const [seed, acidic] of [
  [130, 4],
  [142, 5],
] as const)
  test(`two rows of five under a warm lamp at the left: seed ${seed}'s acidic negative is not called positive`, async ({ page }) => {
    // In even light this negative reads 77 to 78% like the positive control and is held. The 3000 K lamp
    // across the photo once pushed it past 80%, a positive call; the white's range under the lamp holds it.
    // Seed 142's own light also clips the paper, so its run is now held as too bright before that.
    await page.goto('/app.html')
    await toPhoto(page, 'Lamp rows')
    const photo = syntheticPhoto('2x5', { seed, lamp: 3000 })
    await page.locator('input[type=file]').setInputFiles(photo.file)
    await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
    await label(page, photo)
    const column = await exportCsv(page)
    const truth = photo.run.tubes.map((t) => (t.truth === 'pos' ? 'Positive' : 'Negative'))
    const calls = column('Reader call')
    expect(calls.filter((c, i) => c !== 'Held' && c !== truth[i])).toEqual([])
    expect(calls[acidic]).toBe('Held')
  })

for (const [light, lamp, from] of [
  ['a plain shade at the right', 0, 'right'],
  ['a warm lamp at the right', 3000, 'right'],
] as const)
  test(`two rows of five under ${light}: seed 732's weak positive is not called negative`, async ({ page }) => {
    // In even light this positive reads 17% like the positive control and is held, its range just reaching
    // the band. The light moves it a few points lower, and with a margin of only 1° the range stopped short of
    // the band: a negative call.
    await page.goto('/app.html')
    await toPhoto(page, 'Shade rows')
    const photo = syntheticPhoto('2x5', { seed: 732, lamp, from })
    await page.locator('input[type=file]').setInputFiles(photo.file)
    await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
    await label(page, photo)
    const column = await exportCsv(page)
    const truth = photo.run.tubes.map((t) => (t.truth === 'pos' ? 'Positive' : 'Negative'))
    const calls = column('Reader call')
    // The only wrong calls are on a positive whose colour never changed, which no colour reader gets right.
    const wrong = calls.flatMap((c, i) => (c !== 'Held' && c !== truth[i] ? [photo.run.tubes[i].kind] : []))
    expect(wrong.filter((kind) => kind !== 'unchanged')).toEqual([])
    expect(calls[3]).not.toBe('Negative')
  })

/**
 * Takes a photo for the run on the Photo screen, taps a ring onto each tube the finder missed, as a grower
 * would, and labels them: the read result.
 */
async function readPhoto(page: Page, photo: ReturnType<typeof syntheticPhoto>) {
  await page.locator('input[type=file]').setInputFiles(photo.file)
  await expect(page.getByRole('heading', { name: /tubes$/ })).toBeVisible()
  const rings = await page.locator('.shot ellipse').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('cx')), Number(e.getAttribute('cy'))]))
  for (const tube of photo.tubes) if (!rings.some(([x, y]) => Math.hypot(x - tube[0], y - tube[1]) < 30)) await tapPhoto(page, photo.size, tube)
  await expect(page.getByRole('heading', { name: '10 tubes', exact: true })).toBeVisible()
  await label(page, photo)
}

/** The reader's calls the export gives, against each tube's truth: the tubes called wrong, by kind. */
async function wrongCalls(page: Page, photo: ReturnType<typeof syntheticPhoto>) {
  const column = await exportCsv(page)
  const calls = column('Reader call')
  return { calls, warnings: column('Reader warnings'), wrong: calls.flatMap((c, i) => (c !== 'Held' && c !== (photo.run.tubes[i].truth === 'pos' ? 'Positive' : 'Negative') ? [photo.run.tubes[i].kind] : [])) }
}

test("under a 10000 K light half a stop brighter, seed 732's pale positive is not called negative", async ({ page }) => {
  // The paper clipped to [236, 254, 255] while the tube read [215, 139, 151]: the white it was read against had
  // lost light in green and blue, which made the tube look pinker than it is. A tube read against a clipped
  // white is held, with a retake asked.
  await page.goto('/app.html')
  await toPhoto(page, 'Cool bright')
  const photo = syntheticPhoto('row', { seed: 732, cond: { kelvin: 10000, ev: 0.5 } })
  await readPhoto(page, photo)
  const { calls, wrong } = await wrongCalls(page, photo)
  expect(wrong).toEqual([])
  expect(calls[3]).not.toBe('Negative')
  await expect(page.getByRole('button', { name: 'Retake photo' })).toBeVisible()
})

test("a stop brighter under a warm lamp at the top, seed 3's acidic negative is not called positive", async ({ page }) => {
  await page.goto('/app.html')
  await toPhoto(page, 'Warm bright')
  const photo = syntheticPhoto('row', { seed: 3, ev: 1, lamp: 3000, from: 'top' })
  await readPhoto(page, photo)
  const { calls, wrong } = await wrongCalls(page, photo)
  expect(wrong).toEqual([])
  expect(calls[2]).not.toBe('Positive')
})

test('a run failed for a clipped control is retaken from the result, keeping the guide, and reads the new photo', async ({ page }) => {
  // Seed 3 half a stop brighter: the camera clips the red of the paper and of the orange tubes. Read as it was,
  // its acidic negative looked yellower than the controls and was called positive.
  await page.goto('/app.html')
  await toPhoto(page, 'Retake')
  const bright = syntheticPhoto('row', { seed: 3, ev: 0.5 })
  await readPhoto(page, bright)
  await expect(page.getByRole('heading', { name: 'Run failed', exact: true })).toBeVisible()
  await expect(page.getByText(/^Too bright at the (positive|negative) control\. Retake with less light\.$/)).toBeVisible()
  const { warnings } = await wrongCalls(page, bright)
  expect(new Set(warnings).size).toBe(1)
  expect(warnings[0]).toMatch(/^Too bright at the/)

  // Retake: back to the photo step of the same run, and a reload stays there instead of opening the old result.
  await page.getByRole('button', { name: 'Retake photo' }).click()
  await expect(page.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()
  // The guide's progress stays: Back goes to its last step.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByText(`Step ${steps} of ${steps}`)).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  // The same tubes with less light are read, and the result is the run's from now on.
  const darker = syntheticPhoto('row', { seed: 3, ev: -1 })
  await readPhoto(page, darker)
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retake photo' })).toHaveCount(0)
  expect((await wrongCalls(page, darker)).wrong).toEqual([])
  await page.reload()
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await page.goto('/app.html')
  await expect(page.getByRole('listitem').filter({ hasText: 'Retake' })).toHaveCount(1)
})

test("a stop brighter and darkened after the camera clipped, seed 3's acidic negative is not called positive", async ({ page }) => {
  // A phone's tone curve can lower the clipped paper to 247, under the 250 a fixed cut-off looked for: the
  // acidic negative read 98% like the positive control, with nothing held. The clipped light still piles up
  // on one value, and the reader finds it there.
  await page.goto('/app.html')
  await toPhoto(page, 'Tone mapped')
  const photo = syntheticPhoto('row', { seed: 3, ev: 1, darken: 0.1 })
  await readPhoto(page, photo)
  const { calls, wrong } = await wrongCalls(page, photo)
  expect(wrong).toEqual([])
  expect(calls[2]).not.toBe('Positive')
  await expect(page.getByRole('button', { name: 'Retake photo' })).toBeVisible()
})

test('a positive control whose paper is blown out on its upper side fails the run, since that side sets its range', async ({ page }) => {
  // The rest of the photo reads as usual; only the paper above the positive control and beside its upper half
  // is at 255, so the white the range takes from that side has lost light.
  await page.goto('/app.html')
  await toPhoto(page, 'Blown side')
  const photo = syntheticPhoto('row', {
    edit: (img, [[x, y]]) => {
      const top = y - 70 // the liquid's top: it reaches 140 px up from the tip, and y is halfway
      const white = (x0: number, y0: number, x1: number, y1: number) => {
        for (let py = Math.round(y0); py <= y1; py++) for (let px = Math.round(x0); px <= x1; px++) img.data.set([255, 255, 255], (py * img.width + px) * 4)
      }
      white(x - 56, top - 32, x + 56, top - 3)
      white(x - 56, top, x - 28, y)
      white(x + 28, top, x + 56, y)
    },
  })
  await readPhoto(page, photo)
  await expect(page.getByRole('heading', { name: 'Run failed', exact: true })).toBeVisible()
  await expect(page.getByText('Too bright at the positive control. Retake with less light.')).toBeVisible()
})

test("a tap on a stale tab's old result can't change the result of the photo taken since", async ({ page, context }) => {
  // Tab B still shows the failed result of a clipped photo, every sample held. Tab A retakes it with less
  // light: two positives and sample 1 held. Yellow for sample 1 on tab B must not count on that photo.
  await page.goto('/app.html')
  await toPhoto(page, 'Two tabs')
  await readPhoto(page, syntheticPhoto('row', { seed: 3, ev: 0.5 }))
  await expect(page.getByRole('heading', { name: 'Run failed', exact: true })).toBeVisible()
  const stale = await context.newPage()
  await stale.goto(page.url())
  await expect(stale.getByRole('heading', { name: 'Run failed', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Retake photo' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  const darker = syntheticPhoto('row', { seed: 3, ev: -1 })
  await readPhoto(page, darker)
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  const before = await exportCsv(page)

  await stale.locator('ol.tubes li').first().getByRole('button', { name: 'Yellow' }).click()
  // The stale tab is refused and shows the run as it is now.
  await expect(stale.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(stale.getByText('Enough positives to treat.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(page.locator('ol.tubes li').first().getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'false')
  const after = await exportCsv(page)
  for (const column of ['Reader call', 'Grower call', 'Final call', 'Result', 'Positives']) expect(after(column)).toEqual(before(column))
})

/** The run as stored. A readwrite transaction, so it waits for any write a page has under way. */
function storedRun(page: Page, id: string) {
  return page.evaluate(
    (id) =>
      new Promise<Record<string, unknown>>((done, fail) => {
        const open = indexedDB.open('pathoscan-field')
        open.onsuccess = () => {
          const get = open.result.transaction('runs', 'readwrite').objectStore('runs').get(id)
          get.onsuccess = () => done((open.result.close(), get.result))
          get.onerror = () => fail(get.error)
        }
      }),
    id,
  )
}

/** The keys of the saved photos. */
function photoKeys(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((done, fail) => {
        const open = indexedDB.open('pathoscan-photos')
        open.onsuccess = () => {
          const all = open.result.transaction('photos').objectStore('photos').getAllKeys()
          all.onsuccess = () => done((open.result.close(), all.result.map(String)))
          all.onerror = () => fail(all.error)
        }
      }),
  )
}

const runId = (page: Page) => decodeURIComponent(page.url().split('#/run/')[1])

/** The live app's store (e2e/live-store-8ea660e.js), as an old tab of that app has it. */
interface LiveStore {
  getRun(id: string): Promise<{ schema: number }>
  listRuns(): Promise<unknown[]>
  setTap(id: string, i: number, tap: 'pos' | 'neg' | null, treatAt: number): Promise<void>
  setStepDone(id: string, step: string, done: boolean): Promise<void>
  startTimer(id: string, step: string, at: number): Promise<void>
  takePhoto(id: string, jpeg: Blob): Promise<string | null>
  saveRead(id: string, photoKey: string, regions: unknown[], roles: unknown[], read: unknown, treatAt: number): Promise<boolean>
  currentUpdate(): (() => void) | null
}
declare global {
  interface Window {
    live: LiveStore
  }
}

test("an old tab of an earlier app (schema 2) can't change a run this app has opened, and is offered Reload", async ({ page, context }) => {
  // The live app's store binds a tap to no photo. Left open on a result while this app retakes and reads
  // another photo, its Yellow was written to the new photo's result. This app stores the run as schema 4 once
  // it opens it, and that store leaves alone a run of a schema over its own.
  await page.goto('/app.html')
  await toPhoto(page, 'Live tab')
  await readPhoto(page, syntheticPhoto('row', { seed: 3, ev: 0.5 }))
  await expect(page.getByRole('heading', { name: 'Run failed', exact: true })).toBeVisible()
  const id = runId(page)
  // As the live app saved it: schema 2, no take.
  const { take, ...saved } = await storedRun(page, id)
  expect(take).toBe(1)
  const asLiveSaved = { ...saved, id, schema: 2 }
  await storeRaw(page, asLiveSaved)

  // The old tab runs that app's store alone, on a page of this origin that loads none of this app.
  const old = await context.newPage()
  await old.goto('/app-version.json')
  const src = readFileSync(new URL('./live-store-8ea660e.js', import.meta.url), 'utf8')
  await old.evaluate((src) => void (window.live = new Function(`${src}\nreturn live`)()), src)
  // Its result is on show, and it can write the run as that app saved it: a tap on a failed run is a note.
  expect(await old.evaluate((id) => window.live.getRun(id).then((r) => r.schema), id)).toBe(2)
  await old.evaluate((id) => window.live.setTap(id, 2, 'neg', 3), id)
  expect(await storedRun(page, id)).toMatchObject({ schema: 2, taps: [null, null, 'neg', ...Array(7).fill(null)] })

  // This app opens the run, retakes it and reads a photo with less light: two positives, sample 1 held.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Run failed', exact: true })).toBeVisible()
  expect(await storedRun(page, id)).toMatchObject({ schema: 4, take: 0 })
  await page.getByRole('button', { name: 'Retake photo' }).click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await readPhoto(page, syntheticPhoto('row', { seed: 3, ev: -1 }))
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  const before = { run: await storedRun(page, id), photos: await photoKeys(page), csv: await exportCsv(page) }

  // Every write path of the old tab's store is refused before it edits, and Reload is offered there.
  expect(await old.evaluate(() => window.live.currentUpdate())).toBeNull()
  const refused = await old.evaluate(
    async ({ id, photoKey }) => {
      const writes = [
        () => window.live.setTap(id, 2, 'pos', 3), // Yellow for sample 1
        () => window.live.setStepDone(id, 'cool', false),
        () => window.live.startTimer(id, 'preheat', Date.now()),
        () => window.live.takePhoto(id, new Blob(['late'], { type: 'image/jpeg' })),
        () => window.live.saveRead(id, photoKey, [], [], { status: 'ok', flags: [], tubes: [] }, 3),
        () => window.live.getRun(id),
      ]
      const out: string[] = []
      for (const write of writes) await write().then(() => out.push('written'), (e: Error) => out.push(e.message))
      return out
    },
    { id, photoKey: before.run.photoKey as string },
  )
  expect(refused).toEqual(Array(6).fill(`Run ${id} is from a newer version of the app`))
  expect(await old.evaluate(() => typeof window.live.currentUpdate())).toBe('function')
  expect(await old.evaluate(() => window.live.listRuns().then((runs) => runs.length))).toBe(0)

  expect(await storedRun(page, id)).toEqual(before.run)
  expect(await photoKeys(page)).toEqual(before.photos)
  await page.reload()
  await expect(page.getByRole('heading', { name: '2 of 8 positive', exact: true })).toBeVisible()
  await expect(page.locator('ol.tubes li').first().getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'false')
  const after = await exportCsv(page)
  for (const column of ['Reader call', 'Grower call', 'Final call', 'Result', 'Positives']) expect(after(column)).toEqual(before.csv(column))
})

test("a stale Photo screen's Back can't reopen the guide of a run retaken in another tab", async ({ page, context }) => {
  // Tab B was left on the Photo screen before any photo. Tab A reads a photo and retakes it: the run is on the
  // photo step again, with no photo, as B shows it. B's screen is still of the take before.
  await page.goto('/app.html')
  await toPhoto(page, 'Stale photo')
  const stale = await context.newPage()
  await stale.goto(page.url())
  await expect(stale.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()
  await readPhoto(page, syntheticPhoto('row', { seed: 3, ev: 0.5 }))
  await page.getByRole('button', { name: 'Retake photo' }).click()
  await expect(page.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()
  const id = runId(page)
  const before = await storedRun(page, id)
  expect(before).toMatchObject({ take: 2, steps: { cool: { done: true } } })

  // The click's write is under way before the read, which waits for it.
  await stale.getByRole('button', { name: 'Back' }).click()
  expect(await storedRun(stale, id)).toEqual(before)
  // Refused, the stale tab shows the run as it is now.
  await expect(stale.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Take photo', exact: true })).toBeVisible()

  // Now drawn from the run as it is, Back works.
  await stale.getByRole('button', { name: 'Back' }).click()
  await expect(stale.getByText(`Step ${steps} of ${steps}`)).toBeVisible()
  expect(await storedRun(page, id)).toMatchObject({ take: 2, steps: { cool: { done: false } } })
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
