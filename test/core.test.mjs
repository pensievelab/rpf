import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { missing, recall } from '../src/contracts.mjs'
import { familyRecord, value, pick } from '../src/desk.mjs'
import { openLedger, openClosedList } from '../src/record.mjs'
import { forecastBias, chanceScore, brier, bestVersion, number } from '../src/score.mjs'

const card = (o) => ({ id: 'c1', lens: 'ledger', claim: 'block B can be made with 2 fewer units', family: 'rewrite', size: 100, odds: 0.4, stage: 'paper', price_minutes: 20, cheapest_test: 'count B on the model', falsifier: 'under 50', files: ['src/b.rs:10'], touches_closed: 'none', premises: [{ claim: 'B is called once', checked_by: 'grep -c' }], untested_part: 'the carry', ...o })

test('a card with a field missing or a premise nobody checked goes back', () => {
  assert.deepEqual(missing('card', card()), [])
  assert.ok(missing('card', card({ falsifier: '' })).includes('falsifier'))
  assert.match(missing('card', card({ premises: [{ claim: 'x' }] })).join(' '), /premise without checked_by/)
  assert.match(missing('card', card({ odds: 40 })).join(' '), /odds/)
  assert.match(missing('price', { card: 'c1', verdict: 'alive', forecast: [1, 2], falsifier: 'f', model: 'm', premises: [], acceptance: 'a', not_checked: 'n', brief_errata: 'none' }).join(' '), /design/)
})

test('a recall has five parts and stops after its tries', () => {
  assert.equal(recall({ check: 'c', evidence: 'e', scope: 's', acceptance: 'a', triesLeft: 1 }).split('\n').length, 5)
  assert.throws(() => recall({ check: 'c', evidence: 'e', scope: 's', acceptance: 'a', triesLeft: -1 }))
})

test('the desk ranks by odds times size over stake, not by odds', () => {
  const sure = card({ id: 'sure', odds: 0.9, size: 10 })
  const large = card({ id: 'large', odds: 0.1, size: 3000 })
  const { scored } = pick([sure, large])
  assert.equal(scored[0].card.id, 'large')
  assert.equal(value(card({ size: 0, resource_units: -1 }), { rate: 600 }).size, 600)
  // with no record the odds are the scout's own; four losses of the family halve them
  assert.equal(value(card({ odds: 0.01 })).odds, 0.01)
  const lost = Array.from({ length: 4 }, () => ({ family: 'rewrite', paid: false }))
  assert.deepEqual(familyRecord([...lost, { family: 'rewrite', paid: null }], 'rewrite'), [0, 4]) // a trial still alive settles nothing
  assert.equal(value(card({ odds: 0.4 }), { trials: lost }).odds, 0.2)
})

test('the desk takes the best card of each lens, two more, and one long shot', () => {
  const cs = [
    card({ id: 'a1', lens: 'a', size: 100 }), card({ id: 'a2', lens: 'a', size: 90 }), card({ id: 'a3', lens: 'a', size: 80 }), card({ id: 'a4', lens: 'a', size: 70 }),
    card({ id: 'b1', lens: 'b', size: 5 }), card({ id: 'long', lens: 'b', odds: 0.02, size: 400, price_minutes: 600 }),
  ]
  assert.deepEqual(pick(cs).chosen, ['a1', 'b1', 'a2', 'a3', 'long'])
  // a card without a size or a lens, and a second card with a used id, are set aside with the reason
  const { chosen, rejected } = pick([...cs, card({ id: 'a1', size: 9999 }), { id: 'bare', claim: 'no lens, no size' }])
  assert.deepEqual(chosen, ['a1', 'b1', 'a2', 'a3', 'long'])
  assert.deepEqual(rejected.map((r) => r.card.id), ['a1', 'bare'])
  // under the floor nothing is picked: that is the signal to stop
  assert.deepEqual(pick([card({ id: 's', size: 2, odds: 0.5 })], { floor: 5 }).chosen, [])
})

