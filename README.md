# Tube Reader

A browser tool that reads a photo of a colorimetric LAMP run tube by tube. It compares each tube with the run's own positive and negative controls, and when a tube sits between them it holds the call for a person to read. A naive reader sits next to it for comparison: one fixed hue cut on the camera's colour.

Built by Abdallah Safi for PathoScan's Riipen Level UP project, "AI Enhancement for PathoBox". Not made or endorsed by PathoScan. It makes calls on colour. It doesn't diagnose anything, and nothing here says how a field or a crop is doing.

Live: https://riipen-pathoscan.vercel.app

## What you can do on the page

The page calls the calibrated reader **Tube Reader** and the naive one **Fixed cut**. The rest of this README keeps "calibrated" and "naive".

1. **The first screen** reads one synthetic run in three steps: the positive control came out weak, a midpoint rule calls two in-between negatives positive, and the calibrated reader flags the control and holds those two for a look. The steps play once on their own, with a Pause button. If the browser asks for reduced motion they wait for a tap. The run is seed 22 of the weak-control scenario, the first one where the midpoint rule makes two wrong calls, the calibrated reader none, and the control reads weaker than three samples. That is the pattern measured in PathoScan's photo (below). Every caption is computed from the run, and `src/page.test.ts` checks both the captions and the seed rule.
2. **The case-study photo** as a chart: the hue of each tube, its handwritten call, the midpoint between the controls and the positive control's hue. The numbers come from `data/case-study.json`.
3. **The lab.** A typical run (seed 7, the first that matches the eval's per-run averages) with a row of lights under the tubes for each reader. Pick run pH shift, light colour or exposure and drag the slider: the run redraws and both readers re-read it. The slider steps through the points of the eval's sweeps, and the chart and counts beside it are those sweeps from `data/eval.json`, so the numbers on screen are the eval's, not a fresh sample. Light colour barely moves either reader; a shift toward pink breaks the fixed cut. Scenarios (weak positive control, acidic extract, glare, a bubble, low volume) and New run change the run. Tap a light for what the camera saw, the colour with the paper made white, and what each rule decided and why.
4. **The eval**: both readers on the 16,000 held-out samples, as unit charts (one square is 16 samples) with the exact counts.
5. **Real photos**: the same readers on 27 real photos, scored against the paper's results. It opens on the first photo whose plate has both controls for every assay. Switch reader, drag the cut or the edges of the held band, pick a well from the list or the photo, and see the matrix for that photo. **Your photo** takes your own: it finds the coloured liquid, takes the first two tubes as the controls (you can change that), and lets you place tubes by hand if it misses. Mark what each tube really was and the matrix scores both readers. The photo never leaves the browser.

Synthetic runs are labelled as such. The SYBR Green I note sits with the real photos and in the footer.

## Data, and what is real

**Synthetic runs** are drawn pixel by pixel by `src/lib/synth.ts`, so their truth is known. Each tube's colour comes from a mix of phenol red's pink and yellow forms. Fill height, glare, bubbles, paper tint, a shadow, noise, light colour and exposure vary from run to run. Everything about them is my assumption, labelled synthetic on the page:

| Assumption | Value | Basis |
|---|---|---|
| Share of samples truly positive | 40% | My choice |
| Positives: yellow / orange / colour never changed enough | 79% / 14.5% / 6.5% | RT-LAMP phenol-red reads against PCR in [PMC8079700](https://pmc.ncbi.nlm.nih.gov/articles/PMC8079700/), where the unchanged ones had low viral load |
| Negatives turned orange by an acidic extract | 8% | Guess. Plant sap can be acidic |
| Run pH shift (whole run, controls included) | uniform, -0.2 to +0.2 of the way to pink or yellow | Guess. Stands in for master-mix lot and buffer differences |
| Light | 2700 to 6500 K and -1 to +1 stops. The cast is raised to the power 0.65 to stand in for a phone's partial auto white balance | Guess |

**Real photos.** 27 photos of colorimetric RT-LAMP plates for SARS-CoV-2 from Bokelmann, Nickel, Maricic, Pääbo, Meyer, Borte and Riesenberg, "Point-of-care bulk testing for SARS-CoV-2 by combining hybridization capture with improved colorimetric LAMP", *Nature Communications* 12, 1467 (2021), [doi:10.1038/s41467-021-21627-0](https://doi.org/10.1038/s41467-021-21627-0). The photos are on Zenodo, [record 4476336](https://zenodo.org/records/4476336), released under **CC0**. `public/real/` holds copies downscaled to 1400 px.

The labels in `data/real/labels.json` are mine. Claude read the paper's figure legends, Supplementary Tables 3 and 4 and the Source Data spreadsheet, then placed each well with code and checked the placement on overlays. Truth is the paper's RT-qPCR result, the sample set's known status, or the control's role. It never comes from the colour. The file records the basis for every well. 996 wells are read. Skipped: 18 wells whose content the paper doesn't document, and 2 control wells (Supp. Fig. 5c, C8 and D8) whose labels the Source Data contradicts. A disputed control can't anchor the scale. Supp. Fig. 2 is shown but not scored, because it was taken before incubation. The source data has some problems, noted in the file: Source Data column headers swapped against the photos, two Zenodo file names swapped against their in-image labels, and one control label that contradicts the data. These are plates of a human-virus assay seen from above, not plant samples or tubes on paper. They also use a different colour chemistry. The paper adds SYBR Green I after the reaction, and that turns positives from orange or red to yellow. It doesn't use phenol red's pH change. So the photos test the same reading problem on real images, not phenol red itself.

**Not used:** any PathoScan photo, data, model or lab result.

## Results

All numbers come from the scripts below, run on the code in `src/lib`.

### Held-out synthetic runs (`npm run eval`, `data/eval.json`)

2,000 runs, 16,000 samples, fit on 600 other runs. The naive cut (23.5°) is the best single cut for the training runs under every training light. The calibrated reader's logistic model has w0 = -3.68 and w1 = 7.74, and its band holds p from 0.2 to 0.8.

| | Wrong | Held | Right among calls made |
|---|---|---|---|
| Naive | 1,249 | 0 | 92.2% |
| Calibrated | 419 | 2,902 (18%) | 96.8% |

412 positives never changed colour enough to see. They are all 412 of the naive reader's misses in that group. The calibrated reader gets 368 of them wrong and holds the other 44. No colour reader gets them right. The naive reader's losses are mostly the orange middle: it calls 639 of 917 weak positives negative. The calibrated reader holds 805 of those and gets none wrong.

What surprised me: **light colour doesn't break the fixed cut** in this model. A warm cast squeezes hues together, and the best cut sits near the hue that moves least. What breaks it is a pH shift shared by the whole run. At -0.3 the naive reader makes 87 wrong calls per 320 samples against 26 with no shift, while the calibrated reader stays at 7 to 8. Overexposed photos are where the calibrated reader holds most. At 0 stops and below it holds about 40 of 320 samples, one in eight. At +1 stop the camera clips the red of the paper and the tubes, so it holds 253 of 320 and calls none wrong. At +2 stops the finder loses 93 of 400 tubes and the calibrated reader holds every sample. The runs in the table are lit anywhere from -1 to +1 stop, so their brighter half lifts it to 18%.

### Real photos (`npm run eval:real`, `data/real-eval.json`)

The fair comparison covers 664 sample wells whose assay has both controls on the same plate. Only 26 of them are positive, and the chemistry differs (above), so this is a check on real photos, not a benchmark.

| | Wrong | Held |
|---|---|---|
| Naive (cut learned on synthetic) | 303 | 0 |
| Naive, best cut for these wells picked with hindsight (50°) | 17 | 0 |
| Calibrated, nothing retuned | 16 | 299 |
| The paper's own hue calls (on the 438 of these wells it reports) | 7 | 0 |
| Calibrated, on those same 438 wells | 7 | 176 |

- A fixed cut doesn't travel. On these plates the negatives read orange, not pink.
- Most of the calibrated reader's held wells sit on four plates whose controls are 14° to 19° apart. That's under the 20° minimum I set on synthetic runs. At 10° it would hold 155 and still get 16 wrong. I kept 20°, because changing it after seeing these results would be tuning on the test set.
- 208 more scored wells have no pair of controls on their plate. The calibrated reader holds all of them.
- The paper's calls are better on the wells both of us read. Its cut was set for this assay and these plates. This reader saw neither before.
- The scores use the labelled well positions. Run on the same photos, the automatic finder covers 910 of the 996 wells read here. It also returns 21 regions on wells the scores skip or on a well it already found, and 8 on no well at all.
- The page decodes the photos with the browser, `scripts/eval-real.ts` with jpeg-js. Hues near the fixed cut can land on the other side, so a single photo's counts on the page can differ a little from a recount in Node. On the Supp. Fig. 5a plate that Zenodo labels SuppFig5_d, the fixed cut gets 31 of 45 wrong in Chrome and 25 in Node. The totals above are from Node.

### Light and exposure (`npx tsx scripts/lamp-sweep.ts --seeds 0-999`)

Synthetic runs with seeds 0 to 999, each as a row of ten and as two rows of five, go through the field app's own photo path in Chromium: the saved JPEG, the rings, the grower's taps, then the read. Each is read in even light at its own exposure, then changed one way at a time: a 3000, 2400 or 10000 K lamp at the left, right or top, fading to daylight at the far side; a plain shade, 15% darker at one side; or the whole photo 1 stop darker, or 0.5, 1 or 1.5 stops brighter.

| | Samples | Wrong | Held | Turned wrong from held in even light |
|---|---|---|---|---|
| Even light | 16,000 | 402 | 16.1% | |
| Under a lamp | 144,000 | 3,761 | 12.3% | 169 |
| Under a shade | 48,000 | 1,251 | 13.3% | 56 |
| 1 stop darker | 16,000 | 424 | 10.1% | 22 |
| 0.5 stops brighter | 16,000 | 350 | 27.6% | 4 |
| 1 stop brighter | 15,912 | 254 | 52.2% | 0 |
| 1.5 stops brighter | 15,544 | 145 | 73.2% | 0 |

No change calls a tube wrong that even light read right. The 251 reads it calls wrong that even light held all sit on 14 runs whose own exposure is 0.3 stops or more over. Their even-light photo is clipped, which is why it held those tubes. The changed photo calls them the way their colour reads: positives whose colour never or barely changed (228 reads) and acidic negatives that turned orange (23). Read without the clipping check and with a 1° margin, even light calls every one of them wrong too. A tube near a band edge in a clean photo stays held under every change here, since the 2° margin covers what a lamp, a shade or a stop moves it. The brighter photos hold most of their tubes and fail many runs outright: a control with two channels clipped has no colour left to read. The 68 unread photos are ones where the taps did not give one ring per tube.

## PathoScan's published photo: what the tool measures

The research for this project rested on one claim about the Alternaria photo on page 4 of PathoScan's greenhouse case study ([PDF](https://www.pathoscan.com/s/PathoScan-Greenhouse-Trial-Case-Study-1.pdf), Nov 24 visit). The claim: the positive control reads less yellow than three positive samples, and a midpoint rule between the controls flips three tubes. I measured it with this tool. The photo is not in this repo. `scripts/case-study-check.ts` runs on a copy you extract yourself and writes the numbers below to `data/case-study.json`.

The image is 810 by 296 px, and each tube tip is about 6 to 10 px across, so the automatic finder can't read it alone. It finds 8 of the 10 tips and misses PS162 and PS169. I placed the ten read spots by hand, the same as the page's "Place tubes by hand". Then I repeated every read at 27 placements: radius 3, 4 or 5 px, each shifted up to 2 px.

Raw hue at the centre placement (0° is red, 60° is yellow): positive control 25.0°, negative control -3.9°, PS162 31.8°, PS163 11.3°, PS164 6.0°, PS165 37.6°, PS166 40.0°, PS167 40.0°, PS168 22.9°, PS169 19.4°.

- **Positive control less yellow than the positive samples.** It holds, and it's stronger than the claim. The control reads less yellow than **all four** tubes marked "+" (PS162, PS165, PS166, PS167), at all 27 placements. That may be why it's marked "+/-".
- **A midpoint rule flips three tubes.** Only partly. The midpoint between the controls is about 10.5°. It calls PS168 and PS169 positive against their handwritten "−" at all 27 placements. PS163 (the corrected "*−") flips at 9 of 27, because it sits within about 1° of the midpoint. So the fair line is "two tubes for sure, a third on the edge".
- **What the naive cut does.** The fixed 23.5° cut learned on synthetic runs matches all eight handwritten calls at 24 of 27 placements. On this photo a fixed cut does fine, and the midpoint rule is what breaks.
- **What the calibrated reader does.** It never contradicts a handwritten call. It flags the positive control as weaker than the samples, but it counts 3 rather than 4, because PS162 has too few clear pixels to score. At this resolution it holds most tubes for too few clear pixels. It calls PS167 positive at 24 of 27 placements, PS166 at 20 and PS165 at 10, and holds everything else. On a photo this small it mostly says "read these by eye", which is the right answer but not a useful one. A box camera close to the tubes would give it hundreds of pixels per tube.

So the line for any message is: "Your positive control reads less yellow than all four tubes you marked positive. A midpoint rule between the controls would call 168 and 169 positive, and 163 is within a degree of flipping." Don't claim three flips.

## How it works

1. **Find** (`src/lib/find.ts`). Make the paper neutral: the white of each part of the photo is the brightest third of the pixels around it, so a lamp that warms one side doesn't turn that paper into "liquid". A second pass takes each area against the first estimate, pixel by pixel, so the white follows a lamp's gradient right up to the frame instead of running cool. Keep pixels that are clearly pink, orange or yellow. Drop any region with the frame or the dark table along one side: it isn't a tube on paper. Join pieces that a glare streak or bubble splits, and sort the regions into reading order. A placed or labelled disc skips this step. Both readers get the same regions and pixels.
2. **Measure.** Tell liquid from paper against the white map at each pixel, as the finder does, and take the per-channel median of the liquid pixels. The naive reader uses that colour's HSV hue. The calibrated reader takes each pixel against the map's white, set right by the paper in a ring around the tube (the median of the ring's pale, neutral pixels as a share of the map), and converts the median to CIELAB. The ring doesn't decide which pixels are liquid: a tube can tint the paper or plastic around it with its own colour, and a pale tube judged against that tint would show no colour at all. That white is only known so well, so each tube also gets the range of hues it could have: under each side of the ring's white (left, right, above, below), which disagree when the light changes across the tube in a way the map doesn't follow; under the ring's paper as one white for the whole tube, which disagrees when a tube that fills much of the photo has tinted the map; and, with paper on fewer than two sides, under the whole photo's white. In even light these agree to a fraction of a degree. With no paper in the ring, the map alone gives the white. A channel at 250 or more may be clipped: the camera saw at least that much light, maybe far more. So each tube also gets a second hue, with every clipped channel at twice the light it shows.
3. **Scale** (`src/lib/readers.ts`). The calibrated reader puts each sample on a line from the negative control's Lab hue (0) to the positive control's (1). With several positive controls it uses the one that turned furthest and flags any that didn't turn. Several negative controls are averaged if they agree. If they don't, one may be contaminated, and it holds the group. A one-feature logistic model maps the position to p. A plate with two assays is read as two groups, each against its own controls.
4. **Call or hold.** A tube is positive only if every hue its range allows, read against every hue the controls' ranges allow, gives p ≥ 0.8. It is negative only if every one gives p ≤ 0.2. Each range reaches at least 2° either side, about what photos of the same tubes under a lamp, in shade or at another exposure differ by. The run is also read a second way, with every tube and control at its clipped hue, since an overexposed photo clips many tubes at once, and the call has to hold both ways. Anything else is held. A flag counts the tubes held only for their range and asks for a retake in even light, not too bright. A tube with two channels clipped has one left to read a colour from, so it is held. A control like that fails the run, with a request to retake the photo with less light. It also holds tubes with fewer than 25 clear pixels or too little colour, and a found sample whose box is over three times the size of the run's median found box, since that region has likely spread into paper or table. It holds the whole run when the controls are under 20° apart, and it flags a positive control that reads weaker than samples.

The "model" is a two-parameter logistic regression. I don't call it AI. All of it runs in the browser in milliseconds.

## What it can't tell you

- Phenol red reads pH, not DNA. An acidic plant extract can turn a negative orange with no amplification. Reading against the controls helps. Comparing each tube with its own colour at the start of the run would help more.
- A positive whose colour never changed enough to see, for example from a low amount of target, looks negative to any colour reader.
- An end photo can't see when a tube turned, so it can't tell a late, non-specific turn from a real one. A frame a minute from the box could.
- Colour isn't severity. LAMP saturates, so how yellow a tube ends up says little about how much target it started with. This tool reads tubes. It says nothing about a plant or a field.
- A tube with no paper visible beside it is read against the white map alone, which is smoothed over an eighth of the photo. Its range takes in the whole photo's white, so under a lamp it is held more often. Keep paper in view around each tube.
- The synthetic numbers depend on my assumptions above. The real photos are a different assay in a different format. None of this has been checked on PathoBox images.

## Run it

Needs Node 20 or later.

```bash
npm install
npm run dev          # http://localhost:5102
npm test             # unit tests (vitest)
npm run build        # type-check, then a static build in dist/
npm run e2e          # Playwright: builds, serves on 5112, runs the field app offline and checks the demo (Chromium)
npm run eval         # refit and rescore the synthetic eval, writes data/eval.json (about a minute)
npm run eval:real    # score the real photos, writes data/real-eval.json
npx tsx scripts/lamp-sweep.ts      # the light and exposure check above, on seeds 0 to 199 (add --seeds 0-999 for the table)
npx tsx scripts/case-study-check.ts <photo.png>   # the PathoScan photo check above
npm run measure -- <photo> [names] ["x:y:r;..."]  # any photo, found or hand-placed
npx tsx scripts/read-runs.ts <manifest.json> > <out.json>  # a batch of photos with named tubes and control groups, as JSON on stdout
npx tsx scripts/check-app-path.ts <manifest.json> [overlay-dir] > <out.json>  # real photos through the field app's Photo path in Chromium, upright and turned 180 degrees, calls compared per label
npx tsx scripts/thumbs.ts                          # redraw the photo picker's thumbnails
```

The site is static (Vite, React, TypeScript) with no backend. `vercel.json` sends `X-Robots-Tag: noindex` and caches hashed assets. `.npmrc` sets `legacy-peer-deps` because npm 10.8 trips on Vite 8's optional peers.

## Layout

```
src/lib/        colour maths, synthetic renderer, finder, readers, eval, real-photo reader, tests
src/run.ts      a synthetic run as the page shows it: drawn, found, measured, read by all three rules
src/caseStudy.ts the case-study numbers the page charts
src/components/ hero story, rack and lights, case-study chart, lab, sweep chart, eval, real-photo bench, stage, scale strip, matrix, tube detail
src/page.test.ts checks the page's runs and numbers against what it says about them
app.html, src/app/ the field app (in progress): offline runs on the phone, a step guide with a drawing on each step and timers, the photo with rings and tubes labelled by tapping them in order, and the result, with a CSV export (one row per tube). Its service worker covers /app.html only
e2e/            Playwright test for the field app
scripts/        eval, real-photo eval, photo measurement, image IO for Node
data/           eval.json, real-eval.json, real/labels.json
public/real/    the 27 CC0 photos, downscaled, and thumbs/ for the picker
```
