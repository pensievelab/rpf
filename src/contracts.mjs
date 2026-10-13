// What each role hands to the next hop, field by field. A report with a field missing goes back
// to its author; the planner does not patch it.

export const CONTRACTS = {
  // a scout's card: one idea, priced before anything is built
  card: ['id', 'lens', 'claim', 'family', 'size', 'odds', 'stage', 'price_minutes', 'cheapest_test',
    'falsifier', 'files', 'touches_closed', 'premises', 'untested_part'],
  // a pricer's report: the cheapest test that could end the card, and a design if it lives
  price: ['card', 'verdict', 'forecast', 'falsifier', 'model', 'premises', 'acceptance', 'not_checked',
    'brief_errata'],
  // a builder's report: the change behind a switch, compared with the base on identical inputs
  build: ['card', 'status', 'base', 'new', 'switch', 'gain', 'paired_comparison', 'forecast_against_result',
    'surprises', 'for_breaker', 'not_run', 'brief_errata'],
  // a breaker's report: a fresh context that was given only the change and the claim
  break: ['card', 'verdict', 'failing_cases', 'could_not_see', 'brief_errata'],
  // a red team's report: one challenge for each closed direction it tried
  redteam: ['challenges', 'brief_errata'],
}

// fields a report may carry, and when
export const OPTIONAL = {
  card: ['resource_units (units of a second resource the idea frees or uses)'],
  price: ['design (needed when the verdict is alive: steps a builder can follow)'],
  redteam: ['cards (ideas that came up beside a challenge, each with the fields of a card)'],
}
export const VERDICTS = { price: ['alive', 'dead'], build: ['accepted', 'not accepted', 'trade'], break: ['BROKEN', 'NOT BROKEN'] }

/** The fields a report lacks, and values that are not allowed. An empty list means it may go on. */
export function missing(kind, report) {
  const fields = CONTRACTS[kind]
  if (!fields) throw new Error(`no contract named ${kind}`)
  const out = fields.filter((f) => report[f] === undefined || report[f] === null || report[f] === '')
  if (kind === 'card') {
    if (!(report.odds >= 0 && report.odds <= 1)) out.push('odds (a number from 0 to 1)')
    if (typeof report.size !== 'number') out.push('size (a number, in units of the objective)')
    for (const p of report.premises ?? []) {
      if (!p.claim || !p.checked_by) out.push(`premise without checked_by: ${p.claim ?? '?'}`)
    }
  }
  if (kind === 'price' && report.verdict === 'alive' && !report.design) out.push('design')
  if (kind === 'redteam') {
    if (!Array.isArray(report.challenges)) out.push('challenges (a list)')
    else for (const c of report.challenges) {
      const lacks = ['direction', 'evidence'].filter((f) => !c[f]).concat(['conclusion_holds', 'reason_holds'].filter((f) => typeof c[f] !== 'boolean'))
      if (lacks.length) out.push(`challenge ${c.direction ?? '?'} lacks: ${lacks.join(', ')}`)
    }
  }
  const allowed = VERDICTS[kind]
  const v = kind === 'build' ? report.status : report.verdict
  if (allowed && v !== undefined && !allowed.includes(v)) out.push(`${kind === 'build' ? 'status' : 'verdict'} must be one of: ${allowed.join(', ')}`)
  return out
}

/** The message that sends a report back to the worker that owns it: the same five parts every time. */
export function recall({ check, evidence, scope, acceptance, triesLeft = 2 }) {
  if (triesLeft < 0) throw new Error('no tries left: stop the worker and send a narrower job to a new one')
  return [
    `The check that failed: ${check}`,
    `The evidence: ${evidence}`,
    `Fix only this: ${scope}`,
    `It is accepted when: ${acceptance} (run by a command you do not control)`,
    `Tries left: ${triesLeft}`,
  ].join('\n')
}