test('the ledger is append-only and a closure carries the number that reopens it', () => {
  const d = mkdtempSync(join(tmpdir(), 'rpf-'))
  const ledger = openLedger(join(d, 'ledger.jsonl'))
  const t = { id: 't1', round: 1, role: 'pricer', question: 'q', forecast: { planner: 50, worker: 80 }, falsifier: 'under 20', stake_minutes: 30, result: 95, outcome: 'paid' }
  assert.equal(ledger.append(t).paid, true)
  assert.equal(ledger.append({ ...t, id: 't0', outcome: 'alive' }).paid, null)
  assert.throws(() => ledger.append({ ...t, id: 'tx', outcome: 'kept' }), /outcome/)
  assert.throws(() => ledger.append(t), /already/)
  assert.throws(() => ledger.append({ id: 't2' }), /needs/)
  assert.equal(ledger.trials().length, 2)
  const closed = openClosedList(join(d, 'closed.jsonl'))
  assert.throws(() => closed.close({ direction: 'x', reason: 'r', grade: 'simulation' }), /reopen/)
  assert.equal(closed.close({ direction: 'x', reason: 'too dear', grade: 'argument', reopens_if: 'the erase costs under 20' }).status, 'parked')
  assert.equal(closed.close({ direction: 'y', reason: 'counted', grade: 'simulation', reopens_if: 'a wire costs under 1' }).status, 'closed')
  // closing a direction again amends it; reopening needs the number
  closed.close({ direction: 'x', reason: 'priced', grade: 'paper price', reopens_if: 'the erase costs under 20' })
  assert.deepEqual(closed.rows().map((r) => [r.direction, r.status]), [['x', 'closed'], ['y', 'closed']])
  assert.throws(() => closed.reopen({ direction: 'x' }), /what reopened it/)
  assert.equal(closed.reopen({ direction: 'x', because: 'the erase was measured at 12' }).status, 'reopened')
  assert.match(missing('redteam', { challenges: [{ direction: 'x', conclusion_holds: true, evidence: 'recount' }], brief_errata: 'none' }).join(' '), /reason_holds/)
  assert.deepEqual(missing('redteam', { challenges: [{ direction: 'x', conclusion_holds: true, reason_holds: false, evidence: 'recount' }], brief_errata: 'none' }), [])
})

test('forecasts are scored by role and the workflow by its rounds', () => {
  const bias = forecastBias([{ forecast: { planner: '80 to 120', worker: 50 }, result: '100' }, { forecast: { planner: 200, worker: 50 }, result: 100 }, { forecast: { planner: 'three cards' }, result: 'none' }])
  assert.equal(bias.planner.n, 2)
  assert.equal(number('40 to 60'), 50)
  assert.deepEqual(['1e6', '158 million', '2.6 x 10^8', '\u22120.5', '1,200 gates'].map(number), [1e6, 158e6, 2.6e8, -0.5, 1200])
  assert.deepEqual(forecastBias([{ role: 'builder', forecast: { planner: 0.5 }, result: 1 }]).planner.n, 1) // a size of 0.5 is not a chance
  // a yes-or-no forecast is a chance: scored by Brier, and kept out of the log errors
  const yesno = [{ role: 'breaker', forecast: { planner: 0.2 }, result: 0 }, { role: 'red-team', forecast: { planner: '0.2', worker: 0.5 }, result: '1' }]
  assert.deepEqual(forecastBias(yesno), {})
  assert.equal(chanceScore(yesno).planner.n, 2)
  assert.ok(Math.abs(chanceScore(yesno).planner.brier - (0.04 + 0.64) / 2) < 1e-12)
  assert.ok(bias.planner.bias < 0 && bias.worker.bias > 0)
  assert.equal(brier([{ odds: 0.5, happened: true }, { odds: 0.5, happened: false }]), 0.25)
  const rounds = [{ version: 1, gain_kept: 100, tokens: 1e6 }, { version: 1, gain_kept: 300, tokens: 1e6 }, { version: 2, gain_kept: 900, tokens: 1e6 }]
  assert.equal(bestVersion(rounds).best.version, 1) // one round decides nothing
  assert.equal(bestVersion([...rounds, { version: 2, gain_kept: 500, tokens: 1e6 }]).best.version, 2)
})

