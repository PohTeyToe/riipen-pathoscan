import { useState, type MouseEvent } from 'react'
import type { Region } from '../lib/find'
import { REACH_PX } from './reader'

export interface Ring {
  region: Region
  label: string
  tone?: 'pos' | 'neg' | 'held' | 'picked'
}

/** The run's photo with a numbered ring on each tube. With onTap, a tap reports image pixels and the reach in image pixels. */
export function Shot({ src, rings, onTap }: { src?: string; rings: Ring[]; onTap?: (x: number, y: number, reach: number) => void }) {
  const [size, setSize] = useState<{ src: string; w: number; h: number }>()
  const tap = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const k = size!.w / box.width
    onTap!((e.clientX - box.left) * k, (e.clientY - box.top) * k, REACH_PX * k)
  }
  // Sized to the photo's width, so labels stay about 18 CSS pixels whatever the photo's resolution.
  const font = size && size.w / 22
  return (
    <div className="shot">
      {src && <img src={src} alt="" onLoad={(e) => setSize({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
      {size?.src === src && font && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} fontSize={font} onClick={onTap && tap} aria-label={`${rings.length} rings`} role="img">
          {rings.map(({ region: r, label, tone }, i) => {
            // An ellipse just outside the liquid's box, so rings on neighbouring tubes don't overlap.
            const rx = Math.max((r.x1 - r.x0) / 2 + font * 0.2, font * 0.4)
            const ry = Math.max((r.y1 - r.y0) / 2 + font * 0.2, font * 0.4)
            return (
              <g key={i} className={tone ? `ring ${tone}` : 'ring'}>
                <ellipse cx={(r.x0 + r.x1) / 2} cy={(r.y0 + r.y1) / 2} rx={rx} ry={ry} />
                <text x={(r.x0 + r.x1) / 2} y={(r.y0 + r.y1) / 2 - ry - font * 0.2}>
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
