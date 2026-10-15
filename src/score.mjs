// Scoring: the planner and the workers by their forecasts, and the loop's own text by its rounds.

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length

/** A forecast or a result as one number: `52`, `"52"`, or a range such as `"40 to 60"` at its midpoint. */
export function number(x) {
  if (typeof x === 'number') return x
  if (Array.isArray(x) && x.length === 2) return (number(x[0]) + number(x[1])) / 2
  const text = String(x ?? '').replace(/,/g, '').replace(/\u2212/g, '-').replace(/\s*[x\u00d7*]\s*10\^\s*(-?\d+)/gi, 'e$1')
  const scale = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, bn: 1e9 }
  const found = [...text.matchAll(/(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*(thousand|million|billion|bn|k|m)?\b/gi)]
    .map((m) => Number(m[1]) * (scale[(m[2] ?? '').toLowerCase()] ?? 1))
  if (!found.length) return NaN
  return /\bto\b|\u2013|\.\./.test(text) && found.length >= 2 ? (found[0] + found[1]) / 2 : found[0]
}

// a forecast of a yes-or-no question is a chance, and its result is 1 or 0
// (a breaker's or a red team's trial, or one whose brief was written with --chance)
const isChance = (t, forecast, result) => forecast >= 0 && forecast <= 1 && (result === 0 || result === 1) &&
  (t.chance === true || ['breaker', 'red-team'].includes(t.role))

/** Mean log error of forecasts of a size against results, by role. Above zero: results were larger than forecast. */
export function forecastBias(trials) {
  const by = {}
  for (const t of trials) {
    const result = number(t.result)
    for (const [role, f] of Object.entries(t.forecast ?? {})) {
      const forecast = number(f)
      if (isChance(t, forecast, result) || !(forecast > 0) || !(result > 0)) continue
      ;(by[role] ??= []).push(Math.log(result / forecast))
    }
  }
  return Object.fromEntries(Object.entries(by).map(([role, e]) => [role, { n: e.length, bias: mean(e), typical: mean(e.map(Math.abs)) }]))
}

/** Brier score of the chances each role gave to yes-or-no questions; a coin scores 0.25. */
export function chanceScore(trials) {
  const by = {}
  for (const t of trials) {
    const result = number(t.result)
    for (const [role, f] of Object.entries(t.forecast ?? {})) {
      const forecast = number(f)
      if (isChance(t, forecast, result)) (by[role] ??= []).push((forecast - result) ** 2)
    }
  }
  return Object.fromEntries(Object.entries(by).map(([role, e]) => [role, { n: e.length, brier: mean(e) }]))
}

/** Brier score of stated chances; a coin scores 0.25. */
export function brier(pairs) {
  const p = pairs.filter((x) => typeof x.happened === 'boolean' && x.odds >= 0 && x.odds <= 1)
  return p.length ? mean(p.map((x) => (x.odds - (x.happened ? 1 : 0)) ** 2)) : null
}

/**
 * What each kind of trial has paid so far, computed from the ledger and never kept by hand: by
 * family, by stage, by lens, or by several at once (`['family', 'stage']`). Settled trials are the
 * paid and the dead; a trial still alive settles nothing. `size_bias` is how results ran against the
 * planner's forecasts, as a log ratio (above zero: larger than forecast).
 */
export function recordBy(trials, keys = ['family']) {
  const by = new Map()
  for (const t of trials) {
    const name = keys.map((k) => t[k] ?? '(none)').join(' / ')
    if (!by.has(name)) by.set(name, [])
    by.get(name).push(t)
  }
  return [...by].map(([name, ts]) => {
    const settled = ts.filter((t) => typeof t.paid === 'boolean'), paid = settled.filter((t) => t.paid)
    const gains = paid.map((t) => Number(t.gain ?? 0)).filter(Number.isFinite)
    const logs = ts.filter((t) => !isChance(t, number(t.forecast?.planner), number(t.result)))
      .map((t) => [number(t.forecast?.planner), number(t.result)]).filter(([f, r]) => f > 0 && r > 0).map(([f, r]) => Math.log(r / f))
    return {
      [keys.join(' / ')]: name, trials: ts.length, settled: settled.length, paid: paid.length, alive: ts.length - settled.length,
      pay_rate: settled.length ? paid.length / settled.length : null,
      gain: gains.reduce((s, x) => s + x, 0), largest_gain: gains.length ? Math.max(...gains) : null,
      size_bias: logs.length ? mean(logs) : null,
    }
  }).sort((a, b) => b.gain - a.gain || b.settled - a.settled)
}

/** A round's yield: exact gain kept for each million tokens spent. Trades and pending gains count 0. */
export function roundYield(round) {
  return round.tokens > 0 ? (round.gain_kept / round.tokens) * 1e6 : null
}

/**
 * The loop's text is a trial too. A new version becomes the best one only when its yield over two
 * rounds or more is above the best one's; until then its changes stay trials. One round decides nothing.
 */
export function bestVersion(rounds, { minRounds = 2 } = {}) {
  const by = {}
  for (const r of rounds) {
    if (r.gain_kept == null || !(r.tokens > 0)) continue
    const v = (by[r.version] ??= { version: r.version, rounds: 0, gain: 0, tokens: 0 })
    v.rounds += 1; v.gain += r.gain_kept; v.tokens += r.tokens
  }
  const scored = Object.values(by).map((v) => ({ ...v, yield: (v.gain / v.tokens) * 1e6 }))
  const eligible = scored.filter((v) => v.rounds >= minRounds).sort((a, b) => b.yield - a.yield)
  return { best: eligible[0] ?? null, versions: scored }
}
