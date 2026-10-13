// The shared record: outside every session, append-only, the only memory the loop needs.
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const TRIAL = ['id', 'round', 'role', 'question', 'forecast', 'falsifier', 'stake_minutes', 'result', 'outcome']
// how a trial ended: a gain entered the accepted design; the idea goes on to the next hop; the idea ended here
export const OUTCOMES = ['paid', 'alive', 'dead']

function readLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}
function append(path, row) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(row) + '\n')
}

/** A ledger of trials. A trial is written once, after the planner has re-run the test behind the claim. */
export function openLedger(path) {
  return {
    path,
    trials: () => readLines(path),
    append(trial) {
      const lacks = TRIAL.filter((f) => trial[f] === undefined)
      if (lacks.length) throw new Error(`a trial needs: ${lacks.join(', ')}`)
      if (!OUTCOMES.includes(trial.outcome)) throw new Error(`outcome must be one of: ${OUTCOMES.join(', ')}`)
      if (readLines(path).some((t) => t.id === trial.id)) throw new Error(`trial ${trial.id} is already in the ledger`)
      // `paid` settles an idea for the record by family; a trial that is still alive settles nothing
      const row = { ...trial, kept: trial.outcome === 'paid', paid: trial.outcome === 'alive' ? null : trial.outcome === 'paid' }
      append(path, row)
      return row
    },
  }
}

// the grades of the paper, weakest first
export const GRADES = ['argument', 'paper price', 'simulation', 'measurement', 'exhaustive search', 'proof']

/**
 * The closed list. A direction is closed only with the grade of its evidence and the number that
 * would reopen it. A direction dropped by argument alone is parked, not closed.
 */
export function openClosedList(path) {
  return {
    path,
    // the file is append-only; the list is the last row of each direction, so closing one again amends it
    rows: () => [...new Map(readLines(path).map((r) => [r.direction, r])).values()],
    reopen({ direction, because }) {
      const prev = this.rows().find((r) => r.direction === direction)
      if (!prev) throw new Error(`no direction named "${direction}" on the closed list`)
      if (!because) throw new Error('say what reopened it: the number, and where it was measured')
      const row = { ...prev, status: 'reopened', because }
      append(path, row)
      return row
    },
    close({ direction, reason, grade, reopens_if }) {
      if (!GRADES.includes(grade)) throw new Error(`grade must be one of: ${GRADES.join(', ')}`)
      if (!reopens_if) throw new Error('a closure carries the number that would reopen it')
      const row = { direction, reason, grade, reopens_if, status: grade === 'argument' ? 'parked' : 'closed' }
      append(path, row)
      return row
    },
  }
}
