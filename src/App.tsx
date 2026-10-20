import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import evalData from '../data/eval.json'
import { Detail } from './components/Detail'
import { EvalSection } from './components/EvalSection'
import { Matrix, pct } from './components/Matrix'
import { Stage, type StageTube } from './components/Stage'
import { Strip, type StripDot } from './components/Strip'
import { css, type RGB } from './lib/color'
import { emptyConfusion, LIVE, readSyntheticFull, score, scoreRuns, type ReadRun, type ReaderParams } from './lib/evaluate'
import { discRegion, findRegions, globalPaper, measure, type Features, type Region } from './lib/find'
import { loadImage } from './lib/photo'
import { EXCLUDED, readRealImage, realSrc } from './lib/real'
import { loadLabels } from './lib/realData'
import type { Labels } from './lib/real'
import { pAt, readByGroup, readCalibrated, readMidpoint, readNaive, sAt, type Model, type RunRead } from './lib/readers'
import { relight } from './lib/relight'
import { liquidCentre, makeRun, SCENARIOS, type Img, type Kind, type Role, type ScenarioId, type Truth } from './lib/synth'

type Source = 'synthetic' | 'real' | 'upload'
type Reader = 'naive' | 'calibrated'

const STAGE_SCALE = 0.8
const DEFAULT_SEED = 608
const MODEL: Model = evalData.params.model
const KIND_WORD: Record<Kind, string> = {
  control: 'control',
  yellow: 'positive that turned yellow',
  orange: 'weak positive that only reached orange',
  unchanged: 'positive whose colour never changed enough to see',
  'clear-neg': 'negative that stayed pink',
  acidic: 'negative turned orange by an acidic extract',
}

export interface ViewTube {
  label: string
  role: Role
  region: Region | null
  anchor: { x: number; y: number }
  feats: Features | null
  truth: Truth | null
  truthNote: string
}

interface Upload {
  name: string
  base: Img
  tubes: { region: Region; role: Role; truth: Truth | null }[]
  note: string
}

