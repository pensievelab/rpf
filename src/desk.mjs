// The desk: a script, not an agent. It ranks cards by expected gain per unit of stake and picks.
import { missing } from './contracts.mjs'

/**
 * How this family's trials have ended so far: [paid, settled]. Trials still alive are not counted.
 * With a stage, only the family's trials at that stage: a first build and a paper price of the same
 * kind of idea pay at different rates.
 */
export function familyRecord(trials, family, stage) {
  let paid = 0, n = 0
  for (const t of trials) if (t.family === family && (stage === undefined || t.stage === stage) && typeof t.paid === 'boolean') { n += 1; paid += t.paid ? 1 : 0 }
  return [paid, n]
}

/**
 * The record a card's odds move towards: the family at the card's stage once that holds
 * `minByStage` settled trials, else the family as a whole.
 */
export function cardRecord(trials, card, minByStage = 3) {
  const staged = familyRecord(trials, card.family, card.stage)
  return staged[1] >= minByStage ? { by: 'family and stage', record: staged } : { by: 'family', record: familyRecord(trials, card.family) }
}

/**
 * Odds times size over stake. The odds start as the scout's and move towards the record as it
 * grows: the scout's figure counts as much as `weight` settled trials. With no record the odds are
 * the scout's own. `rate` is the exchange rate of the objective: what one unit of the second
 * resource is worth in units of the first (for a score that is a product T x Q it is T / Q).
 */
export function value(card, { trials = [], rate = 0, weight = 4 } = {}) {
  const { by, record: [paid, n] } = cardRecord(trials, card)
  const odds = (weight * Number(card.odds ?? 0) + paid) / (weight + n)
  const size = Number(card.size ?? 0) + rate * Math.abs(Number(card.resource_units ?? 0))
  const stake = Math.max(Number(card.price_minutes ?? 10), 1)
  return { odds, size, stake, expected: odds * size, value: (odds * size) / stake, record: { by, paid, settled: n } }
}

/**
 * The best card of each lens, then `extra` more by value, then one long shot: the largest of the
 * unlikely. Cards that fail their contract, or repeat an id, are set aside with the reason. A card
 * whose expected gain is under `floor` is ranked but not picked; a long shot needs a size above it.
 */
export function pick(cards, { trials = [], rate = 0, extra = 2, longShotOdds = 0.2, floor = 0, weight = 4 } = {}) {
  const rejected = [], good = [], ids = new Set()
  for (const card of cards) {
    const lacks = missing('card', card)
    if (lacks.length) rejected.push({ card, why: `incomplete: ${lacks.join('; ')}` })
    else if (ids.has(card.id)) rejected.push({ card, why: 'an earlier card has this id' })
    else { ids.add(card.id); good.push(card) }
  }
  const scored = good.map((card) => ({ card, ...value(card, { trials, rate, weight }) })).sort((a, b) => b.value - a.value)
  const open = scored.filter((s) => s.expected >= floor && s.expected > 0)
  const lenses = [...new Set(open.map((s) => s.card.lens))].sort()
  const chosen = []
  for (const lens of lenses) chosen.push(open.find((s) => s.card.lens === lens).card.id)
  for (const s of open) {
    if (chosen.length >= lenses.length + extra) break
    if (!chosen.includes(s.card.id)) chosen.push(s.card.id)
  }
  const long = scored.filter((s) => s.odds < longShotOdds && s.size >= floor && s.size > 0 && !chosen.includes(s.card.id)).sort((a, b) => b.size - a.size)
  const longShot = long.length ? long[0].card.id : null
  if (longShot) chosen.push(longShot)
  return { chosen, scored, rejected, longShot }
}