test('the command line: init, check, desk, install', () => {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rpf.mjs')
  const d = mkdtempSync(join(tmpdir(), 'rpf-cli-'))
  const run = (...a) => execFileSync(process.execPath, [bin, ...a, '--dir', join(d, '.rpf')], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  assert.match(run('init'), /record ready/)
  writeFileSync(join(d, 'card.json'), JSON.stringify(card()))
  assert.match(run('check', 'card', join(d, 'card.json')), /complete/)
  writeFileSync(join(d, 'bad.json'), JSON.stringify(card({ falsifier: '' })))
  assert.throws(() => run('check', 'card', join(d, 'bad.json')))
  writeFileSync(join(d, '.rpf', 'cards', 's1.jsonl'), JSON.stringify(card()) + '\n' + JSON.stringify(card({ id: 'c2', size: 'big' })) + '\n')
  writeFileSync(join(d, '.rpf', 'cards', 's2.jsonl'), JSON.stringify(card({ id: 'c3', lens: 'other' })) + '\n')
  assert.throws(() => run('check', 'card', join(d, '.rpf', 'cards', 's1.jsonl')), (e) => /#1 \(c1\): complete[\s\S]*#2 \(c2\)[\s\S]*size/.test(e.stdout)) // one card a line, each checked
  assert.match(run('check', 'card', join(d, '.rpf', 'cards', 's2.jsonl')), /#1 \(c3\): complete/)
  const desk = run('desk')
  assert.match(desk, /picked: c1, c3/) // every file in cards/ is read
  assert.match(desk, /c2 +not ranked: incomplete/)
  assert.match(run('desk', '--floor', '1000'), /picked: none/)
  assert.match(run('desk', '--drop', 'c1'), /picked: c3\n/) // a card that repeats another is left out by name
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.rpf', 'picks.json'), 'utf8')).picked, ['c3']) // and the picks are on disk
  assert.throws(() => run('close', '--direction', 'x', '--reason', 'r', '--grade', 'a hunch', '--reopens-if', 'n'), (e) => /grade must be one of/.test(e.stderr) && !/at file:/.test(e.stderr))
  assert.match(readFileSync(join(d, '.rpf', 'workflow.md'), 'utf8'), /^version: 1\n\n# Recursive priced falsification/)
  run('install', '--to', join(d, 'skills'))
  assert.ok(existsSync(join(d, 'skills', 'rpf', 'SKILL.md')))
  assert.ok(existsSync(join(d, 'skills', 'rpf', 'roles', 'breaker.md')))
  // the installed skill carries its own tools and can install itself again
  const own = (...a) => execFileSync(process.execPath, [join(d, 'skills', 'rpf', 'scripts', 'rpf.mjs'), ...a, '--dir', join(d, '.rpf')], { encoding: 'utf8' })
  assert.match(own('contracts'), /brief_errata/)
  assert.match(readFileSync(own('brief', '--id', 'b1', '--role', 'scout', '--question', 'q', '--forecast', '3 cards', '--falsifier', 'none').trim(), 'utf8'), /# Scout/)
  own('install', '--to', join(d, 'again'))
  assert.ok(existsSync(join(d, 'again', 'rpf', 'scripts', 'rpf.mjs')))
})

test('a brief seals the forecast, a worker runs in its own process, a trial needs the brief', () => {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rpf.mjs')
  const d = mkdtempSync(join(tmpdir(), 'rpf-trial-'))
  const run = (...a) => execFileSync(process.execPath, [bin, ...a, '--dir', join(d, '.rpf')], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  run('init')
  assert.throws(() => run('trial', '--id', 't1', '--result', '95', '--outcome', 'paid')) // no forecast before the result
  writeFileSync(join(d, '.rpf', 'cards', 's1.jsonl'), JSON.stringify(card({ id: 'c1', family: 'rewrite', odds: 0.4 })) + '\n')
  writeFileSync(join(d, 'b.txt'), 'the block\n')
  const brief = run('brief', '--id', 't1', '--role', 'pricer', '--question', 'how many operations does block B need?', '--forecast', '40 to 60', '--falsifier', 'over 80', '--minutes=5', '--read', 'src/b.txt', '--card', 'c1', '--round', '1').trim()
  const text = readFileSync(brief, 'utf8')
  assert.match(text, /# Pricer/)
  assert.match(text, /over 80/)
  assert.match(text, /"claim": "block B can be made/) // the card is in the task, not only its id
  assert.match(text, /rpf\.mjs check price .* --dir /) // and the worker is told where the tool is, with its folder
  assert.doesNotMatch(text, /40 to 60/) // the worker never sees the planner's forecast
  assert.throws(() => run('brief', '--id', 't1', '--role', 'pricer', '--question', 'q', '--forecast', '90', '--falsifier', 'f')) // nor is it changed later
  const said = run('worker', '--brief', brief, '--cmd', 'wc -l', '--out', join(d, 'said.txt')).trim()
  assert.ok(Number(readFileSync(said, 'utf8').trim()) > 10) // the worker's process got the brief and nothing else
  assert.throws(() => run('worker', '--brief', brief, '--cmd', 'exit 3'))
  assert.match(run('trial', '--id', 't1', '--result', '52', '--outcome', 'alive', '--worker-forecast', '45 to 55'), /appended t1/)
  // a builder gets its own copy; a breaker gets the change and the claim, never the reasons
  writeFileSync(join(d, 'build.json'), JSON.stringify({ card: 'c1', status: 'accepted', base: 66, new: 52, gain: 14, surprises: 'the carry was free because of the mask', for_breaker: 'lines 3 to 5 are new' }))
  const cwd = process.cwd(); process.chdir(d)
  try {
    assert.match(readFileSync(run('brief', '--id', 't2', '--role', 'builder', '--question', 'build it', '--forecast', '52', '--falsifier', 'over 60', '--copy', 'b.txt', '--card', 'c1', '--round', '1').trim(), 'utf8'), /Work only in .*work\/t2/)
    assert.equal(readFileSync(join(d, '.rpf', 'work', 't2', 'b.txt'), 'utf8'), 'the block\n')
  } finally { process.chdir(cwd) }
  const breaker = readFileSync(run('brief', '--id', 't3', '--role', 'breaker', '--question', 'does it hold?', '--forecast', '0.1', '--falsifier', 'one failing case', '--from', join(d, 'build.json')).trim(), 'utf8')
  assert.match(breaker, /lines 3 to 5 are new/)
  assert.doesNotMatch(breaker, /because of the mask/)
  assert.match(run('trial', '--id', 't2', '--result', '52', '--outcome', 'paid', '--gain', '14', '--worker-forecast', '50'), /appended t2/)
  const rows = readFileSync(join(d, '.rpf', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(rows[0].forecast, { planner: '40 to 60', worker: '45 to 55' })
  assert.deepEqual([rows[0].stake_minutes, rows[0].family, rows[0].odds, rows[0].paid, rows[1].paid], [5, 'rewrite', 0.4, null, true])
  run('round', '--round', '1', '--version', '1', '--gain', '14', '--tokens', '200000')
  const score = JSON.parse(run('score'))
  assert.deepEqual([score.trials, score.paid, score.alive], [2, 1, 1])
  assert.equal(score.size_forecasts_by_role.planner.n, 2) // the forecasts the tools write are the ones the score reads
  assert.equal(score.rounds[0].yield_per_million_tokens, 70)
})

test('a worker on a host: the host gets its own flags, then the brief as one prompt, and its failure is shown', () => {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rpf.mjs')
  const d = mkdtempSync(join(tmpdir(), 'rpf-host-'))
  // a stand-in for a host's command line: it prints what it was given, or fails the way a signed-out host does
  mkdirSync(join(d, 'bin'))
  writeFileSync(join(d, 'bin', 'codex'), '#!/bin/sh\nif [ "$2" = "--fail" ]; then echo "not signed in"; exit 1; fi\nfor a in "$@"; do printf "[%s]\\n" "$(printf "%s" "$a" | head -1)"; done\n')
  chmodSync(join(d, 'bin', 'codex'), 0o755)
  const env = { ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}` }
  const run = (...a) => execFileSync(process.execPath, [bin, ...a, '--dir', join(d, '.rpf')], { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] })
  run('init')
  const brief = run('brief', '--id', 'w1', '--role', 'scout', '--question', 'q', '--forecast', '5', '--falsifier', 'f').trim()
  const said = run('worker', '--brief', brief, '--host', 'codex', '--host-args=--full-auto --model small').trim()
  const lines = readFileSync(said, 'utf8').trim().split('\n')
  assert.deepEqual(lines.slice(0, 4), ['[exec]', '[--full-auto]', '[--model]', '[small]'])
  assert.match(lines[4], /^\[This session started at \d\d:\d\d\. Your stake ends at \d\d:\d\d;/) // the clock starts with the session
  assert.throws(() => run('worker', '--brief', brief, '--host', 'codex', '--host-args=--fail'), (e) => /status 1: not signed in/.test(e.stderr))
  assert.throws(() => run('worker', '--brief', brief, '--host', 'nope'), (e) => /name the host/.test(e.stderr))
})

test('the example task: the seed scores 66 and a wrong program has no score', async () => {
  const { evaluate } = await import('../examples/popcount/evaluate.mjs')
  const seed = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'popcount', 'program.txt'), 'utf8')
  assert.deepEqual(evaluate(seed), { ok: true, wrong: 0, first_wrong: [], ops: 22, registers: 3, score: 66 })
  const bad = evaluate('out = x & 1')
  assert.equal(bad.score, null)
  assert.equal(bad.wrong, 254)
  assert.throws(() => evaluate('out = y + 1'))
})
