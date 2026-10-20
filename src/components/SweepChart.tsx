import { useEffect, useRef, useState } from 'react'

export interface SweepPoint {
  x: number
  naive: { wrong: number; held: number; samples: number }
  calibrated: { wrong: number; held: number; samples: number }
}

/** Width of an element in CSS pixels, so SVG text stays the same size at every width. */
export function useWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, w] as const
}

interface Props {
  points: SweepPoint[]
  at: number
  fmt: (x: number) => string
  label: string
}

/** Wrong calls (and the calibrated reader's held calls) per point of one eval sweep, with a cursor on the slider's point. */
export function SweepChart({ points, at, fmt, label }: Props) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const H = 188
  const m = { l: 30, r: 10, t: 14, b: 26 }
  const n = points[0].naive.samples
  const yMax = Math.max(40, Math.ceil(Math.max(...points.flatMap((p) => [p.naive.wrong, p.calibrated.wrong, p.calibrated.held])) / 20) * 20)
  const X = (k: number) => m.l + (k / (points.length - 1)) * (W - m.l - m.r)
  const Y = (v: number) => m.t + (1 - v / yMax) * (H - m.t - m.b)
  const series = [
    { key: 'naive', ys: points.map((p) => p.naive.wrong) },
    { key: 'cal', ys: points.map((p) => p.calibrated.wrong) },
    { key: 'held', ys: points.map((p) => p.calibrated.held) },
  ]
  const path = (ys: number[]) => ys.map((y, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(y).toFixed(1)}`).join('')
  const ticks = [0, yMax / 2, yMax]
  const xTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1]

  return (
    <div className="sweep" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={`${label}: wrong and held calls per ${n} synthetic samples at each setting`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} />
            <text className="ax" x={m.l - 6} y={Y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((k) => (
          <text key={k} className="ax" x={X(k)} y={H - 6} textAnchor={k === 0 ? 'start' : k === points.length - 1 ? 'end' : 'middle'}>
            {fmt(points[k].x)}
          </text>
        ))}
        <line className="cursor" x1={X(at)} x2={X(at)} y1={m.t - 6} y2={H - m.b} />
        {series.map((s) => (
          <path key={s.key} className={`ln ${s.key}`} d={path(s.ys)} />
        ))}
        {series.map((s) => (
          <circle key={s.key} className={`end ${s.key}`} cx={X(at)} cy={Y(s.ys[at])} r={4.5} />
        ))}
      </svg>
    </div>
  )
}
