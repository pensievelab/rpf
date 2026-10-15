import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { missing, recall } from '../src/contracts.mjs'
import { familyRecord, cardRecord, value, pick } from '../src/desk.mjs'
import { openLedger, openClosedList } from '../src/record.mjs'
import { forecastBias, chanceScore, brier, bestVersion, number, recordBy } from '../src/score.mjs'
import { cases, compare, verdict } from '../src/pair.mjs'
import { unfound } from '../src/numbers.mjs'
import { parseTop, moves, margin } from '../src/frontier.mjs'

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
  const t = { id: 't1', round: 1, role: 'pricer', question: 'q', forecast: { planner: 50, worker: 80 }, falsifier: 'under 20', stake_minutes: 30, result: 95, outcome: 'paid', family: 'rewrite', stage: 'paper' }
  // a trial that seeks a gain says its family and stage, so the record can set the next odds
  assert.throws(() => ledger.append({ ...t, family: undefined }), /family/)
  assert.throws(() => ledger.append({ ...t, stage: undefined, role: 'builder' }), /stage/)
  assert.throws(() => ledger.append({ ...t, lesson: { unless: 'x' } }), /lesson/)
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
  // a paid trial needs its paired comparison with the base on the same inputs
  assert.throws(() => run('trial', '--id', 't2', '--result', '52', '--outcome', 'paid', '--gain', '14'), (e) => /paired comparison/.test(e.stderr))
  const rows66 = Array.from({ length: 4 }, (_, i) => ({ case: i, ok: true, output: i, cost: 66 }))
  writeFileSync(join(d, 'base.jsonl'), rows66.map((r) => JSON.stringify(r)).join('\n') + '\n')
  writeFileSync(join(d, 'new.jsonl'), rows66.map((r) => JSON.stringify({ ...r, cost: 52 })).join('\n') + '\n')
  assert.match(run('pair', join(d, 'base.jsonl'), join(d, 'new.jsonl'), '--id', 't2'), /verdict: exact/)
  assert.match(run('trial', '--id', 't2', '--result', '52', '--outcome', 'paid', '--gain', '14', '--worker-forecast', '50', '--lesson', 'the mask makes the carry free', '--unless', 'the mask is wider than 8 bits'), /appended t2/)
  const rows = readFileSync(join(d, '.rpf', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(rows[0].forecast, { planner: '40 to 60', worker: '45 to 55' })
  assert.deepEqual([rows[0].stake_minutes, rows[0].family, rows[0].stage, rows[0].lens, rows[0].odds, rows[0].paid, rows[1].paid], [5, 'rewrite', 'paper', 'ledger', 0.4, null, true])
  assert.deepEqual([rows[1].pair.verdict, rows[1].pair.cost_diff, rows[1].lesson.unless], ['exact', -14, 'the mask is wider than 8 bits'])
  assert.ok(Date.now() - new Date(rows[1].recorded_at) < 60_000) // the clock stamps it, not the planner
  run('round', '--round', '1', '--version', '1', '--gain', '14', '--tokens', '200000')
  const score = JSON.parse(run('score'))
  assert.deepEqual([score.trials, score.paid, score.alive], [2, 1, 1])
  assert.deepEqual(score.record.map((r) => [r.family, r.settled, r.paid, r.alive, r.gain]), [['rewrite', 1, 1, 1, 14]])
  assert.equal(JSON.parse(run('score', '--by', 'family,stage')).record[0]['family / stage'], 'rewrite / paper')
  // a fresh planner's digest comes from the record alone
  const digest = run('digest')
  assert.match(digest, /## What paid\n\n- t2 \(rewrite, paper\): gain 14, pair exact/)
  assert.match(digest, /\| rewrite \/ paper \| 1 \| 1 of 1 \| 1 \| 14 \|/)
  assert.match(digest, /- t2 \(rewrite, paid\): the mask makes the carry free \(unless the mask is wider than 8 bits\)/)
  assert.ok(existsSync(join(d, '.rpf', 'digest.md')))
  assert.match(run('digest', '--find', 'MASK'), /the mask makes the carry free/)
  assert.doesNotMatch(run('digest', '--find', 'nothing like it'), /mask/)
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
  const { cases: perCase, ...summary } = evaluate(seed)
  assert.deepEqual(summary, { ok: true, wrong: 0, first_wrong: [], ops: 22, registers: 3, score: 66 })
  assert.deepEqual([perCase.length, perCase[255]], [256, { case: 255, ok: true, output: 8, cost: 66 }])
  const bad = evaluate('out = x & 1')
  assert.equal(bad.score, null)
  assert.equal(bad.wrong, 254)
  assert.throws(() => evaluate('out = y + 1'))
})

test('a paired comparison decides exact: the three numbers, and a control where nothing aligns', () => {
  const run = (ok, out = ok.map((o, i) => (o ? i : -1))) => cases(ok.map((o, i) => ({ case: i, ok: o, output: out[i], cost: 10 })))
  const base = run([true, true, false, false])
  // the same verdicts, and the outputs differ only where both runs are wrong: exact
  const same = compare(base, run([true, true, false, false], [0, 1, 7, 9]))
  assert.deepEqual([same.outputs_differ, same.wrong_in_one, same.differ_where_one_right, verdict(same)], [2, 0, 0, 'exact'])
  // a case that passed now fails: not exact, whatever it saves
  const worse = compare(base, run([true, false, true, false]))
  assert.deepEqual([worse.pass_to_fail, worse.fail_to_pass, worse.wrong_in_one, verdict(worse)], [1, 1, 2, 'not exact'])
  // the base against itself with only its randomness moved changed as many verdicts: within control,
  // but only while it fails no more cases than the base
  const control = compare(base, run([false, true, true, false]))
  assert.equal(verdict(worse, control), 'within control')
  assert.equal(verdict(compare(base, run([false, false, true, false])), control), 'not exact')
  // without outputs the verdicts stand in for them
  const bare = compare(cases([{ case: 'a', ok: true }]), cases([{ case: 'a', ok: true }]))
  assert.deepEqual([bare.outputs, verdict(bare)], ['the verdicts only', 'exact'])
  // the cost change is paired; two separate draws would carry the spread of both
  const c = compare(cases([1, 5, 9].map((x, i) => ({ case: i, ok: true, cost: x }))), cases([0, 4, 8].map((x, i) => ({ case: i, ok: true, cost: x }))))
  assert.deepEqual([c.cost.diff, c.cost.se_paired], [-1, 0])
  assert.ok(c.cost.se_unpaired > 3)
  assert.throws(() => compare(base, run([true, true, false])), /not the same inputs/)
  assert.throws(() => compare(cases([{ case: 1, ok: true, input: 'x' }]), cases([{ case: 1, ok: true, input: 'y' }])), /different inputs/)
  assert.throws(() => cases([{ case: 1 }]), /"ok"/)
})

test('numbers that go out are found in the record, and forbidden words are caught', () => {
  const r = unfound('Gain 1,236.50 of 70.8%, in 9 rounds of 2026; the top 940337645 and 4417.\nNamed Rival here.', ['{"gain": 1236.5, "share": 70.8}', 'top 940,337,645'], { forbid: ['rival'] })
  assert.deepEqual(r.unfound, [{ value: '4417', lines: [1] }]) // small counts and years are skipped; 1,236.50 is 1236.5
  assert.deepEqual(r.forbidden, [{ word: 'rival', lines: [2] }])
})

test('the frontier: the top, its usual step and hold, and whether our margin beats it', () => {
  assert.equal(parseTop('{"top": 940337645}'), 940337645)
  assert.equal(parseTop('best: 1,236 (by someone)\nmore'), 1236)
  assert.throws(() => parseTop('nothing here'), /no number/)
  const reads = [['2026-10-13T00:00:00Z', 1000], ['2026-10-13T02:00:00Z', 990], ['2026-10-13T03:00:00Z', 990], ['2026-10-13T06:00:00Z', 985], ['2026-10-13T07:00:00Z', 991]].map(([at, top]) => ({ at, top }))
  const m = moves(reads, 'lower')
  assert.deepEqual([m.top, m.steps.length, m.median_hold_hours, m.since], [985, 2, 3, '2026-10-13T06:00:00.000Z']) // a worse read is not a move
  assert.ok(Math.abs(m.median_step - (0.01 + 5 / 990) / 2) < 1e-12)
  assert.equal(margin(984, 985, 'lower', m.median_step).beats_usual_step, false)
  assert.equal(margin(970, 985, 'lower', m.median_step).beats_usual_step, true)
  assert.ok(margin(990, 985, 'lower').ahead < 0)
})

test('the command line: pair, numbers, frontier, a thinker, and odds from the record by stage', () => {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rpf.mjs')
  const d = mkdtempSync(join(tmpdir(), 'rpf-new-'))
  const run = (...a) => execFileSync(process.execPath, [bin, ...a, '--dir', join(d, '.rpf')], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  run('init')
  // the example's evaluator gives one line a case, so two programs pair on the same 256 inputs
  const ex = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'popcount')
  const evalCases = (prog) => execFileSync(process.execPath, [join(ex, 'evaluate.mjs'), prog, '--cases'], { encoding: 'utf8' })
  writeFileSync(join(d, 'base.jsonl'), evalCases(join(ex, 'program.txt')))
  writeFileSync(join(d, 'wrong.txt'), 'out = x & 1\n')
  writeFileSync(join(d, 'wrong.jsonl'), evalCases(join(d, 'wrong.txt')))
  assert.match(run('pair', join(d, 'base.jsonl'), join(d, 'base.jsonl')), /256 cases[\s\S]*verdict: exact/)
  assert.throws(() => run('pair', join(d, 'base.jsonl'), join(d, 'wrong.jsonl'), '--id', 'w'), (e) => /pass to fail 254/.test(e.stdout) && /verdict: not exact/.test(e.stdout))
  assert.equal(JSON.parse(readFileSync(join(d, '.rpf', 'pairs', 'w.json'), 'utf8')).verdict, 'not exact')
  // a trial whose pair is not exact is a trade, not a gain
  writeFileSync(join(d, '.rpf', 'cards', 's.jsonl'), JSON.stringify(card({ id: 'k' })) + '\n')
  run('brief', '--id', 'w', '--role', 'builder', '--question', 'q', '--forecast', '52', '--falsifier', 'f', '--card', 'k')
  assert.throws(() => run('trial', '--id', 'w', '--result', '3', '--outcome', 'paid'), (e) => /that is a trade/.test(e.stderr))
  // numbers in a note that no file of the record holds, and words that must not go out
  writeFileSync(join(d, 'note.md'), 'The score fell from 66 to 4417 points.\nThanks to Rival.\n')
  writeFileSync(join(d, '.rpf', 'forbidden.txt'), 'rival\n')
  assert.throws(() => run('numbers', join(d, 'note.md'), '--from', join(d, 'base.jsonl')), (e) => /4417 +line 1/.test(e.stdout) && !/ 66 +line/.test(e.stdout) && /forbidden "rival"/.test(e.stdout))
  // the frontier through the task's own command: it moves on the third read
  writeFileSync(join(d, 'board.mjs'), "import { readFileSync, writeFileSync, existsSync } from 'node:fs'\nconst f = process.argv[2], n = existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0\nwriteFileSync(f, String(n + 1))\nconsole.log(JSON.stringify({ top: n < 2 ? 1000 : 990 }))\n")
  const cmd = `"${process.execPath}" "${join(d, 'board.mjs')}" "${join(d, 'reads.txt')}"`
  assert.throws(() => run('frontier'), (e) => /name the frontier once/.test(e.stderr))
  assert.match(run('frontier', '--cmd', cmd, '--better', 'lower'), /top 1000, read at \d\d:\d\d[\s\S]*no move seen yet/)
  assert.match(run('frontier', '--watch', '--every', '0.05', '--for', '1', '--ours', '989'), /the top moved: 1000 to 990[\s\S]*1 moves seen, the usual step 1\.000%[\s\S]*ours 989: ahead by 0\.101%, under the usual step/)
  assert.deepEqual(JSON.parse(run('frontier', '--json')).top, 990)
  // a thinker reads no record
  assert.throws(() => run('brief', '--id', 'th', '--role', 'thinker', '--question', 'q', '--forecast', '0', '--falsifier', 'f', '--read', 'x'), (e) => /reads no record/.test(e.stderr))
  const thinker = readFileSync(run('brief', '--id', 'th', '--role', 'thinker', '--question', 'beat 66', '--forecast', '0', '--falsifier', 'f').trim(), 'utf8')
  assert.match(thinker, /# Thinker[\s\S]*## Read nothing[\s\S]*cards\/th\.jsonl/)
  assert.doesNotMatch(thinker, /## Read only these/)
})

test('odds move towards the family at the card\'s stage once it has a record, else the family', () => {
  const t = (stage, paid) => ({ family: 'rewrite', stage, paid })
  const trials = [t('build', true), t('build', true), t('build', true), t('paper', false), t('paper', false)]
  assert.deepEqual(cardRecord(trials, card({ stage: 'build' })), { by: 'family and stage', record: [3, 3] })
  assert.deepEqual(cardRecord(trials, card({ stage: 'paper' })), { by: 'family', record: [3, 5] }) // two settled at that stage is not enough
  assert.equal(value(card({ stage: 'build', odds: 0.4 }), { trials }).odds, (4 * 0.4 + 3) / 7)
  assert.deepEqual(familyRecord(trials, 'rewrite', 'paper'), [0, 2])
  const rec = recordBy([{ family: 'a', stage: 'build', paid: true, gain: 5, forecast: { planner: 10 }, result: 20 }, { family: 'a', stage: 'paper', paid: null }], ['family'])
  assert.deepEqual([rec[0].settled, rec[0].paid, rec[0].alive, rec[0].largest_gain, Math.exp(rec[0].size_bias)], [1, 1, 1, 5, 2])
  assert.match(missing('card', card({ stage: 'hunch' })).join(' '), /stage/)
})
