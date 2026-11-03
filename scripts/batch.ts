// The logic behind read-runs.ts, kept apart from file IO so it can be tested.
import type { Features, Region } from '../src/lib/find'
import { readCalibrated, type Band, type Model, type RunRead, type TubeRead } from '../src/lib/readers'
import type { Role } from '../src/lib/synth'

export interface Group {
  pc: string[]
  nc: string[]
  samples: string[]
}

/**
 * Gives each named point a finder region. Pairs go nearest first across all points, so a point inside a
 * region always wins it over a point that is merely near it, whatever order the names come in. A point
 * with no free region within `reach` gets null, and the caller places a disc there.
 */
export function matchPoints(points: [number, number][], regions: Region[], reach: number): (number | null)[] {
  const pairs: { p: number; r: number; d: number }[] = []
  points.forEach(([x, y], p) =>
    regions.forEach((r, j) => {
      const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1))
      if (d <= reach) pairs.push({ p, r: j, d })
    }),
  )
  pairs.sort((a, b) => a.d - b.d || a.p - b.p)
  const of: (number | null)[] = points.map(() => null)
  const taken = new Set<number>()
  for (const { p, r } of pairs) if (of[p] === null && !taken.has(r)) (of[p] = r), taken.add(r)
  return of
}

export interface GroupedRead {
  /** Per tube: its call as a sample, or as a control in the first group that uses it. Null if in no group. */
  tubes: (TubeRead | null)[]
  /** Per tube: the groups (1-based) it belongs to. */
  groups: number[][]
  roles: (Role | null)[]
  flags: string[]
}

/**
 * Reads each group against its own controls. Groups may share controls, in the same role. A tube can be a
 * sample in only one group, and keeps one role across groups.
 */
export function readGroups(
  names: string[],
  feats: (Features | null)[],
  groups: Group[],
  model: Model,
  band: Band,
  id = 'photo',
): GroupedRead {
  const out: GroupedRead = { tubes: names.map(() => null), groups: names.map(() => []), roles: names.map(() => null), flags: [] }
  const index = (n: string, k: number) => {
    const i = names.indexOf(n)
    if (i < 0) throw new Error(`${id}: group ${k + 1} names unknown tube ${n}`)
    return i
  }
  groups.forEach((g, k) => {
    const members: [number, Role][] = [
      ...g.pc.map((n): [number, Role] => [index(n, k), 'pc']),
      ...g.nc.map((n): [number, Role] => [index(n, k), 'nc']),
      ...g.samples.map((n): [number, Role] => [index(n, k), 'sample']),
    ]
    const seen = new Set<number>()
    for (const [i, role] of members) {
      if (seen.has(i)) throw new Error(`${id}: tube ${names[i]} appears twice in group ${k + 1}`)
      seen.add(i)
      const prev = out.roles[i]
      if (prev === 'sample' && role === 'sample') throw new Error(`${id}: tube ${names[i]} is a sample in two groups`)
      if (prev && prev !== role) throw new Error(`${id}: tube ${names[i]} is a ${prev} in one group and a ${role} in another`)
    }
    const r: RunRead = readCalibrated(
      members.map(([i]) => feats[i]),
      members.map(([, role]) => role),
      model,
      band,
    )
    members.forEach(([i, role], m) => {
      out.groups[i].push(k + 1)
      out.roles[i] = role
      out.tubes[i] ??= r.tubes[m]
    })
    out.flags.push(...r.flags.map((f) => `group ${k + 1}: ${f}`))
  })
  return out
}
