# Tube Reader

A browser tool that reads a photo of a colorimetric LAMP run tube by tube. It compares each tube with the run's own positive and negative controls, and when a tube sits between them it holds the call for a person to read. A naive reader sits next to it for comparison: one fixed hue cut on the camera's colour.

Built by Abdallah Safi for PathoScan's Riipen Level UP project, "AI Enhancement for PathoBox". Not made or endorsed by PathoScan. It makes calls on colour. It doesn't diagnose anything, and nothing here says how a field or a crop is doing.

Live: https://riipen-pathoscan.vercel.app

## What you can do on the page

The page calls the calibrated reader **Tube Reader** and the naive one **Fixed cut**. The rest of this README keeps "calibrated" and "naive".

1. **The first screen** reads one synthetic run in three steps: the positive control came out weak, a midpoint rule calls two in-between negatives positive, and the calibrated reader flags the control and holds those two for a look. The steps play once on their own, with a Pause button. If the browser asks for reduced motion they wait for a tap. The run is seed 176 of the weak-control scenario, the first one where the midpoint rule makes two wrong calls, the calibrated reader none, and the control reads weaker than three samples. That is the pattern measured in PathoScan's photo (below). Every caption is computed from the run, and `src/page.test.ts` checks both the captions and the seed rule.
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

2,000 runs, 16,000 samples, fit on 600 other runs. The naive cut (23.5°) is the best single cut for the training runs under every training light. The calibrated reader's logistic model has w0 = -3.71 and w1 = 7.78, and its band holds p from 0.2 to 0.8.

| | Wrong | Held | Right among calls made |
|---|---|---|---|
| Naive | 1,248 | 0 | 92.2% |
| Calibrated | 488 | 1,621 (10%) | 96.6% |

412 positives never changed colour enough to see. They are all 412 of the naive reader's misses in that group. The calibrated reader gets 399 of them wrong and holds the other 13. No colour reader gets them right. The naive reader's losses are mostly the orange middle: it calls 638 of 917 weak positives negative. The calibrated reader holds 673 of those and gets 7 wrong.

What surprised me: **light colour doesn't break the fixed cut** in this model. A warm cast squeezes hues together, and the best cut sits near the hue that moves least. What breaks it is a pH shift shared by the whole run. At -0.3 the naive reader makes 87 wrong calls per 320 samples against 25 with no shift, while the calibrated reader stays at 8 to 9. Blown-out photos (+2 stops) hurt both readers. The finder loses 93 of 400 tubes, and the calibrated reader holds 168 samples rather than guess.

### Real photos (`npm run eval:real`, `data/real-eval.json`)

The fair comparison covers 664 sample wells whose assay has both controls on the same plate. Only 26 of them are positive, and the chemistry differs (above), so this is a check on real photos, not a benchmark.

| | Wrong | Held |
|---|---|---|
| Naive (cut learned on synthetic) | 301 | 0 |
| Naive, best cut for these wells picked with hindsight (48.5°) | 18 | 0 |
| Calibrated, nothing retuned | 23 | 233 |
| The paper's own hue calls (on the 438 of these wells it reports) | 7 | 0 |
| Calibrated, on those same 438 wells | 8 | 152 |

- A fixed cut doesn't travel. On these plates the negatives read orange, not pink.
- Most of the calibrated reader's held wells sit on four plates whose controls are 14° to 19° apart. That's under the 20° minimum I set on synthetic runs. At 10° it would hold 45 and still get 23 wrong. I kept 20°, because changing it after seeing these results would be tuning on the test set.
- 208 more scored wells have no pair of controls on their plate. The calibrated reader holds all of them.
- The paper's calls are better on the wells both of us read. Its cut was set for this assay and these plates. This reader saw neither before.
- The scores use the labelled well positions. Run on the same photos, the automatic finder covers 730 of the 996 wells read here. It also returns 21 regions on wells the scores skip or on a well it already found, and 11 on no well at all.
- The page decodes the photos with the browser, `scripts/eval-real.ts` with jpeg-js. Hues near the fixed cut can land on the other side, so a single photo's counts on the page can differ a little from a recount in Node. On the Supp. Fig. 5a plate that Zenodo labels SuppFig5_d, the fixed cut gets 31 of 45 wrong in Chrome and 25 in Node. The totals above are from Node.

## PathoScan's published photo: what the tool measures

The research for this project rested on one claim about the Alternaria photo on page 4 of PathoScan's greenhouse case study ([PDF](https://www.pathoscan.com/s/PathoScan-Greenhouse-Trial-Case-Study-1.pdf), Nov 24 visit). The claim: the positive control reads less yellow than three positive samples, and a midpoint rule between the controls flips three tubes. I measured it with this tool. The photo is not in this repo. `scripts/case-study-check.ts` runs on a copy you extract yourself and writes the numbers below to `data/case-study.json`.

