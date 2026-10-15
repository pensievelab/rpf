// The paired comparison: the base and the candidate run on the same inputs, case by case. It is the
// test that decides "exact". Comparing failure rates of two runs on separate random draws is not.

/**
 * Per-case results as a map from case to row. A row is `{case, ok, output?, cost?, input?}`: `ok`
 * is whether the case passed; `output` what the design answered (the verdict stands in for it when
 * absent); `cost` the case's cost in units of the objective; `input` the input, or a hash of it.
 */
export function cases(rows, name = 'run') {
  const by = new Map()
  rows.forEach((r, i) => {
    if (r.case === undefined || r.case === null) throw new Error(`${name} line ${i + 1} has no "case"`)
    if (typeof r.ok !== 'boolean') throw new Error(`${name} line ${i + 1} has no "ok" (true or false)`)
    const k = String(r.case)
    if (by.has(k)) throw new Error(`${name} holds case ${k} twice`)
    by.set(k, r)
  })
  return by
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const variance = (a) => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : 0 }

/** A paired difference and its standard error, beside the standard error the two runs would have unpaired. */
function paired(pairs) {
  const n = pairs.length, b = pairs.map((p) => p[0]), c = pairs.map((p) => p[1]), d = pairs.map((p) => p[1] - p[0])
  return { n, base: mean(b), new: mean(c), diff: mean(d), se_paired: Math.sqrt(variance(d) / n), se_unpaired: Math.sqrt(variance(b) / n + variance(c) / n) }
}

/**
 * Compare two runs on the same cases. The three numbers: outputs that differ, cases wrong in only
 * one run, and differing outputs where one side is right. Exact: no case wrong in only one run, and
 * every output that differs sits on a case both runs get wrong.
 */
export function compare(base, cand) {
  const onlyBase = [...base.keys()].filter((k) => !cand.has(k)), onlyCand = [...cand.keys()].filter((k) => !base.has(k))
  if (onlyBase.length || onlyCand.length) {
    throw new Error(`not the same inputs: ${onlyBase.length} cases only in the base, ${onlyCand.length} only in the candidate (first: ${[...onlyBase, ...onlyCand].slice(0, 3).join(', ')})`)
  }
  let differ = 0, passFail = 0, failPass = 0, oneRight = 0, outputs = true
  const flips = [], costs = [], fails = []
  for (const [k, b] of base) {
    const c = cand.get(k)
    if (b.input !== undefined && c.input !== undefined && !same(b.input, c.input)) throw new Error(`case ${k} has different inputs in the two runs`)
    if (b.output === undefined || c.output === undefined) outputs = false
    const out = (r) => (b.output !== undefined && c.output !== undefined ? r.output : r.ok)
    if (!same(out(b), out(c))) { differ += 1; if (b.ok || c.ok) oneRight += 1 }
    if (b.ok && !c.ok) { passFail += 1; flips.push({ case: k, base: 'pass', new: 'fail' }) }
    if (!b.ok && c.ok) { failPass += 1; flips.push({ case: k, base: 'fail', new: 'pass' }) }
    fails.push([b.ok ? 0 : 1, c.ok ? 0 : 1])
    if (typeof b.cost === 'number' && typeof c.cost === 'number') costs.push([b.cost, c.cost])
  }
  return {
    cases: base.size,
    outputs: outputs ? 'compared' : 'the verdicts only',
    outputs_differ: differ, wrong_in_one: passFail + failPass, differ_where_one_right: oneRight,
    pass_to_fail: passFail, fail_to_pass: failPass,
    failures: { base: fails.reduce((s, f) => s + f[0], 0), new: fails.reduce((s, f) => s + f[1], 0), rate: paired(fails) },
    cost: costs.length ? paired(costs) : null,
    flips: flips.slice(0, 20),
  }
}

/**
 * The verdict. `exact` is the rule above. Where the change moves how the evaluator draws its
 * randomness, no pair of runs can align, and a control decides: the base run against itself with
 * only that randomness moved. Then the candidate is `within control` when it changes no more
 * verdicts than the control did and fails no more cases than the base.
 */
export function verdict(r, control = null) {
  if (r.wrong_in_one === 0 && r.differ_where_one_right === 0) return 'exact'
  if (control && r.wrong_in_one <= control.wrong_in_one && r.failures.new <= r.failures.base) return 'within control'
  return 'not exact'
}

export const ACCEPTED = ['exact', 'within control']
