import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import realEval from '../../data/real-eval.json'
import { css, type RGB } from '../lib/color'
import { emptyConfusion, score } from '../lib/evaluate'
import { discRegion, findRegions, globalPaper, measure, type Features, type Region } from '../lib/find'
import { loadImage } from '../lib/photo'
import { assayName, EXCLUDED, readable, readRealImage, realSrc, type Labels, type RealImage } from '../lib/real'
import { loadLabels } from '../lib/realData'
import { pAt, readByGroup, readCalibrated, readMidpoint, readNaive, sAt, type Band, type RunRead } from '../lib/readers'
import type { Img, Role, Truth } from '../lib/synth'
import { BAND, CUT, isWrong, MODEL } from '../run'
import { Detail, type TubeInfo } from './Detail'
import { Matrix, pct } from './Matrix'
import { Stage, type StageTube } from './Stage'
import { Strip, type StripDot } from './Strip'

type Source = 'real' | 'upload'
type Reader = 'naive' | 'calibrated'

interface ViewTube extends TubeInfo {
  region: Region
}

interface Upload {
  name: string
  img: Img
  tubes: { region: Region; role: Role; truth: Truth | null }[]
  note: string
}

const shortFig = (figure: string) => figure.replace(/ \(.*\)$/, '').replace('Supp. ', 'S')

/** The photo the bench opens on: the first scored one where every assay on the plate has both controls, so both readers can read it. */
export function firstReadable(images: RealImage[]) {
  const ok = (im: RealImage) => {
    if (EXCLUDED[im.file]) return false
    const wells = readable(im)
    const groups = [...new Set(wells.map(assayName))]
    const both = groups.every((g) => wells.some((w) => assayName(w) === g && w.role === 'pc') && wells.some((w) => assayName(w) === g && w.role === 'ntc'))
    return both && wells.some((w) => w.role === 'sample' && w.truth !== 'unknown')
  }
  return Math.max(0, images.findIndex(ok))
}

