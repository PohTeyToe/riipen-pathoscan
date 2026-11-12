import { expect, test, type Page } from '@playwright/test'

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
  await page.goto('/')
  await expect(page).toHaveTitle('Tube Reader')
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()
})
