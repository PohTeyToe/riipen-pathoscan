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

2,000 runs, 16,000 samples, fit on 600 other runs. The naive cut (23.5°) is the best single cut for the training runs under every training light. The calibrated reader's logistic model has w0 = -3.64 and w1 = 7.74, and its band holds p from 0.2 to 0.8.

| | Wrong | Held | Right among calls made |
|---|---|---|---|
| Naive | 1,249 | 0 | 92.2% |
| Calibrated | 256 | 7,630 (48%) | 96.9% |

412 positives never changed colour enough to see. They are all 412 of the naive reader's misses in that group. The calibrated reader gets 222 of them wrong and holds the other 190. No colour reader gets them right. The naive reader's losses are mostly the orange middle: it calls 639 of 917 weak positives negative. The calibrated reader holds 835 of those and gets none wrong.

What surprised me: **light colour doesn't break the fixed cut** in this model. A warm cast squeezes hues together, and the best cut sits near the hue that moves least. What breaks it is a pH shift shared by the whole run. At -0.3 the naive reader makes 87 wrong calls per 320 samples against 26 with no shift, while the calibrated reader stays at 7 to 8. Overexposed photos are where the calibrated reader holds most. At 0 stops and below it holds 40 of 320 samples, one in eight. From +0.5 stops the camera clips the paper's red, and a colour read against a clipped white has no bound, so it holds every sample and asks for a retake with less light. At +2 stops the finder also loses 93 of 400 tubes. The runs in the table are lit anywhere from -1 to +1 stop, and about half of them clip the paper somewhere, which lifts it to 48%.

### Real photos (`npm run eval:real`, `data/real-eval.json`)

The fair comparison covers 664 sample wells whose assay has both controls on the same plate. Only 26 of them are positive, and the chemistry differs (above), so this is a check on real photos, not a benchmark.

| | Wrong | Held |
|---|---|---|
| Naive (cut learned on synthetic) | 303 | 0 |
| Naive, best cut for these wells picked with hindsight (50°) | 17 | 0 |
| Calibrated, nothing retuned | 0 | 664 |
| The paper's own hue calls (on the 438 of these wells it reports) | 7 | 0 |
| Calibrated, on those same 438 wells | 0 | 438 |

- A fixed cut doesn't travel. On these plates the negatives read orange, not pink.
- The calibrated reader holds every well, because these photos are too bright to read. On all 26 the white behind the plate is clipped: it piles up at 255, and 873 of the 996 wells read take their white, or part of their range, from it. A colour read against a clipped white has no bound, and a clipped control holds every sample in its assay. The reader before this check called 123 of the 664 wells and got 9 wrong. It only looked for a median at 250 or more, so it missed whites that were partly clipped or came from the whole photo.
- 208 more scored wells have no pair of controls on their plate. The calibrated reader holds all of them.
- The paper's calls are more useful here: it calls all 438 wells with 7 wrong, where this reader calls none. Its cut was set for this assay and these plates. This reader saw neither before.
- The scores use the labelled well positions. Run on the same photos, the automatic finder covers 910 of the 996 wells read here. It also returns 21 regions on wells the scores skip or on a well it already found, and 8 on no well at all.
- The page decodes the photos with the browser, `scripts/eval-real.ts` with jpeg-js. Hues near the fixed cut can land on the other side, so a single photo's counts on the page can differ a little from a recount in Node. On the Supp. Fig. 5a plate that Zenodo labels SuppFig5_d, the fixed cut gets 31 of 45 wrong in Chrome and 25 in Node. The totals above are from Node.

### Light and exposure (`npx tsx scripts/lamp-sweep.ts --seeds 0-299,569,732`)

Synthetic runs with seeds 0 to 299, plus 569 and 732, each as a row of ten and as two rows of five, go through the field app's own photo path in Chromium: the saved JPEG, the rings, the grower's taps, then the read. Each is read in even light at its own exposure, then changed: a 3000, 2400 or 10000 K lamp at the left, right or top, fading to daylight at the far side; a plain shade, 15% darker at one side; a 10000 or 2400 K light over the whole scene; the whole photo 1 stop darker, or 0.5, 1 or 1.5 stops brighter; and every lamp, shade and whole-scene light again 0.5 and 1 stop brighter. A lamp lights the scene before the camera clips, as a real one does. Last, the photo is darkened after the camera clipped it, as a phone's tone curve or an edit can: by 0.1 and 0.3 stop at the run's own exposure and at each brighter step, and by 0.1 stop under every lamp, shade and whole-scene light 0.5 and 1 stop brighter. That moves the clipped light from 255 down to about 247 or 233.

