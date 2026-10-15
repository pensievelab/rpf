// The frontier: the best score outside this run (a public leaderboard, a rival's release, the state
// of the art). Read it before every round and before every statement about it; it moves while you work.
import { number } from './score.mjs'

/** The top from what the frontier's command printed: JSON with `top` or `score`, or the first number. */
export function parseTop(stdout) {
  const text = String(stdout ?? '').trim()
  try {
    const j = JSON.parse(text)
    const v = typeof j === 'number' ? j : Number(j?.top ?? j?.score)
    if (Number.isFinite(v)) return v
  } catch { /* not JSON: read the first number */ }
  const v = number(text.split('\n')[0])
  if (!Number.isFinite(v)) throw new Error(`the frontier's command printed no number: ${text.slice(0, 120) || '(nothing)'}`)
  return v
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

/**
 * What the frontier's history says: its moves (each step as a share of the top it replaced), how long
 * a top has held, and how long the present one has. `rows` are reads `{at, top}` in any order.
 */
export function moves(rows, better = 'lower') {
  const reads = rows.filter((r) => Number.isFinite(Number(r.top)) && r.at).map((r) => ({ at: new Date(r.at), top: Number(r.top) })).sort((a, b) => a.at - b.at)
  if (!reads.length) return null
  const gain = (from, to) => (better === 'lower' ? (from - to) / from : (to - from) / from)
  const steps = [], holds = []
  let top = reads[0], since = reads[0].at
  for (const r of reads.slice(1)) {
    if (gain(top.top, r.top) > 0) {
      steps.push({ at: r.at.toISOString(), from: top.top, to: r.top, step: gain(top.top, r.top) })
      holds.push((r.at - since) / 3.6e6)
      top = r; since = r.at
    }
  }
  const last = reads[reads.length - 1]
  return { top: top.top, since: since.toISOString(), read_at: last.at.toISOString(), steps, median_step: median(steps.map((s) => s.step)), median_hold_hours: median(holds) }
}

/** Our score against the top: the share by which we are ahead (above zero) or behind, and whether it beats a usual step. */
export function margin(ours, top, better = 'lower', usualStep = null) {
  const ahead = better === 'lower' ? (top - ours) / top : (ours - top) / top
  return { ours, top, ahead, beats_usual_step: usualStep == null ? null : ahead >= usualStep }
}