export function Workbench() {
  const [source, setSource] = useState<Source>('real')
  const [reader, setReader] = useState<Reader>('calibrated')
  const [cut, setCut] = useState(CUT)
  const [band, setBand] = useState<Band>(BAND)
  const [selected, setSelected] = useState<number | null>(null)
  const [labels, setLabels] = useState<Labels | null>(null)
  const [labelsError, setLabelsError] = useState(false)
  const [realIdx, setRealIdx] = useState(0)
  const [realBase, setRealBase] = useState<{ file: string; img: Img } | null>(null)
  const [realError, setRealError] = useState('')
  const [retry, setRetry] = useState(0)
  const [upload, setUpload] = useState<Upload | null>(null)
  const [placing, setPlacing] = useState(false)
  const [busy, setBusy] = useState('')
  const [reading, setReading] = useState<'' | 'busy' | 'bad'>('')
  const picked = useRef(false)
  const strip = useRef<HTMLDivElement>(null)

  // The label file is large, so it loads on its own after the first paint.
  useEffect(() => {
    let live = true
    loadLabels()
      .then((l) => {
        if (!live) return
        setLabels(l)
        setRealIdx((i) => (picked.current ? i : firstReadable(l.images)))
      })
      .catch(() => live && setLabelsError(true))
    return () => {
      live = false
    }
  }, [retry])

  const realImage = labels?.images[realIdx] ?? null

  // Load the chosen real photo. Any error belongs to the photo it came from: switching photos clears it.
  useEffect(() => {
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

  const view = useMemo((): { img: Img; tubes: ViewTube[]; groups: string[]; alt: string } | null => {
    if (source === 'real') {
      if (!realImage || !realBase || realBase.file !== realImage.file) return null
      const r = readRealImage(realBase.img, realImage, { cut, model: MODEL, band })
      const several = new Set(r.groups).size > 1
      return {
        img: realBase.img,
        groups: r.groups,
        alt: `${realImage.figure}: ${realImage.what}`,
        tubes: r.wells.map((w, i) => ({
          label: several ? `${w.id} ${r.groups[i]}` : w.id,
          role: r.roles[i],
          region: r.regions[i],
          feats: r.feats[i],
          truth: w.truth === 'unknown' ? null : w.truth,
          truthNote: [w.basis, w.ct !== undefined ? `RT-qPCR Ct ${w.ct}.` : '', w.paper_call ? `The paper's own call: ${w.paper_call}.` : ''].filter(Boolean).join(' '),
        })),
      }
    }
    if (!upload) return null
    const paper = globalPaper(upload.img)
    let n = 0
    return {
      img: upload.img,
      groups: upload.tubes.map(() => ''),
      alt: `Your photo, ${upload.name}`,
      tubes: upload.tubes.map((t) => ({
        label: t.role === 'pc' ? 'PC' : t.role === 'nc' ? 'NC' : String(++n),
        role: t.role,
        region: t.region,
        feats: measure(upload.img, t.region, paper),
        truth: t.truth,
        truthNote: t.truth ? 'You marked this.' : 'Not marked. Pick Really positive or Really negative below to score it.',
      })),
    }
    // cut and band don't change what's measured; the reads below use them.
  }, [source, realImage, realBase, upload])

  const feats = view?.tubes.map((t) => t.feats) ?? []
  const roles = view?.tubes.map((t) => t.role) ?? []
  const groups = view?.groups ?? []
  const pick = <T,>(xs: T[], idx: number[]) => idx.map((i) => xs[i])
  const naive = useMemo(() => readNaive(feats, cut), [view, cut])
  const calibrated = useMemo(() => readByGroup(groups, (idx) => readCalibrated(pick(feats, idx), pick(roles, idx), MODEL, band)), [view, band])
  const midpoint = useMemo(() => readByGroup(groups, (idx) => readMidpoint(pick(feats, idx), pick(roles, idx))), [view])
  const active: RunRead = reader === 'naive' ? naive : calibrated

  useEffect(() => setSelected(null), [source, realIdx])

  // Keep the chosen photo in view inside the picker without moving the page.
  useEffect(() => {
    const el = strip.current
    const b = el?.querySelector<HTMLElement>(`[data-i="${realIdx}"]`)
    if (!el || !b) return
    if (b.offsetLeft < el.scrollLeft || b.offsetLeft + b.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollTo({ left: b.offsetLeft - 16, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [realIdx, labels, source])

  const scores = useMemo(() => {
    if (!view) return null
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
  }, [view, naive, calibrated, source, realImage])

  const stageTubes: StageTube[] =
    view?.tubes.map((t, i) => ({
      region: t.region,
      label: t.label,
      role: t.role,
      call: active.tubes[i].call,
      wrong: t.truth ? isWrong(t.role, active.tubes[i].call, t.truth) : undefined,
    })) ?? []

  // Only the latest upload may land: a slow decode of an earlier file must not replace a newer one.
  const uploadReq = useRef(0)
  const onFile = useCallback(async (file: File) => {
    const id = ++uploadReq.current
    setReading('busy')
    let img: Img
    try {
      img = await loadImage(file)
    } catch {
      if (id === uploadReq.current) setReading('bad')
      return
    }
    if (id !== uploadReq.current) return
    const { regions } = findRegions(img)
    setUpload({
      name: file.name,
      img,
      tubes: regions.slice(0, 40).map((region, i) => ({ region, role: i === 0 ? 'pc' : i === 1 ? 'nc' : 'sample', truth: null })),
      note:
        regions.length === 0
          ? 'Found no pink, orange or yellow liquid. Tap each tube to place it by hand.'
          : `Found ${regions.length} region${regions.length > 1 ? 's' : ''}${regions.length > 40 ? ' (kept the first 40)' : ''}. The first two in reading order are the controls; pick any tube to change that.`,
    })
    setPlacing(regions.length === 0)
    setSelected(null)
    setReading('')
  }, [])
  // Leaving "Your photo" drops a photo still being read, so it can't land on top of what the visitor went to.
  const choose = (s: Source) => {
    if (s !== 'upload') {
      uploadReq.current++
      setReading('')
    }
    setSource(s)
  }

  const editUpload = (i: number, change: Partial<Upload['tubes'][number]> | 'remove') =>
    setUpload((u) => {
      if (!u) return u
      const tubes = change === 'remove' ? u.tubes.filter((_, k) => k !== i) : u.tubes.map((t, k) => (k === i ? { ...t, ...change } : t))
      return { ...u, tubes }
    })

  const sel = selected !== null && view && selected < view.tubes.length ? selected : null
  const w = realEval.withControls

  return (
    <section id="bench" className="bench" aria-labelledby="bench-h">
      <div className="wrap">
        <p className="eyebrow">Real photos</p>
        <h2 id="bench-h">Run it on 27 real photos, or on yours.</h2>

        <div className="seg big" role="group" aria-label="What to read">
          <button type="button" aria-pressed={source === 'real'} onClick={() => choose('real')}>
            Real photos
          </button>
          <button type="button" aria-pressed={source === 'upload'} onClick={() => choose('upload')}>
            Your photo
          </button>
        </div>

        {source === 'real' &&
          (labels ? (
            <div className="thumbs" role="group" aria-label="Photo" ref={strip}>
              {labels.images.map((im, i) => (
                <button
                  key={im.file}
                  type="button"
                  className="thumb"
                  data-i={i}
                  aria-pressed={realIdx === i}
                  onClick={() => {
                    picked.current = true
                    setRealIdx(i)
                  }}
                >
                  <img src={`/real/thumbs/${im.file}`} alt="" loading="lazy" decoding="async" />
                  <span>
                    {i + 1}. {shortFig(im.figure)}
                  </span>
                </button>
              ))}
            </div>
          ) : labelsError ? (
            <p className="note" role="alert">
              The photo labels didn't load.{' '}
              <button type="button" className="link" onClick={() => (setLabelsError(false), setRetry((n) => n + 1))}>
                Try again
              </button>
            </p>
          ) : (
            <p className="note">Loading the photo labels…</p>
          ))}

        {source === 'upload' && (
          <div className="upload-bar">
            <label className="btn">
              {upload ? 'Another photo' : 'Choose a photo'}
              <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            {upload && (
              <button type="button" className="btn ghost" aria-pressed={placing} onClick={() => setPlacing(!placing)}>
                {placing ? 'Done placing' : 'Place tubes by hand'}
              </button>
            )}
            <p className="note" role="status">
              {reading === 'busy'
                ? 'Reading your photo…'
                : reading === 'bad'
                  ? 'That file did not open as an image.'
                  : upload
                    ? upload.note
                    : 'It stays in your browser. Nothing is uploaded.'}
            </p>
          </div>
        )}

        {busy && <p className="note" role="status">{busy}</p>}
        {source === 'real' && realError && (
          <p className="note" role="alert">
            {realError}{' '}
            <button type="button" className="link" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </p>
        )}

        <div className="bench-grid">
          <div className="bench-main">
            {view ? (
              <Stage
                img={view.img}
                tubes={stageTubes}
                selected={sel}
                onSelect={setSelected}
                placing={source === 'upload' && placing}
                onPlace={(x, y) =>
                  setUpload((u) => {
                    if (!u) return u
                    const r = Math.max(6, Math.min(u.img.width, u.img.height) * 0.025)
                    const role: Role = u.tubes.length === 0 ? 'pc' : u.tubes.length === 1 ? 'nc' : 'sample'
                    return { ...u, tubes: [...u.tubes, { region: discRegion(x, y, r), role, truth: null }] }
                  })
                }
                alt={view.alt}
              />
            ) : source === 'upload' ? (
              <DropZone onFile={onFile} />
            ) : (
              <div className="stage-wait" />
            )}
            {source === 'real' && realImage && (
              <p className="fine">
                {realImage.figure}. {realImage.what} {EXCLUDED[realImage.file] ?? ''}
              </p>
            )}
          </div>

          <aside className="bench-side">
            <div className="seg" role="group" aria-label="Reader">
              <button type="button" aria-pressed={reader === 'naive'} onClick={() => setReader('naive')}>
                Fixed cut
              </button>
              <button type="button" aria-pressed={reader === 'calibrated'} onClick={() => setReader('calibrated')}>
                Tube Reader
              </button>
            </div>
            {active.flags.length > 0 && (
              <ul className="flags" aria-label="Run checks">
                {active.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            {scores && scores.marked > 0 ? (
              <>
                <p className="side-h">
                  This {source === 'real' ? 'photo' : 'photo, as you marked it'}: {scores.marked} sample{scores.marked > 1 ? 's' : ''} with a known result
                </p>
                <Matrix s={reader === 'naive' ? scores.naive : scores.calibrated} showHeld={reader === 'calibrated'} />
              </>
            ) : (
              view && (
                <p className="note">
                  {source === 'real' ? 'No sample here has a known result, so there is nothing to score.' : 'Pick a tube and mark what it really was to score both readers.'}
                </p>
              )
            )}
          </aside>
        </div>

        {view && (
          <ReaderStrip
            reader={reader}
            tubes={view.tubes}
            read={active}
            cut={cut}
            setCut={setCut}
            band={band}
            setBand={setBand}
            selected={sel}
            onSelect={setSelected}
          />
        )}

        {sel !== null && view && (
          <Detail
            tube={view.tubes[sel]}
            naive={naive.tubes[sel]}
            calibrated={calibrated.tubes[sel]}
            midpoint={midpoint.tubes[sel]}
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

        <div className="real-sum">
          <table>
            <caption>
              All {w.scored} sample wells with both controls on their plate, {realEval.images} scored photos
            </caption>
            <thead>
              <tr>
                <th scope="col">Reader</th>
                <th scope="col">Wrong</th>
                <th scope="col">Held</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Fixed cut, learned on synthetic runs</th>
                <td>{w.naive.wrong}</td>
                <td>0</td>
              </tr>
              <tr>
                <th scope="row">Fixed cut, best for these wells in hindsight ({realEval.hindsightCut.cut}°)</th>
                <td>{realEval.hindsightCut.wrong}</td>
                <td>0</td>
              </tr>
              <tr className="us">
                <th scope="row">Tube Reader, nothing retuned</th>
                <td>{w.calibrated.wrong}</td>
                <td>{w.calibrated.held}</td>
              </tr>
              <tr>
                <th scope="row">The paper's own calls, on the {realEval.onPaperCalled.paper.samples} wells it reports</th>
                <td>{realEval.onPaperCalled.paper.wrong}</td>
                <td>0</td>
              </tr>
              <tr className="us">
                <th scope="row">Tube Reader on those {realEval.onPaperCalled.paper.samples} wells</th>
                <td>{realEval.onPaperCalled.calibrated.wrong}</td>
                <td>{realEval.onPaperCalled.calibrated.held}</td>
              </tr>
            </tbody>
          </table>
          <p className="fine">
            27 CC0 photos of SARS-CoV-2 RT-LAMP plates from Bokelmann et al., <i>Nature Communications</i> 2021 (
            <a href="https://zenodo.org/records/4476336" rel="noreferrer">
              Zenodo 4476336
            </a>
            ). These reactions are read with SYBR Green I added after the run, not phenol red, on plates rather than plant tubes on paper, so this is a check on real
            photos, not a benchmark. Truth is the paper's RT-qPCR or sample-set result, never the colour; well labels are mine. Most held wells sit on plates whose
            controls are under the 20° minimum I set on synthetic runs. One photo, taken before incubation, is shown but not scored.
          </p>
        </div>
      </div>
    </section>
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
      <b>Drop a photo of a run here, or choose one</b>
      <span>Tubes on white paper work best. The first two tubes it finds are taken as the positive and negative control, and you can change that.</span>
    </label>
  )
}

function ReaderStrip(p: {
  reader: Reader
  tubes: ViewTube[]
  read: RunRead
  cut: number
  setCut: (v: number) => void
  band: Band
  setBand: (b: Band) => void
  selected: number | null
  onSelect: (i: number) => void
}) {
  const dots: StripDot[] = p.tubes.map((t, i) => {
    const r = p.read.tubes[i]
    return {
      i,
      label: t.label,
      role: t.role,
      call: r.call,
      wrong: isWrong(t.role, r.call, t.truth),
      x: p.reader === 'naive' ? (t.feats?.rawHue ?? null) : t.role === 'pc' ? 1 : t.role === 'nc' ? 0 : (r.s ?? null),
    }
  })
  if (p.reader === 'naive') {
    const stops = Array.from({ length: 11 }, (_, k) => `hsl(${(-30 + k * 10 + 360) % 360} 75% 62%) ${k * 10}%`)
    return (
      <div className="strip-panel">
        <p className="side-h">Fixed cut: raw camera hue of every tube. Drag the cut; right of it reads positive.</p>
        <Strip
          label="Hue scale with the fixed cut"
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
  const pcI = p.tubes.findIndex((t) => t.role === 'pc')
  const ncI = p.tubes.findIndex((t) => t.role === 'nc')
  const col = (i: number, fb: RGB) => css((p.tubes[i]?.feats as Features | null)?.corrected ?? fb)
  const ncC = col(ncI, [0.95, 0.55, 0.65])
  const pcC = col(pcI, [0.98, 0.85, 0.35])
  const D: [number, number] = [-0.6, 1.8]
  const pos = (s: number) => `${(((s - D[0]) / (D[1] - D[0])) * 100).toFixed(1)}%`
  const sLo = sAt(MODEL, p.band.lo)
  const sHi = sAt(MODEL, p.band.hi)
  return (
    <div className="strip-panel">
      <p className="side-h">Tube Reader: each sample between this run's controls, 0 the negative and 1 the positive. Drag either edge of the band; inside it, a tube is held.</p>
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
            label: `negative if p ≤ ${pct(p.band.lo)}`,
            min: D[0],
            max: sHi - 0.02,
            onChange: (s) => p.setBand({ ...p.band, lo: Math.min(p.band.hi - 0.01, Math.max(0.01, +pAt(MODEL, s).toFixed(3))) }),
          },
          {
            value: sHi,
            label: `positive if p ≥ ${pct(p.band.hi)}`,
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