| | Samples | Wrong | Held | Turned wrong from held in even light |
|---|---|---|---|---|
| Even light | 4,832 | 80 | 42.5% | |
| Darker or brighter | 19,184 | 162 | 68.3% | 32 |
| Lamp | 43,488 | 734 | 40.5% | 17 |
| Shade | 14,496 | 253 | 39.0% | 13 |
| Whole-scene light | 9,664 | 141 | 49.0% | 0 |
| Lamp, brighter | 86,952 | 521 | 78.8% | 0 |
| Shade, brighter | 28,936 | 192 | 77.7% | 0 |
| Whole-scene light, brighter | 19,312 | 89 | 85.4% | 0 |
| Darkened after clipping | 9,664 | 172 | 32.0% | 12 |
| Brighter, darkened | 28,672 | 207 | 76.6% | 2 |
| Lamp, brighter, darkened | 86,928 | 1,072 | 58.1% | 38 |
| Shade, brighter, darkened | 28,960 | 341 | 61.6% | 4 |
| Whole-scene light, brighter, darkened | 19,312 | 262 | 53.6% | 19 |

No change calls a tube wrong that even light read right. Of the 137 that turn wrong from held, 133 are positives whose colour never changed enough to see. Their even-light photo is over-exposed and clipped, so it held them as too bright or failed the run. A darker photo, or a lamp that dims the clipped side, reads them as the negatives they look like.

The other 4 are weak orange positives called negative, each held in even light near the edge of the band: three under a 10000 K light over the whole scene, one under a 2400 K lamp, all half a stop or a stop brighter and then darkened 0.1 stop. In the three, the paper's blue had only just clipped, and once darkened that thin layer of clipped light doesn't stand out from the paper just below it. In the fourth, the JPEG smeared the lowered red pile over more values than the reader allows for. Either way the reader misses the clipping, and it is enough to move those tubes out of the band.

On the jobs both were run on, without whole-scene light or the half-stop mixed steps, the reader before this check turned 1,114 tubes wrong from held, 1,052 of them in darkened photos, and the release before that 1,742. This one turns 78, 16 of them darkened. Against the reader before, 58 tubes are newly wrong, and against the release 98, all positives whose colour never changed. Those readers held them for reasons that had nothing to do with their colour. No colour reader can get those tubes right.