The image is 810 by 296 px, and each tube tip is about 6 to 10 px across, so the automatic finder fails on it. It finds 6 regions, not 10, and one is a shadow. I placed the ten read spots by hand, the same as the page's "Place tubes by hand". Then I repeated every read at 27 placements: radius 3, 4 or 5 px, each shifted up to 2 px.

Raw hue at the centre placement (0° is red, 60° is yellow): positive control 25.6°, negative control -3.8°, PS162 32.4°, PS163 11.5°, PS164 6.0°, PS165 37.6°, PS166 40.0°, PS167 40.0°, PS168 20.0°, PS169 16.2°.

- **Positive control less yellow than the positive samples.** It holds, and it's stronger than the claim. The control reads less yellow than **all four** tubes marked "+" (PS162, PS165, PS166, PS167), at all 27 placements. That may be why it's marked "+/-".
- **A midpoint rule flips three tubes.** Only partly. The midpoint between the controls is about 11°. It calls PS168 and PS169 positive against their handwritten "−" at all 27 placements. PS163 (the corrected "*−") flips at 12 of 27, because it sits within about 1° of the midpoint. At one placement PS164 flips too. So the fair line is "two tubes for sure, a third on the edge".
- **What the naive cut does.** The fixed 23.5° cut learned on synthetic runs matches all eight handwritten calls at 26 of 27 placements. On this photo a fixed cut does fine, and the midpoint rule is what breaks.
- **What the calibrated reader does.** It never contradicts a handwritten call. It flags the positive control as weaker than the samples, but it counts 3 rather than 4, because PS162 has too few clear pixels to score. At this resolution it holds most tubes for too few clear pixels. It calls PS167 positive at 24 of 27 placements, PS166 at 20 and PS165 at 8, and holds everything else. On a photo this small it mostly says "read these by eye", which is the right answer but not a useful one. A box camera close to the tubes would give it hundreds of pixels per tube.

So the line for any message is: "Your positive control reads less yellow than all four tubes you marked positive. A midpoint rule between the controls would call 168 and 169 positive, and 163 is within a degree of flipping." Don't claim three flips.

## How it works

1. **Find** (`src/lib/find.ts`). Make the brightest third of the photo, the paper, neutral. Keep pixels that are clearly pink, orange or yellow. Join pieces that a glare streak or bubble splits, and sort the regions into reading order. A placed or labelled disc skips this step. Both readers get the same regions and pixels.
2. **Measure.** Take the per-channel median of the liquid pixels. The naive reader uses that colour's HSV hue. The calibrated reader divides it by the median of pale, neutral pixels in a ring around the tube, so the nearby paper becomes white, then converts to CIELAB.
3. **Scale** (`src/lib/readers.ts`). The calibrated reader puts each sample on a line from the negative control's Lab hue (0) to the positive control's (1). With several positive controls it uses the one that turned furthest and flags any that didn't turn. Several negative controls are averaged if they agree. If they don't, one may be contaminated, and it holds the group. A one-feature logistic model maps the position to p. A plate with two assays is read as two groups, each against its own controls.
4. **Call or hold.** p ≥ 0.8 is positive and p ≤ 0.2 is negative. Anything in between is held. It also holds tubes with fewer than 25 clear pixels or too little colour. It holds the whole run when the controls are under 20° apart, and it flags a positive control that reads weaker than samples.

The "model" is a two-parameter logistic regression. I don't call it AI. All of it runs in the browser in milliseconds.

## What it can't tell you

- Phenol red reads pH, not DNA. An acidic plant extract can turn a negative orange with no amplification. Reading against the controls helps. Comparing each tube with its own colour at the start of the run would help more.
- A positive whose colour never changed enough to see, for example from a low amount of target, looks negative to any colour reader.
- An end photo can't see when a tube turned, so it can't tell a late, non-specific turn from a real one. A frame a minute from the box could.
- Colour isn't severity. LAMP saturates, so how yellow a tube ends up says little about how much target it started with. This tool reads tubes. It says nothing about a plant or a field.
- The synthetic numbers depend on my assumptions above. The real photos are a different assay in a different format. None of this has been checked on PathoBox images.

## Run it

Needs Node 20 or later.

```bash
npm install
npm run dev          # http://localhost:5102
npm test             # unit tests (vitest)
npm run build        # type-check, then a static build in dist/
npm run eval         # refit and rescore the synthetic eval, writes data/eval.json (about a minute)
npm run eval:real    # score the real photos, writes data/real-eval.json
npx tsx scripts/case-study-check.ts <photo.png>   # the PathoScan photo check above
npm run measure -- <photo> [names] ["x:y:r;..."]  # any photo, found or hand-placed
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
scripts/        eval, real-photo eval, photo measurement, image IO for Node
data/           eval.json, real-eval.json, real/labels.json
public/real/    the 27 CC0 photos, downscaled, and thumbs/ for the picker
```