export default function App() {
  const [source, setSource] = useState<Source>('synthetic')
  const [reader, setReader] = useState<Reader>('calibrated')
  const [kelvin, setKelvin] = useState(5500)
  const [ev, setEv] = useState(0)
  const [drift, setDrift] = useState(0)
  const [scenario, setScenario] = useState<ScenarioId>('typical')
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [cut, setCut] = useState(evalData.params.cut)
  const [band, setBand] = useState(evalData.params.band)
  const [selected, setSelected] = useState<number | null>(null)
  const [realIdx, setRealIdx] = useState(0)
  const [realBase, setRealBase] = useState<{ file: string; img: Img } | null>(null)
  const [upload, setUpload] = useState<Upload | null>(null)
  const [placing, setPlacing] = useState(false)
  const [busy, setBusy] = useState('')
  const [labels, setLabels] = useState<Labels | null>(null)
  useEffect(() => {
    loadLabels()
      .then(setLabels)
      .catch(() => setLabels(null))
  }, [])

  const params: ReaderParams = { cut, model: MODEL, band }
  const realImage = labels?.images[realIdx] ?? null

  // Load the chosen real photo. A failed load keeps its message and offers a retry.
  const [realError, setRealError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    // Any error belongs to the photo it came from; switching photos clears it.
    setRealError('')
    if (source !== 'real' || !realImage || realBase?.file === realImage.file) return
    let live = true
    setBusy('Loading photo…')
    loadImage(realSrc(realImage.file))
      .then((img) => {
        if (!live) return
        setRealBase({ file: realImage.file, img })
        setBusy('')
      })
      .catch(() => {
        if (!live) return
        setBusy('')
        setRealError(`Could not load ${realImage.file}.`)
      })
    return () => {
      live = false
      setBusy('')
    }
  }, [source, realImage, realBase, retry])

  // What's on the stage: an image and its tubes, measured.
  const view = useMemo((): { img: Img; tubes: ViewTube[]; groups: string[]; alt: string } | null => {
    if (source === 'synthetic') {
      const spec = makeRun(seed, scenario, { kelvin, ev, drift })
      const { img, regions, feats } = readSyntheticFull(spec, STAGE_SCALE)
      let n = 0
      return {
        img,
        groups: spec.tubes.map(() => ''),
        alt: `Synthetic run of 10 tubes on paper: positive control, negative control, samples 1 to 8. ${SCENARIOS.find((s) => s.id === scenario)!.label}.`,
        tubes: spec.tubes.map((t, i) => {
          const c = liquidCentre(spec, i)
          return {
            label: t.role === 'pc' ? 'PC' : t.role === 'nc' ? 'NC' : String(++n),
            role: t.role,
            region: regions[i],
            anchor: { x: c.x * STAGE_SCALE, y: c.y * STAGE_SCALE },
            feats: feats[i],
            truth: t.truth,
            truthNote: `Synthetic ${KIND_WORD[t.kind]}${t.role === 'sample' ? '' : ''}.`,
          }
        }),
      }
    }
    if (source === 'real') {
      if (!realImage || !realBase || realBase.file !== realImage.file) return null
      const img = relight(realBase.img, kelvin, ev)
      const r = readRealImage(img, realImage, { cut, model: MODEL, band })
      return {
        img,
        groups: r.groups,
        alt: `${realImage.figure}: ${realImage.what}`,
        tubes: r.wells.map((w, i) => ({
          label: r.groups.length && new Set(r.groups).size > 1 ? `${w.id} ${r.groups[i]}` : w.id,
          role: r.roles[i],
          region: r.regions[i],
          anchor: { x: r.regions[i].cx, y: r.regions[i].cy },
          feats: r.feats[i],
          truth: w.truth === 'unknown' ? null : w.truth,
          truthNote: [w.basis, w.ct !== undefined ? `RT-qPCR Ct ${w.ct}.` : '', w.paper_call ? `The paper's own call: ${w.paper_call}.` : '']
            .filter(Boolean)
            .join(' '),
        })),
      }
    }
    if (!upload) return null
    const img = relight(upload.base, kelvin, ev)
    const paper = globalPaper(img)
    let n = 0
    return {
      img,
      groups: upload.tubes.map(() => ''),
      alt: `Your photo, ${upload.name}`,
      tubes: upload.tubes.map((t) => ({
        label: t.role === 'pc' ? 'PC' : t.role === 'nc' ? 'NC' : String(++n),
        role: t.role,
        region: t.region,
        anchor: { x: t.region.cx, y: t.region.cy },
        feats: measure(img, t.region, paper),
        truth: t.truth,
        truthNote: t.truth ? 'You marked this.' : 'Not marked. Tap Positive or Negative below to score it.',
      })),
    }
  }, [source, seed, scenario, kelvin, ev, drift, realImage, realBase, upload])

  const feats = view?.tubes.map((t) => t.feats) ?? []
  const roles = view?.tubes.map((t) => t.role) ?? []
  const groups = view?.groups ?? []
  const pick = <T,>(xs: T[], idx: number[]) => idx.map((i) => xs[i])
  const naive = useMemo(() => readNaive(feats, cut), [view, cut])
  const calibrated = useMemo(() => readByGroup(groups, (idx) => readCalibrated(pick(feats, idx), pick(roles, idx), MODEL, band)), [view, band])
  const midpoint = useMemo(() => readByGroup(groups, (idx) => readMidpoint(pick(feats, idx), pick(roles, idx))), [view])
  const active: RunRead = reader === 'naive' ? naive : calibrated

  useEffect(() => setSelected(null), [source, realIdx, seed, scenario])

  // The live check runs in a worker, restarted whenever the conditions change.
  const worker = useRef<Worker | null>(null)
  const [live, setLive] = useState<{ id: number; runs: ReadRun[]; done: boolean }>({ id: 0, runs: [], done: false })
  const liveId = useRef(0)
  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<{ id: number; runs: ReadRun[]; done: boolean }>) => {
      if (e.data.id !== liveId.current) return
      setLive((prev) => ({ id: e.data.id, runs: prev.id === e.data.id ? [...prev.runs, ...e.data.runs] : e.data.runs, done: e.data.done }))
    }
    return () => w.terminate()
  }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      const id = ++liveId.current
      setLive({ id, runs: [], done: false })
      worker.current?.postMessage({ id, cond: { kelvin, ev, drift } })
    }, 120)
    return () => clearTimeout(t)
  }, [kelvin, ev, drift])
  const liveScores = useMemo(() => scoreRuns(live.runs, params), [live, cut, band])

  // Scores on the photo on stage, for tubes with a known truth.
  const photoScores = useMemo(() => {
    if (!view || source === 'synthetic') return null
    if (source === 'real' && realImage && EXCLUDED[realImage.file]) return null
    const n = emptyConfusion()
    const c = emptyConfusion()
    let marked = 0
    view.tubes.forEach((t, i) => {
      if (t.role !== 'sample' || !t.truth) return
      marked++
      n[t.truth][naive.tubes[i].call]++
      c[t.truth][calibrated.tubes[i].call]++
    })
    return { naive: score(n), calibrated: score(c), marked }
  }, [view, naive, calibrated, source])

  const stageTubes: StageTube[] =
    view?.tubes.map((t, i) => {
      const call = active.tubes[i].call
      return {
        region: t.region,
        anchor: t.anchor,
        label: t.label,
        role: t.role,
        call,
        wrong: t.role === 'sample' && t.truth !== null && call !== 'held' ? call !== t.truth : undefined,
      }
    }) ?? []

  // Only the latest upload may land: a slow decode of an earlier file must not replace a newer one.
  const uploadReq = useRef(0)
  const onFile = useCallback(async (file: File) => {
    const id = ++uploadReq.current
    setBusy('Reading your photo…')
    let base: Img
    try {
      base = await loadImage(file)
    } catch {
      if (id === uploadReq.current) setBusy('That file did not open as an image.')
      return
    }
    if (id !== uploadReq.current) return
    const { regions } = findRegions(base)
    const tubes = regions.slice(0, 40).map((region, i) => ({ region, role: (i === 0 ? 'pc' : i === 1 ? 'nc' : 'sample') as Role, truth: null }))
    setUpload({
      name: file.name,
      base,
      tubes,
      note:
        regions.length === 0
          ? 'Found no pink, orange or yellow liquid. Tap each tube to place it by hand.'
          : `Found ${regions.length} region${regions.length > 1 ? 's' : ''}${regions.length > 40 ? ' (kept the first 40)' : ''}. The first two in reading order are taken as the positive and negative control; tap any to change it.`,
    })
    setPlacing(regions.length === 0)
    setSource('upload')
    setSelected(null)
    setBusy('')
  }, [])

  const editUpload = (i: number, change: Partial<Upload['tubes'][number]> | 'remove') =>
    setUpload((u) => {
      if (!u) return u
      const tubes = change === 'remove' ? u.tubes.filter((_, k) => k !== i) : u.tubes.map((t, k) => (k === i ? { ...t, ...change } : t))
      return { ...u, tubes }
    })

  const sel = selected !== null && view && selected < view.tubes.length ? selected : null

  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <div>
            <h1>Tube Reader</h1>
            <p className="lede">
              Reads a photo of a colorimetric LAMP run tube by tube, against the run's own controls, and says when it can't tell. A first pass at PathoScan's
              Level UP brief, AI Enhancement for PathoBox.
            </p>
          </div>
          <nav className="top-links" aria-label="Sections">
            <a href="#eval">Eval</a>
            <a href="#how">How it works</a>
            <a href="https://github.com/PohTeyToe/riipen-pathoscan">Code</a>
          </nav>
        </div>
        <p className="wrap disclaimer">
          Independent demo by Abdallah Safi from public information. Not made or endorsed by PathoScan. Synthetic runs are drawn by code and say so; the
          real photos are CC0 lab images of SARS-CoV-2 RT-LAMP plates read with SYBR Green I, not phenol red, and not plant samples. It makes calls on
          colour, not diagnoses.
        </p>
      </header>

      <main className="wrap">
        <div className="tabs" role="tablist" aria-label="What to read">
          {(
            [
              ['synthetic', 'Synthetic run'],
              ['real', `Real photos${labels ? ` (${labels.images.length})` : ''}`],
              ['upload', 'Your photo'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={source === id}
              className={source === id ? 'on' : ''}
              disabled={id === 'real' && !labels}
              onClick={() => setSource(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="bench">
          <div className="bench-main">
            <SourceBar
              labels={labels}
              source={source}
              scenario={scenario}
              setScenario={setScenario}
              newRun={() => setSeed((s) => (s * 48271 + 11) % 99991)}
              realIdx={realIdx}
              setRealIdx={setRealIdx}
              upload={upload}
              onFile={onFile}
              placing={placing}
              setPlacing={setPlacing}
            />
            {busy && <p className="busy">{busy}</p>}
            {source === 'real' && realError && (
              <p className="busy" role="alert">
                {realError}{' '}
                <button className="link-btn" onClick={() => setRetry((n) => n + 1)}>
                  Try again
                </button>
              </p>
            )}
            {view ? (
              <Stage
                img={view.img}
                tubes={stageTubes}
                selected={sel}
                onSelect={setSelected}
                chips={source === 'synthetic'}
                placing={source === 'upload' && placing}
                onPlace={(x, y) =>
                  setUpload((u) => {
                    if (!u) return u
                    const r = Math.max(6, Math.min(u.base.width, u.base.height) * 0.025)
                    const role: Role = u.tubes.length === 0 ? 'pc' : u.tubes.length === 1 ? 'nc' : 'sample'
                    return { ...u, tubes: [...u.tubes, { region: discRegion(x, y, r), role, truth: null }] }
                  })
                }
                alt={view.alt}
              />
            ) : (
              source === 'upload' && <DropZone onFile={onFile} />
            )}
            {active.flags.length > 0 && (
              <ul className="flags" aria-label="Run checks">
                {active.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            {view && (
              <ReaderStrip
                reader={reader}
                view={view}
                read={active}
                cut={cut}
                setCut={setCut}
                band={band}
                setBand={setBand}
                selected={sel}
                onSelect={setSelected}
              />
            )}
          </div>

          <aside className="bench-side">
            <div className="panel">
              <h2 className="panel-h">Reader</h2>
              <div className="seg" role="radiogroup" aria-label="Reader">
                {(['naive', 'calibrated'] as const).map((r) => (
                  <button key={r} role="radio" aria-checked={reader === r} className={reader === r ? 'on' : ''} onClick={() => setReader(r)}>
                    {r === 'naive' ? 'Naive' : 'Calibrated'}
                  </button>
                ))}
              </div>
              <p className="hint">
                {reader === 'naive'
                  ? `One fixed hue cut on the camera's colour (${cut.toFixed(1)}°), the best single cut for 600 training runs. It ignores the controls and never says "not sure".`
                  : 'White-balances each tube on the paper beside it, places it between the run’s own controls, and holds the call when it lands in the band.'}
              </p>
            </div>
            <div className="panel">
              <h2 className="panel-h">Conditions</h2>
              <Slider label="Light colour" value={kelvin} min={2500} max={8000} step={100} onChange={setKelvin} fmt={(v) => `${v} K`} ends={['warm lamp', 'shade']} />
              <Slider label="Exposure" value={ev} min={-2} max={2} step={0.1} onChange={setEv} fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} stops`} ends={['dark', 'blown out']} />
              <Slider
                label="Run pH shift"
                value={drift}
                min={-0.3}
                max={0.3}
                step={0.01}
                onChange={setDrift}
                fmt={(v) => (v === 0 ? 'none' : `${v > 0 ? 'acid' : 'base'} ${Math.abs(v).toFixed(2)}`)}
                ends={['toward pink', 'toward yellow']}
                disabled={source !== 'synthetic'}
                note={source !== 'synthetic' ? 'Synthetic runs only: it changes the chemistry, not the photo.' : 'Moves every tube in the run, controls included, like a different master-mix lot.'}
              />
              {source === 'synthetic' && (
                <p className="hint small">Light colour barely moves either reader. Drag Run pH shift toward pink to watch the fixed cut break.</p>
              )}
              <button
                className="link-btn"
                onClick={() => {
                  setKelvin(5500)
                  setEv(0)
                  setDrift(0)
                }}
              >
                Reset conditions
              </button>
            </div>
            <div className="panel">
              <h2 className="panel-h">
                {source === 'synthetic' ? 'Live check' : source === 'real' ? 'This photo' : 'Your photo'}
                {source === 'synthetic' && !live.done && <span className="spin" aria-label="updating" />}
              </h2>
              {source === 'synthetic' ? (
                <>
                  <p className="hint">
                    {LIVE.runs} more synthetic runs ({LIVE.runs * 8} samples, mixed scenarios) under the light and pH shift you set. Read so far:{' '}
                    {live.runs.length} runs.
                  </p>
                  <Matrix s={reader === 'naive' ? liveScores.naive : liveScores.calibrated} showHeld={reader === 'calibrated'} />
                  <Versus a={liveScores.naive} b={liveScores.calibrated} reader={reader} />
                </>
              ) : photoScores && photoScores.marked > 0 ? (
                <>
                  <p className="hint">
                    {photoScores.marked} sample{photoScores.marked > 1 ? 's' : ''} with a known result
                    {source === 'real' ? ' (from the paper; controls not counted).' : ' (marked by you).'}
                  </p>
                  <Matrix s={reader === 'naive' ? photoScores.naive : photoScores.calibrated} showHeld={reader === 'calibrated'} />
                  <Versus a={photoScores.naive} b={photoScores.calibrated} reader={reader} />
                </>
              ) : (
                <p className="hint">
                  {source === 'real'
                    ? realImage && EXCLUDED[realImage.file]
                      ? EXCLUDED[realImage.file]
                      : 'No sample well in this panel has a known result, so there is nothing to score.'
                    : 'Mark tubes as positive or negative to score the readers on your photo.'}
                </p>
              )}
            </div>
          </aside>
        </section>

        {sel !== null && view && (
          <Detail
            tube={view.tubes[sel]}
            naive={naive.tubes[sel]}
            calibrated={calibrated.tubes[sel]}
            midpoint={midpoint.tubes[sel]}
            reader={reader}
            onClose={() => setSelected(null)}
            edit={
              source === 'upload'
                ? {
                    setRole: (role) => editUpload(sel, { role }),
                    setTruth: (truth) => editUpload(sel, { truth }),
                    remove: () => {
                      editUpload(sel, 'remove')
                      setSelected(null)
                    },
                  }
                : null
            }
          />
        )}

        {source === 'real' && realImage && labels && (
          <p className="credit">
            {realImage.figure}, {realImage.file}. {realImage.what} From Bokelmann et al., Nature Communications 2021, photos on{' '}
            <a href={labels.source.zenodo}>Zenodo</a> under CC0. These reactions turn orange to yellow with SYBR Green I added after the run, not
            with phenol red. Well positions, roles and truth are my labels from the paper; see the README.
          </p>
        )}

        <EvalSection />
        <HowItWorks />
      </main>

      <footer className="wrap foot">
        <p>
          Built by Abdallah Safi for PathoScan's Level UP project. Not affiliated with PathoScan. Real photos: Bokelmann, Nickel, Maricic, Pääbo, Meyer, Borte and
          Riesenberg, "Point-of-care bulk testing for SARS-CoV-2 by combining hybridization capture with improved colorimetric LAMP", Nature Communications 12,
          1467 (2021); images on Zenodo (record 4476336), CC0. Everything else on this page is synthetic and drawn by the code in the repo.
        </p>
      </footer>
    </>
  )
}

function Versus({ a, b, reader }: { a: ReturnType<typeof score>; b: ReturnType<typeof score>; reader: Reader }) {
  return (
    <p className="versus">
      <span className={reader === 'naive' ? 'on' : ''}>
        Naive: <b>{a.wrong}</b> wrong
      </span>
      <span className={reader === 'calibrated' ? 'on' : ''}>
        Calibrated: <b>{b.wrong}</b> wrong, <b>{b.held}</b> held
      </span>
    </p>
  )
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt: (v: number) => string
  ends: [string, string]
  disabled?: boolean
  note?: string
}) {
  const id = `s-${props.label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className={`slider${props.disabled ? ' off' : ''}`}>
      <label htmlFor={id}>
        <span>{props.label}</span>
        <output htmlFor={id}>{props.fmt(props.value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <div className="ends" aria-hidden>
        <span>{props.ends[0]}</span>
        <span>{props.ends[1]}</span>
      </div>
      {props.note && <p className="hint small">{props.note}</p>}
    </div>
  )
}

function SourceBar(p: {
  labels: Labels | null
  source: Source
  scenario: ScenarioId
  setScenario: (s: ScenarioId) => void
  newRun: () => void
  realIdx: number
  setRealIdx: (i: number) => void
  upload: Upload | null
  onFile: (f: File) => void
  placing: boolean
  setPlacing: (b: boolean) => void
}) {
  if (p.source === 'synthetic')
    return (
      <div className="sourcebar">
        <div className="scenarios" role="radiogroup" aria-label="Scenario">
          {SCENARIOS.map((s) => (
            <button key={s.id} role="radio" aria-checked={p.scenario === s.id} className={`pill${p.scenario === s.id ? ' on' : ''}`} onClick={() => p.setScenario(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={p.newRun}>
          New run
        </button>
        <p className="tag">Synthetic. Drawn by code, with known truth.</p>
      </div>
    )
  if (p.source === 'real' && p.labels) {
    const n = p.labels.images.length
    return (
      <div className="sourcebar">
        <button className="btn" aria-label="Previous photo" onClick={() => p.setRealIdx((p.realIdx + n - 1) % n)}>
          ‹
        </button>
        <select value={p.realIdx} onChange={(e) => p.setRealIdx(Number(e.target.value))} aria-label="Photo">
          {p.labels.images.map((im, i) => (
            <option key={im.file} value={i}>
              {i + 1}. {im.figure}
            </option>
          ))}
        </select>
        <button className="btn" aria-label="Next photo" onClick={() => p.setRealIdx((p.realIdx + 1) % n)}>
          ›
        </button>
        <p className="tag real">Real photo, CC0. Well positions and truth labelled by hand.</p>
      </div>
    )
  }
  return (
    <div className="sourcebar">
      <label className="btn file">
        {p.upload ? 'Another photo' : 'Choose a photo'}
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && p.onFile(e.target.files[0])} />
      </label>
      {p.upload && (
        <button className={`btn${p.placing ? ' on' : ''}`} aria-pressed={p.placing} onClick={() => p.setPlacing(!p.placing)}>
          {p.placing ? 'Done placing' : 'Place tubes by hand'}
        </button>
      )}
      <p className="tag">{p.upload ? p.upload.note : 'Stays in your browser. Nothing is uploaded anywhere.'}</p>
    </div>
  )
}

function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false)
  return (
    <label
      className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <b>Drop a photo of a run here</b>
      <span>
        Tubes on white paper or a plate from above works best. The reader takes the first two tubes it finds as the positive and negative control, and you can
        change that. The photo never leaves your browser.
      </span>
    </label>
  )
}

function ReaderStrip(p: {
  reader: Reader
  view: { tubes: ViewTube[] }
  read: RunRead
  cut: number
  setCut: (v: number) => void
  band: { lo: number; hi: number }
  setBand: (b: { lo: number; hi: number }) => void
  selected: number | null
  onSelect: (i: number) => void
}) {
  const dots: StripDot[] = p.view.tubes.map((t, i) => {
    const r = p.read.tubes[i]
    return {
      i,
      label: t.label,
      role: t.role,
      call: r.call,
      wrong: t.role === 'sample' && t.truth !== null && r.call !== 'held' && r.call !== t.truth,
      x: p.reader === 'naive' ? (t.feats?.rawHue ?? null) : t.role === 'pc' ? 1 : t.role === 'nc' ? 0 : (r.s ?? null),
    }
  })
  if (p.reader === 'naive') {
    const stops = Array.from({ length: 11 }, (_, k) => {
      const h = -30 + k * 10
      return `hsl(${(h + 360) % 360} 75% 62%) ${k * 10}%`
    })
    return (
      <div className="panel strip-panel">
        <h2 className="panel-h">Decision cut</h2>
        <p className="hint">Raw hue of each tube as the camera saw it. Drag the cut. Right of it reads positive.</p>
        <Strip
          label="Hue scale with the naive cut"
          domain={[-30, 70]}
          unit="°"
          step={0.5}
          gradient={`linear-gradient(90deg, ${stops.join(', ')})`}
          ticks={[-20, 0, 20, 40, 60].map((v) => ({ at: v, label: `${v}°` }))}
          dots={dots}
          spans={[{ from: p.cut, to: 70, kind: 'pos' }]}
          handles={[{ value: p.cut, label: `cut ${p.cut.toFixed(1)}°`, min: -30, max: 70, onChange: (v) => p.setCut(Math.round(v * 2) / 2) }]}
          selected={p.selected}
          onSelect={p.onSelect}
        />
      </div>
    )
  }
  const pcI = p.view.tubes.findIndex((t) => t.role === 'pc')
  const ncI = p.view.tubes.findIndex((t) => t.role === 'nc')
  const col = (i: number, fb: RGB) => css(p.view.tubes[i]?.feats?.corrected ?? fb)
  const ncC = col(ncI, [0.95, 0.55, 0.65])
  const pcC = col(pcI, [0.98, 0.85, 0.35])
  const D: [number, number] = [-0.6, 1.8]
  const pos = (s: number) => `${(((s - D[0]) / (D[1] - D[0])) * 100).toFixed(1)}%`
  const sLo = sAt(MODEL, p.band.lo)
  const sHi = sAt(MODEL, p.band.hi)
  return (
    <div className="panel strip-panel">
      <h2 className="panel-h">Decision band</h2>
      <p className="hint">
        Each sample placed between this run's controls: 0 is the negative control, 1 the positive. Drag either edge. Inside the band the tube is held for a look.
      </p>
      <Strip
        label="Control-relative scale with the held band"
        domain={D}
        unit=""
        step={0.01}
        gradient={`linear-gradient(90deg, ${ncC} 0%, ${ncC} ${pos(0)}, ${pcC} ${pos(1)}, ${pcC} 100%)`}
        ticks={[
          { at: 0, label: 'NC 0' },
          { at: 1, label: 'PC 1' },
        ]}
        dots={dots}
        spans={[
          { from: sLo, to: sHi, kind: 'held' },
          { from: sHi, to: D[1], kind: 'pos' },
        ]}
        handles={[
          {
            value: sLo,
            label: `neg if p ≤ ${pct(p.band.lo)}`,
            min: D[0],
            max: sHi - 0.02,
            onChange: (s) => p.setBand({ ...p.band, lo: Math.min(p.band.hi - 0.01, Math.max(0.01, +pAt(MODEL, s).toFixed(3))) }),
          },
          {
            value: sHi,
            label: `pos if p ≥ ${pct(p.band.hi)}`,
            min: sLo + 0.02,
            max: D[1],
            onChange: (s) => p.setBand({ ...p.band, hi: Math.max(p.band.lo + 0.01, Math.min(0.99, +pAt(MODEL, s).toFixed(3))) }),
          },
        ]}
        selected={p.selected}
        onSelect={p.onSelect}
      />
    </div>
  )
}

function HowItWorks() {
  const e = evalData
  return (
    <section id="how" className="how">
      <h2>How it works</h2>
      <ol className="steps">
        <li>
          <b>Find the liquid.</b> Make the brightest third of the photo (the paper) neutral, then keep pixels that are clearly pink, orange or yellow, join
          the pieces a glare streak or bubble splits, and sort the regions into reading order. A placed or labelled disc skips this step. Both readers get the
          same regions and the same pixels.
        </li>
        <li>
          <b>Measure.</b> Per-channel median of the clear liquid pixels. The naive reader takes that colour's hue as the camera saw it. The calibrated reader
          divides it by the median of the pale, neutral pixels in a ring around the tube, so the paper right beside it becomes white, then converts to CIELAB.
        </li>
        <li>
          <b>Scale.</b> The calibrated reader puts each sample on a line from the negative control's Lab hue (0) to the positive control's (1). A one-feature
          logistic model, fit on {e.setup.train.runs} training runs, turns that position into p (w0 = {e.params.model.w0.toFixed(2)}, w1 ={' '}
          {e.params.model.w1.toFixed(2)}). It is a model, not "AI", and runs in your browser in milliseconds.
        </li>
        <li>
          <b>Call or hold.</b> p at or above the top of the band is positive, at or below the bottom is negative, anything between is held for a look. It also
          holds a tube with too few clear pixels or too little colour, holds the whole run if the controls are less than 20° apart, and flags a positive control
          that reads weaker than samples.
        </li>
      </ol>
      <h3>What this can't tell you</h3>
      <ul className="limits">
        <li>
          Phenol red reads pH, not DNA. An acidic plant extract can turn a negative orange with no amplification. Reading against the controls helps; comparing
          each tube with its own colour at the start of the run would help more.
        </li>
        <li>
          A positive whose colour never changed enough to see, for example from a low amount of target, looks negative to any colour reader. They're in the
          eval and they count against both readers.
        </li>
        <li>
          An end photo can't see when a tube turned, so it can't separate a late, non-specific turn from a real one. A frame a minute from the box would.
        </li>
        <li>
          Colour isn't severity. LAMP saturates, so how yellow a tube ends up says little about how much target it started with. This reads tubes. It says
          nothing about a plant or a field.
        </li>
        <li>
          No plant extracts, no PathoBox camera, and no lab results from PathoScan went into any number here. The synthetic runs follow my assumptions, written
          out in the README, and the real photos are a different assay on 96-well plates.
        </li>
      </ul>
    </section>
  )
}