The price is in over-exposed photos. In even light, runs at their own exposure or darker hold 10.6% of samples (10.8% before this check). From just over 0 to +0.5 stops they hold 60.2% (68.6% before), and past +0.5 stops every sample, with a request to retake with less light. The release before both held about 9% at every exposure, and got 126 tubes wrong in even light where this reader gets 80. The 2° margin stays: at 1°, two weak positives turned wrong under a lamp. The 82 unread photos are ones where the taps did not give one ring per tube.

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
2. **Measure.** Tell liquid from paper against the white map at each pixel, as the finder does, and take the per-channel median of the liquid pixels. The naive reader uses that colour's HSV hue. The calibrated reader takes each pixel against the map's white, set right by the paper in a ring around the tube (the median of the ring's pale, neutral pixels as a share of the map), and converts the median to CIELAB. The ring doesn't decide which pixels are liquid: a tube can tint the paper or plastic around it with its own colour, and a pale tube judged against that tint would show no colour at all. That white is only known so well, so each tube also gets the range of hues it could have: under each side of the ring's white (left, right, above, below), which disagree when the light changes across the tube in a way the map doesn't follow; under the ring's paper as one white for the whole tube, which disagrees when a tube that fills much of the photo has tinted the map; and, with paper on fewer than two sides, under the whole photo's white. In even light these agree to a fraction of a degree. With no paper in the ring, the map alone gives the white. Then clipping. A camera records all the light past its top as one value, and a phone's tone curve may move that value below 255 but keeps those pixels together. So in each channel the photo's clip level is a value of 228 or more where pixels pile up, at least four times as many as just below the pile and almost none above it, or 255 if there is no such pile. A JPEG smears a pile by about two values where only some channels clip, so the pile is counted with that spread. A set of pixels is clipped if a quarter of it sits on the level or one above, in any channel: a median moves once half the set clips, and the synthetic camera's noise leaves only half of a clipped patch on the level. Every set a colour or a white comes from goes through that one test: the liquid, the ring's paper, each side of the ring, the white map at the tube, and the whole photo's white where the range uses it. If any is clipped, the camera saw at least that much light there and maybe far more, so the tube is marked clipped. This is a heuristic, checked on the synthetic runs and the public real photos, not a measured boundary for phone JPEGs.
3. **Scale** (`src/lib/readers.ts`). The calibrated reader puts each sample on a line from the negative control's Lab hue (0) to the positive control's (1). With several positive controls it uses the one that turned furthest and flags any that didn't turn. Several negative controls are averaged if they agree. If they don't, one may be contaminated, and it holds the group. A one-feature logistic model maps the position to p. A plate with two assays is read as two groups, each against its own controls.
4. **Call or hold.** A tube is positive only if every hue its range allows, read against every hue the controls' ranges allow, gives p ≥ 0.8. It is negative only if every one gives p ≤ 0.2. Each range reaches at least 2° either side, about what photos of the same tubes under a lamp, in shade or at another exposure differ by. Anything else is held. A flag counts the tubes held only for their range and asks for a retake in even light, not too bright. A clipped tube has no colour to call: it is held, with "Too bright here. Retake with less light." A clipped control fails the run with the same request. The field app shows every held tube's reason beside it and in the CSV, and offers Retake photo whenever a reason asks for one: it goes back to the photo step of the same run, keeping the guide's progress. It also holds tubes with fewer than 25 clear pixels or too little colour, and a found sample whose box is over three times the size of the run's median found box, since that region has likely spread into paper or table. It holds the whole run when the controls are under 20° apart, and it flags a positive control that reads weaker than samples.

The "model" is a two-parameter logistic regression. I don't call it AI. All of it runs in the browser in milliseconds.

## What it can't tell you

- Phenol red reads pH, not DNA. An acidic plant extract can turn a negative orange with no amplification. Reading against the controls helps. Comparing each tube with its own colour at the start of the run would help more.
- A positive whose colour never changed enough to see, for example from a low amount of target, looks negative to any colour reader.
- An end photo can't see when a tube turned, so it can't tell a late, non-specific turn from a real one. A frame a minute from the box could.
- Colour isn't severity. LAMP saturates, so how yellow a tube ends up says little about how much target it started with. This tool reads tubes. It says nothing about a plant or a field.
- A tube with no paper visible beside it is read against the white map alone, which is smoothed over an eighth of the photo. Its range takes in the whole photo's white, so under a lamp it is held more often. Keep paper in view around each tube.
- The clipping check is a heuristic. A tone curve that takes more than about a third of a stop off the highlights moves the clip level below where the reader looks. The level is one per photo, so a phone that tone-maps parts of the photo differently can hide clipping in some of them. Once lowered, a thin layer of clipped light, or one the JPEG smears widely, doesn't stand out, and in the sweep above that calls four weak positives negative. Evenly lit paper with nothing brighter in the photo can look like a pile, and then the reader holds tubes or fails a run it could have read.
- Clipping that the camera then tone-maps, darkened about 0.4 stop or more or smeared by noise, can't be detected from the JPEG alone. A Codex review reproduced a confident wrong call that way: seed 3 a stop brighter and darkened 0.4 stop has its acidic negative called positive, nothing held for it. The release now live (8ea660e) calls it wrong too.
- Under a very warm light over the whole scene, about 1800 K, an orange positive can still be called negative with confidence. The release before this change does the same. Retake in daylight or under a white lamp.
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
npx tsx scripts/lamp-sweep.ts      # the light and exposure check above, on seeds 0 to 199 (add --seeds 0-299,569,732 for the table)
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
