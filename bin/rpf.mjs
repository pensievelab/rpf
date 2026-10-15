#!/usr/bin/env node
// rpf: the tools of recursive priced falsification, for any coding agent that can run a shell command.
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, cpSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { missing, recall, CONTRACTS, OPTIONAL, VERDICTS, STAGES } from '../src/contracts.mjs'
import { pick } from '../src/desk.mjs'
import { openLedger, openClosedList, GRADES, OUTCOMES } from '../src/record.mjs'
import { forecastBias, chanceScore, brier, roundYield, bestVersion, recordBy } from '../src/score.mjs'
import { cases, compare, verdict, ACCEPTED } from '../src/pair.mjs'
import { unfound } from '../src/numbers.mjs'
import { parseTop, moves, margin } from '../src/frontier.mjs'

const SELF = fileURLToPath(import.meta.url)
const HERE = dirname(SELF)
// two layouts: the package (bin/, src/, skills/rpf/) and an installed skill (SKILL.md, scripts/, src/)
const INSTALLED = existsSync(join(HERE, '..', 'SKILL.md'))
const SKILL = INSTALLED ? join(HERE, '..') : join(HERE, '..', 'skills', 'rpf')
const [cmd, ...rest] = process.argv.slice(2)
const flags = {}, args = []
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) { args.push(rest[i]); continue }
  const k = rest[i].slice(2), eq = k.indexOf('=')
  // `--flag value`, or `--flag=value` for a value that itself begins with dashes
  if (eq > 0) flags[k.slice(0, eq)] = k.slice(eq + 1)
  else flags[k] = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : true
}
const dir = resolve(flags.dir ?? '.rpf')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
  try { return JSON.parse(l) } catch { throw new Error(`${p} line ${i + 1} is not one JSON object (a .jsonl file holds one object a line)`) }
}) : [])
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2))
const fail = (m) => { console.error(m); process.exit(1) }
const list = (x) => String(x ?? '').split(',').map((r) => r.trim()).filter(Boolean)
const clock = (d) => d.toTimeString().slice(0, 5)
const cardFiles = () => (existsSync(join(dir, 'cards')) ? readdirSync(join(dir, 'cards')).filter((f) => f.endsWith('.jsonl')).sort().map((f) => join(dir, 'cards', f)) : [])

// Where each host looks for skills. Codex and pi read the shared Agent Skills folder; so does any
// other host that follows that convention. `--to <folder>` installs anywhere else.
const AGENTS = { project: '.agents/skills', global: join(homedir(), '.agents', 'skills') }
const HOSTS = {
  claude: { project: '.claude/skills', global: join(homedir(), '.claude', 'skills') },
  agents: AGENTS, codex: AGENTS, pi: AGENTS,
}
// How each host starts a fresh, headless session on one prompt. `--cmd` covers every other host.
// `extra` is the host's own flags (which tools it may use, which model), placed where that host reads them.
const HEADLESS = {
  claude: (extra, prompt) => ['claude', [...extra, '-p', prompt]],
  codex: (extra, prompt) => ['codex', ['exec', ...extra, prompt]],
  pi: (extra, prompt) => ['pi', [...extra, '-p', prompt]],
}
// the report each role writes, and what it takes over from the hop before it
const KINDS = { scout: 'card', thinker: 'card', pricer: 'price', builder: 'build', breaker: 'break', 'red-team': 'redteam' }
// roles that write cards, and the role that reads no record at all
const CARD_ROLES = ['scout', 'thinker']
const TAKES = {
  // a builder gets the design and its test, not the pricer's doubts
  builder: ['card', 'design', 'acceptance', 'model', 'premises', 'falsifier'],
  // a breaker gets the change and the claim, never the reasons
  breaker: ['card', 'base', 'new', 'switch', 'gain', 'for_breaker'],
}

const USAGE = {
  install: 'rpf install [--host claude|codex|pi|all] [--global] [--to <folder>]',
  brief: `rpf brief --id <trial id> --role <${Object.keys(KINDS).join('|')}> --question <text> --forecast <a number, a range "a to b", or a chance> --falsifier <the result that ends it> [--chance] [--minutes 30] [--round N] [--lens <one way of looking, for a scout>] [--read a,b] [--card <card id>] [--from <report of the hop before>] [--copy a,b] [--family <kind of technique>] [--stage <${STAGES.join('|')}>]`,
  worker: 'rpf worker --brief <file> [--host claude|codex|pi [--host-args="<flags for the host>"] | --cmd "<command that reads the brief on stdin>"] [--minutes 30] [--out <file>]',
  check: 'rpf check <card|price|build|break|redteam> <file.json | file.jsonl> [more files]',
  recall: 'rpf recall --check <text> --evidence <text> --scope <text> --acceptance <text> [--tries-left 2]',
  desk: 'rpf desk [cards.jsonl ...] [--drop id,id] [--rate N] [--floor N] [--extra 2]',
  reopen: 'rpf reopen --direction <text, as on the list> --because <the number that reopened it>',
  trial: `rpf trial --id <id> --result <the number> --outcome <${OUTCOMES.join('|')}> [--gain N] [--worker-forecast <text>] [--family <name>] [--stage <${STAGES.join('|')}>] [--odds 0.3] [--round N] [--pair <file>] [--lesson <what was learned> [--unless <when it may not apply>]]   |   rpf trial <trial.json>`,
  close: `rpf close --direction <text> --reason <text> --grade <${GRADES.join('|')}> --reopens-if <the number that would reopen it>`,
  round: 'rpf round --round N --version V --gain <gain kept> --tokens <tokens spent> [--note <text>]',
  pair: 'rpf pair <base cases.jsonl> <new cases.jsonl> [--control <the base again, with only its randomness moved>] [--id <trial id> | --out <file>]',
  frontier: 'rpf frontier [--cmd "<command that prints the best score outside>" --better lower|higher] [--ours <our score>] [--import <reads.jsonl>] [--watch [--every 60] [--for 120]] [--json]',
  numbers: 'rpf numbers <text file> [--from <file or folder>,...] [--forbid word,word] [--min 13]',
  digest: 'rpf digest [--find <words>] [--out <file>]',
  score: 'rpf score [--by family|stage|lens|family,stage]',
}

function findCard(id) {
  for (const f of cardFiles()) for (const c of readJsonl(f)) if (c.id === id) return c
  fail(`no card ${id} in ${join(dir, 'cards')}`)
}

const commands = {
  init() {
    for (const d of ['cards', 'reports', 'briefs', 'work']) mkdirSync(join(dir, d), { recursive: true })
    for (const f of ['ledger.jsonl', 'closed.jsonl']) if (!existsSync(join(dir, f))) writeFileSync(join(dir, f), '')
    if (!existsSync(join(dir, 'rounds.json'))) writeFileSync(join(dir, 'rounds.json'), '[]\n')
    // the run's own copy of the workflow: the planner follows it and revises it; the skill stays as shipped
    const wf = join(dir, 'workflow.md')
    if (!existsSync(wf)) writeFileSync(wf, 'version: 1\n\n' + readFileSync(join(SKILL, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\n+/, ''))
    out(`record ready in ${dir}`)
  },
  install() {
    const hosts = flags.to ? [] : flags.host && flags.host !== 'all' ? [flags.host] : ['claude', 'agents']
    const targets = flags.to ? [resolve(flags.to)] : hosts.map((h) => {
      if (!HOSTS[h]) fail(`unknown host ${h}; use one of ${Object.keys(HOSTS).join(', ')}, all, or --to <folder>`)
      return flags.global ? HOSTS[h].global : resolve(HOSTS[h].project)
    })
    for (const t of new Set(targets)) {
      const to = join(t, 'rpf')
      cpSync(SKILL, to, { recursive: true })
      // the tools travel with the skill, so a host needs nothing else on its path
      if (!INSTALLED) { cpSync(SELF, join(to, 'scripts', 'rpf.mjs')); cpSync(join(HERE, '..', 'src'), join(to, 'src'), { recursive: true }) }
      out(`installed the skill in ${to}`)
    }
  },
  brief() {
    for (const k of ['id', 'role', 'question', 'forecast', 'falsifier']) if (!flags[k] || flags[k] === true) fail(USAGE.brief)
    if (!(flags.role in KINDS)) fail(`unknown role ${flags.role}; use one of ${Object.keys(KINDS).join(', ')}`)
    // a thinker starts blank: no record, no card, no report of an earlier hop, no reasons
    const blank = flags.role === 'thinker'
    if (blank) for (const k of ['read', 'card', 'from', 'copy']) if (flags[k]) fail(`a thinker reads no record: leave out --${k}, and put the goal and the evaluator in --question`)
    if (flags.stage && !STAGES.includes(flags.stage)) fail(`stage must be one of: ${STAGES.join(', ')}`)
    const id = flags.id, kind = KINDS[flags.role], minutes = Number(flags.minutes ?? 30)
    const sealed = join(dir, 'briefs', `${id}.json`), text = join(dir, 'briefs', `${id}.md`)
    const report = CARD_ROLES.includes(flags.role) ? join(dir, 'cards', `${id}.jsonl`) : join(dir, 'reports', `${id}.json`)
    if (existsSync(sealed)) fail(`brief ${id} is already written; a forecast is not changed after the fact`)
    const card = flags.card ? findCard(flags.card) : null
    const given = (k) => (flags[k] && flags[k] !== true ? flags[k] : undefined)
    const prior = flags.from ? readJson(flags.from) : null
    const takes = prior && TAKES[flags.role] ? Object.fromEntries(TAKES[flags.role].filter((k) => prior[k] !== undefined).map((k) => [k, prior[k]])) : prior
    for (const d of [sealed, report]) mkdirSync(dirname(d), { recursive: true })
    let work = null
    if (flags.copy) {
      work = join(dir, 'work', id)
      for (const p of list(flags.copy)) cpSync(resolve(p), join(work, p), { recursive: true })
    }
    const now = new Date(), tool = `node ${SELF}`
    // the planner's forecast is sealed beside the brief and never shown to the worker
    // the card's family, stage and lens travel with the trial, so the record can be read by each of them
    writeFileSync(sealed, JSON.stringify({ id, round: Number(flags.round ?? 0), role: flags.role, chance: flags.chance === true || undefined, question: flags.question, forecast: { planner: flags.forecast }, falsifier: flags.falsifier, stake_minutes: minutes, card: card?.id, family: given('family') ?? card?.family, stage: given('stage') ?? card?.stage, lens: given('lens') ?? card?.lens, size: card?.size, odds: card?.odds, sealed_at: now.toISOString() }, null, 2) + '\n')
    const block = (title, x) => [title, '', '```json', JSON.stringify(x, null, 2), '```', '']
    writeFileSync(text, [
      readFileSync(join(SKILL, 'roles', `${flags.role}.md`), 'utf8').trim(), '',
      '## Your task', '', ...(flags.lens && flags.lens !== true ? [`Your lens: ${flags.lens}`] : []), `Question: ${flags.question}`, `The result that would end this line of work: ${flags.falsifier}`, '',
      ...(card ? block('The card:', card) : []),
      ...(takes ? block('Handed over by the hop before you:', takes) : []),
      '## Stake', '', `You have ${minutes} minutes. This brief was written at ${clock(now)}, so stop by about ${clock(new Date(now.getTime() + minutes * 60_000))} (\`date\` gives the time). One deliverable: the report below. If the job cannot be done as asked, say so; do not swap it for an easier one.`, '',
      ...(blank ? ['## Read nothing', '', `Not the record under ${dir}, not the design's history, not what was tried before. Start from the question alone; that is the point of you.`, '']
        : ['## Read only these', '', ...(list(flags.read).length ? list(flags.read).map((r) => `- ${r}`) : ['- nothing beyond this brief']), '', `Read nothing else under ${dir}, other briefs least of all.`, '']),
      ...(work ? ['## Your copy', '', `Work only in ${work}. It holds your own copy of: ${list(flags.copy).join(', ')}. Leave the originals as they are.`, ''] : []),
      '## Tools', '', `\`rpf\` is \`${tool}\`, run from ${process.cwd()}, with \`--dir ${dir}\` on every call.`, '',
      '## Report', '', 'Before you run anything, write down your own forecast of the answer. It goes in the report (for a scout, a card\'s `odds` and `size` are the forecast) and in your last message.',
      CARD_ROLES.includes(flags.role) ? `Write your cards to ${report}, one JSON object a line, then run \`${tool} check card ${report} --dir ${dir}\` and fix what it lists.`
        : `Write the report as one JSON object to ${report}, then run \`${tool} check ${kind} ${report} --dir ${dir}\` and fix what it lists.`,
      'Your last message is a short summary of the report, and what was wrong in this brief.', '',
    ].join('\n'))
    out(text)
  },
  worker() {
    if (!flags.brief) fail(USAGE.worker)
    // the stake comes from the brief's own record unless given; the clock starts now, not when the brief was written
    const record = flags.brief.replace(/\.md$/, '.json')
    const minutes = Number(flags.minutes ?? (existsSync(record) ? readJson(record).stake_minutes : 30))
    const start = new Date()
    const text = `This session started at ${clock(start)}. Your stake ends at ${clock(new Date(start.getTime() + minutes * 60_000))}; the time below is when the brief was written.\n\n` + readFileSync(flags.brief, 'utf8')
    const host = flags.host ?? process.env.RPF_HOST
    const opts = { encoding: 'utf8', timeout: minutes * 60_000, maxBuffer: 64 * 1024 * 1024 }
    if (!flags.cmd && !HEADLESS[host]) fail(`name the host: --host <${Object.keys(HEADLESS).join('|')}> (or RPF_HOST), or --cmd "<command>"`)
    // a headless session can change files only if its host is told it may: pass the host's own flags for that
    const extra = String(flags['host-args'] === true ? '' : flags['host-args'] ?? process.env.RPF_HOST_ARGS ?? '').split(/\s+/).filter(Boolean)
    const r = flags.cmd ? spawnSync(flags.cmd, { ...opts, shell: true, input: text }) : spawnSync(...HEADLESS[host](extra, text), { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
    if (r.error?.code === 'ETIMEDOUT') fail(`the worker passed its stake of ${minutes} minutes and was stopped`)
    if (r.error) fail(`the worker did not start: ${r.error.message}`)
    const said = flags.out ?? flags.brief.replace(/\.md$/, '') + '.out.md'
    writeFileSync(said, r.stdout ?? '')
    out(said)
    // hosts differ in where they say what went wrong, so show the end of whichever stream has something
    if (r.status !== 0) fail(`the worker ended with status ${r.status}: ${((r.stderr ?? '').trim() || (r.stdout ?? '').trim()).slice(-400)}`)
  },
  contracts() { out({ required: CONTRACTS, optional: OPTIONAL, verdicts: VERDICTS, outcomes_of_a_trial: OUTCOMES, grades_of_a_closure: GRADES }) },
  check() {
    const [kind, ...files] = args
    if (!kind || !files.length) fail(USAGE.check)
    let bad = 0
    for (const file of files) {
      const many = file.endsWith('.jsonl'), items = many ? readJsonl(file) : [readJson(file)]
      if (!items.length) { bad += 1; out(`${file}: empty`) }
      items.forEach((item, i) => {
        const name = many ? `${file} #${i + 1}${item.id ? ` (${item.id})` : ''}` : file
        const lacks = missing(kind, item)
        if (!lacks.length) return out(`${name}: complete`)
        bad += 1
        out(`${name}:\n` + recall({ check: `the ${kind} contract`, evidence: `missing or not allowed: ${lacks.join('; ')}`, scope: 'add the missing fields; change nothing else', acceptance: `rpf check ${kind} ${file} prints "complete"`, triesLeft: Number(flags['tries-left'] ?? 2) }))
      })
    }
    if (bad) process.exit(1)
  },
  desk() {
    const files = args.length ? args : cardFiles()
    const dropped = list(flags.drop === true ? '' : flags.drop)
    const cards = files.flatMap((f) => readJsonl(f)).filter((c) => !dropped.includes(c.id))
    if (!cards.length) fail(`no cards: scouts write them to ${join(dir, 'cards')}/<brief id>.jsonl, or name the files`)
    const floor = Number(flags.floor ?? 0)
    const { chosen, scored, rejected, longShot } = pick(cards, { trials: openLedger(join(dir, 'ledger.jsonl')).trials(), rate: Number(flags.rate ?? 0), extra: Number(flags.extra ?? 2), floor })
    // the record the odds moved towards: paid of settled, for the card's family (at its stage, once that has enough)
    const rec = (s) => (s.record.settled ? `  ${s.card.family}${s.record.by === 'family' ? '' : ` at ${s.card.stage}`} paid ${s.record.paid} of ${s.record.settled}` : '')
    for (const s of scored) out(`${s.card.id === longShot ? 'L' : chosen.includes(s.card.id) ? '*' : ' '} ${String(s.card.id).padEnd(14)} odds ${s.odds.toFixed(2)}  size ${s.size.toFixed(1).padStart(9)}  expected ${s.expected.toFixed(1).padStart(8)}  stake ${String(s.stake).padStart(4)} min  value ${s.value.toFixed(2).padStart(8)}  ${s.card.lens}${rec(s)}`)
    for (const r of rejected) out(`- ${String(r.card.id ?? '?').padEnd(14)} not ranked: ${r.why}`)
    // in the order of their value; the long shot (L) last
    const picked = scored.filter((s) => chosen.includes(s.card.id) && s.card.id !== longShot).map((s) => s.card.id).concat(longShot ? [longShot] : [])
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'picks.json'), JSON.stringify({ picked, long_shot: longShot, dropped, floor, ranked: scored.map((s) => ({ id: s.card.id, lens: s.card.lens, odds: s.odds, size: s.size, expected: s.expected, stake: s.stake, value: s.value, record: s.record })), not_ranked: rejected.map((r) => ({ id: r.card.id, why: r.why })) }, null, 2) + '\n')
    out(picked.length ? `picked: ${picked.join(', ')}` : `picked: none (no card has an expected gain of ${floor} or more: stop here, or run a clean-sheet round)`)
  },
  trial() {
    // from a file, or from the sealed brief of `--id` plus the result
    let trial
    if (args[0]) {
      trial = readJson(args[0])
      // a forecast always comes before its result: a trial is recorded only against a brief written first
      if (!existsSync(join(dir, 'briefs', `${trial.id}.json`))) fail(`no brief for ${trial.id}; write the brief first (rpf brief), so that the forecast comes before the result`)
    } else {
      for (const k of ['id', 'result', 'outcome']) if (flags[k] === undefined || flags[k] === true) fail(USAGE.trial)
      const sealed = join(dir, 'briefs', `${flags.id}.json`)
      if (!existsSync(sealed)) fail(`no sealed brief for ${flags.id}; write the brief first (rpf brief), so that the forecast comes before the result`)
      trial = { ...readJson(sealed), result: flags.result, outcome: flags.outcome }
      if (flags['worker-forecast']) trial.forecast.worker = flags['worker-forecast']
      if (flags.family) trial.family = flags.family
      if (flags.stage) trial.stage = flags.stage
      if (flags.odds !== undefined) trial.odds = Number(flags.odds)
      if (flags.gain !== undefined) trial.gain = Number(flags.gain)
      if (flags.round !== undefined) trial.round = Number(flags.round)
      // a lesson goes on the trial that taught it, so it carries its evidence with it
      if (flags.lesson && flags.lesson !== true) trial.lesson = { what: flags.lesson, unless: flags.unless === true ? undefined : flags.unless }
    }
    // the clock says when, not the planner: times typed by hand were wrong too often
    trial.recorded_at = new Date().toISOString()
    if (trial.stage && !STAGES.includes(trial.stage)) fail(`stage must be one of: ${STAGES.join(', ')}`)
    // a gain enters the accepted design only on a paired comparison with the base on the same inputs
    if (trial.outcome === 'paid') {
      const file = flags.pair && flags.pair !== true ? resolve(flags.pair) : join(dir, 'pairs', `${trial.id}.json`)
      if (!existsSync(file)) fail(`a paid trial needs its paired comparison with the base on the same inputs: run rpf pair <base cases> <new cases> --id ${trial.id} (or give --pair <file>). A change that is not exact is a trade: record it as alive and put it on the operator's list`)
      const p = readJson(file)
      if (!ACCEPTED.includes(p.verdict)) fail(`the paired comparison in ${file} says "${p.verdict}": that is a trade, not a gain. Record it as alive and put it on the operator's list`)
      trial.pair = { file, verdict: p.verdict, cases: p.cases, wrong_in_one: p.wrong_in_one, cost_diff: p.cost?.diff }
    }
    out(`appended ${openLedger(join(dir, 'ledger.jsonl')).append(trial).id}`)
  },
  pair() {
    if (args.length !== 2) fail(USAGE.pair)
    const [base, cand] = args.map((f, i) => cases(readJsonl(f), `${i ? 'the candidate' : 'the base'} (${f})`))
    const r = compare(base, cand)
    const control = flags.control && flags.control !== true ? compare(base, cases(readJsonl(flags.control), `the control (${flags.control})`)) : null
    const v = verdict(r, control)
    const result = { verdict: v, ...r, control: control ? { wrong_in_one: control.wrong_in_one, pass_to_fail: control.pass_to_fail, fail_to_pass: control.fail_to_pass } : undefined, base: resolve(args[0]), new: resolve(args[1]), at: new Date().toISOString() }
    const to = flags.id && flags.id !== true ? join(dir, 'pairs', `${flags.id}.json`) : flags.out && flags.out !== true ? resolve(flags.out) : null
    if (to) { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, JSON.stringify(result, null, 2) + '\n') }
    const f = (x, d = 2) => (x == null ? '-' : Number(x).toFixed(d))
    out([
      `${r.cases} cases, same inputs; outputs: ${r.outputs}`,
      `outputs that differ ${r.outputs_differ}; cases wrong in only one ${r.wrong_in_one} (pass to fail ${r.pass_to_fail}, fail to pass ${r.fail_to_pass}); differing outputs where one side is right ${r.differ_where_one_right}`,
      `failures: base ${r.failures.base}, new ${r.failures.new}`,
      ...(r.cost ? [`cost per case: base ${f(r.cost.base)}, new ${f(r.cost.new)}, change ${f(r.cost.diff)} (standard error ${f(r.cost.se_paired, 3)} paired, ${f(r.cost.se_unpaired, 3)} if the runs were apart)`] : []),
      ...(control ? [`control (the base against itself): wrong in only one ${control.wrong_in_one}`] : []),
      `verdict: ${v}${to ? ` (written to ${to})` : ''}`,
    ].join('\n'))
    if (!ACCEPTED.includes(v)) process.exit(1)
  },
  frontier() {
    const cfgPath = join(dir, 'frontier.json'), log = join(dir, 'frontier.jsonl')
    const cfg = existsSync(cfgPath) ? readJson(cfgPath) : {}
    if (flags.cmd && flags.cmd !== true) cfg.cmd = flags.cmd
    if (flags.better && flags.better !== true) cfg.better = flags.better
    if (!cfg.cmd || !['lower', 'higher'].includes(cfg.better)) fail(`name the frontier once: ${USAGE.frontier}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
    // earlier steps of the frontier (a leaderboard's history), so the usual step is known from the first read
    if (flags.import && flags.import !== true) for (const r of readJsonl(flags.import)) appendFileSync(log, JSON.stringify({ at: new Date(r.at).toISOString(), top: Number(r.top ?? r.score), imported: true }) + '\n')
    const read = () => {
      const r = spawnSync(cfg.cmd, { shell: true, encoding: 'utf8', timeout: 120_000 })
      if (r.status !== 0) fail(`the frontier's command failed (status ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(-300)}`)
      const row = { at: new Date().toISOString(), top: parseTop(r.stdout) }
      appendFileSync(log, JSON.stringify(row) + '\n')
      return row
    }
    let now = read()
    if (flags.watch) {
      // return when the top moves (stop a paid job, rebase), or when the time is up
      const every = Number(flags.every ?? 60) * 1000, until = Date.now() + Number(flags.for ?? 120) * 60_000, first = now.top
      while (now.top === first) {
        if (Date.now() + every > until) { out(`no move in ${flags.for ?? 120} minutes: the top is still ${first} (read ${clock(new Date(now.at))})`); process.exit(2) }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, every)
        now = read()
      }
      out(`the top moved: ${first} to ${now.top} (read ${clock(new Date(now.at))})`)
    }
    const m = moves(readJsonl(log), cfg.better)
    const ours = flags.ours !== undefined && flags.ours !== true ? margin(Number(flags.ours), m.top, cfg.better, m.median_step) : null
    if (flags.json) return out({ ...m, ours })
    const pct = (x) => `${(x * 100).toFixed(3)}%`
    out([
      `top ${m.top}, read at ${clock(new Date(m.read_at))} (${m.read_at})`,
      m.steps.length ? `it last moved at ${m.steps.at(-1).at}; ${m.steps.length} moves seen, the usual step ${pct(m.median_step)}${m.median_hold_hours != null ? `, the usual hold ${m.median_hold_hours.toFixed(1)} h` : ''}` : 'no move seen yet',
      ...(ours ? [ours.ahead > 0
        ? `ours ${ours.ours}: ahead by ${pct(ours.ahead)}${ours.beats_usual_step === false ? `, under the usual step of ${pct(m.median_step)}: a margin this thin is likely gone before it lands; build a larger package before paying for a release` : ''}`
        : `ours ${ours.ours}: behind by ${pct(-ours.ahead)}`] : []),
    ].join('\n'))
  },
  numbers() {
    if (!args[0]) fail(USAGE.numbers)
    // the sources: the record, and any files or folders named
    const exts = ['.md', '.json', '.jsonl', '.txt', '.tsv', '.csv', '.out', '.log']
    const texts = []
    const take = (p) => {
      if (!existsSync(p)) return
      if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) take(join(p, f)); return }
      if (resolve(p) !== resolve(args[0]) && exts.some((e) => p.endsWith(e)) && statSync(p).size < 5e6) texts.push(readFileSync(p, 'utf8'))
    }
    for (const s of [dir, ...list(flags.from === true ? '' : flags.from)]) take(resolve(s))
    // words that must never go out: given here, or kept in the record's forbidden.txt (one a line)
    const kept = existsSync(join(dir, 'forbidden.txt')) ? readFileSync(join(dir, 'forbidden.txt'), 'utf8').split('\n') : []
    const text = readFileSync(args[0], 'utf8')
    const r = unfound(text, texts, { min: Number(flags.min ?? 13), forbid: [...kept, ...list(flags.forbid === true ? '' : flags.forbid)] })
    const lines = text.split('\n')
    out(`${r.numbers} numbers in the text; ${r.unfound.length} in no source${r.forbidden.length ? `; ${r.forbidden.length} forbidden words` : ''}`)
    for (const u of r.unfound) out(`  ${u.value.padStart(14)}  line ${u.lines.slice(0, 4).join(', ')}: ${lines[u.lines[0] - 1].trim().slice(0, 110)}`)
    for (const w of r.forbidden) out(`  forbidden "${w.word}"  line ${w.lines.slice(0, 4).join(', ')}`)
    if (r.unfound.length || r.forbidden.length) process.exit(1)
  },
  digest() {
    // a fresh planner's brief, from the record alone: facts and prices, no plan
    const trials = openLedger(join(dir, 'ledger.jsonl')).trials()
    const closed = openClosedList(join(dir, 'closed.jsonl')).rows()
    const rounds = existsSync(join(dir, 'rounds.json')) ? readJson(join(dir, 'rounds.json')) : []
    const words = String(flags.find === true ? '' : flags.find ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (x) => words.every((w) => JSON.stringify(x).toLowerCase().includes(w))
    const cell = (x) => String(x ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')
    const rate = (r) => (r.pay_rate == null ? '-' : `${r.paid} of ${r.settled}`)
    const lastRound = Math.max(0, ...trials.map((t) => Number(t.round ?? 0)))
    const top = existsSync(join(dir, 'frontier.json')) ? moves(readJsonl(join(dir, 'frontier.jsonl')), readJson(join(dir, 'frontier.json')).better) : null
    const lessons = trials.filter((t) => t.lesson && hit(t))
    const some = (lines) => (lines.length ? lines : ['- none yet'])
    const doc = [
      '# Digest of the record', '',
      `Built by \`rpf digest\` at ${new Date().toISOString()} from the files in ${dir} alone. Facts and prices, no plan: every line names the trial or closure behind it. You may disagree with any of it.`, '',
      ...(words.length ? [`Only what holds every word of: ${words.join(' ')}`, ''] : []),
      ...(!words.length && existsSync(join(dir, 'task.md')) ? ['## The task', '', readFileSync(join(dir, 'task.md'), 'utf8').trim(), ''] : []),
      ...(!words.length ? ['## Where it stands', '',
        `- ${trials.length} trials: ${trials.filter((t) => t.outcome === 'paid').length} paid, ${trials.filter((t) => t.outcome === 'alive').length} alive, ${trials.filter((t) => t.outcome === 'dead').length} dead; ${rounds.length} rounds recorded`,
        ...(rounds.length ? [`- the last round recorded (${rounds.at(-1).round}) kept ${rounds.at(-1).gain_kept}`] : []),
        ...(top ? [`- the frontier: ${top.top}, read at ${top.read_at} (read it again before you say anything about it)`] : []),
        ''] : []),
      '## What paid', '',
      ...some(trials.filter((t) => t.outcome === 'paid' && hit(t)).reverse().map((t) => `- ${t.id} (${t.family ?? '?'}, ${t.stage ?? '?'}): gain ${t.gain ?? '?'}, ${t.pair ? `pair ${t.pair.verdict}` : 'no pair'}. ${t.question}`)), '',
      ...(!words.length ? ['## The record by family and stage', '', '| family / stage | settled | paid | alive | gain | largest | results against forecasts |', '|---|---|---|---|---|---|---|',
        ...(trials.length ? [] : ['| none yet | | | | | | |']), ...recordBy(trials, ['family', 'stage']).map((r) => `| ${cell(r['family / stage'])} | ${r.settled} | ${rate(r)} | ${r.alive} | ${r.gain} | ${r.largest_gain ?? '-'} | ${r.size_bias == null ? '-' : `${Math.exp(r.size_bias).toFixed(2)} times`} |`), ''] : []),
      ...(!words.length ? ['## Forecasts by role', '', ...some(Object.entries(forecastBias(trials)).map(([role, b]) => `- ${role}: results ran ${Math.exp(b.bias).toFixed(2)} times the forecast, typically off by ${Math.exp(b.typical).toFixed(2)} times (${b.n} trials)`)), ''] : []),
      '## Closed and parked', '',
      ...some(closed.filter(hit).map((c) => `- ${c.status}: ${c.direction}. ${c.reason} (${c.grade}; reopens if ${c.reopens_if}${c.because ? `; reopened because ${c.because}` : ''})`)), '',
      '## Lessons', '',
      ...some(lessons.map((t) => `- ${t.id} (${t.family ?? t.role}, ${t.outcome}): ${t.lesson.what}${t.lesson.unless ? ` (unless ${t.lesson.unless})` : ''}`)), '',
      ...(!words.length && trials.length ? [`## Round ${lastRound}: what ended`, '', ...some(trials.filter((t) => Number(t.round ?? 0) === lastRound && t.outcome === 'dead').map((t) => `- ${t.id} (${t.role}): ${t.question} It ended on ${cell(t.result)}; the falsifier was: ${cell(t.falsifier)}`)), ''] : []),
    ].join('\n')
    const to = flags.out && flags.out !== true ? resolve(flags.out) : words.length ? null : join(dir, 'digest.md')
    if (to) writeFileSync(to, doc)
    out(doc)
  },
  close() {
    for (const k of ['direction', 'reason', 'grade', 'reopens-if']) if (!flags[k] || flags[k] === true) fail(USAGE.close)
    out(openClosedList(join(dir, 'closed.jsonl')).close({ direction: flags.direction, reason: flags.reason, grade: flags.grade, reopens_if: flags['reopens-if'] }))
  },
  closed() { out(openClosedList(join(dir, 'closed.jsonl')).rows()) },
  reopen() {
    for (const k of ['direction', 'because']) if (!flags[k] || flags[k] === true) fail(USAGE.reopen)
    out(openClosedList(join(dir, 'closed.jsonl')).reopen({ direction: flags.direction, because: flags.because }))
  },
  recall() {
    for (const k of ['check', 'evidence', 'scope', 'acceptance']) if (!flags[k] || flags[k] === true) fail(USAGE.recall)
    out(recall({ check: flags.check, evidence: flags.evidence, scope: flags.scope, acceptance: flags.acceptance, triesLeft: Number(flags['tries-left'] ?? 2) }))
  },
  round() {
    for (const k of ['round', 'version', 'gain', 'tokens']) if (flags[k] === undefined || flags[k] === true) fail(USAGE.round)
    const p = join(dir, 'rounds.json'), rounds = existsSync(p) ? readJson(p) : []
    const row = { round: Number(flags.round), version: Number.isNaN(Number(flags.version)) ? flags.version : Number(flags.version), gain_kept: Number(flags.gain), tokens: Number(flags.tokens), note: flags.note === true ? undefined : flags.note }
    const at = rounds.findIndex((r) => r.round === row.round)
    if (at >= 0) rounds[at] = row; else rounds.push(row)
    writeFileSync(p, JSON.stringify(rounds, null, 2) + '\n')
    out(row)
  },
  score() {
    const trials = openLedger(join(dir, 'ledger.jsonl')).trials()
    const rounds = existsSync(join(dir, 'rounds.json')) ? readJson(join(dir, 'rounds.json')) : []
    const count = (o) => trials.filter((t) => t.outcome === o).length
    const by = list(flags.by === true ? '' : flags.by ?? 'family')
    for (const k of by) if (!['family', 'stage', 'lens', 'role'].includes(k)) fail(USAGE.score)
    out({
      trials: trials.length, paid: count('paid'), alive: count('alive'), dead: count('dead'),
      record: recordBy(trials, by),
      size_forecasts_by_role: forecastBias(trials),
      chance_forecasts_by_role: chanceScore(trials),
      brier_of_card_odds: brier(trials.filter((t) => t.odds !== undefined && typeof t.paid === 'boolean').map((t) => ({ odds: t.odds, happened: t.paid }))),
      rounds: rounds.map((r) => ({ round: r.round, version: r.version, gain_kept: r.gain_kept, yield_per_million_tokens: roundYield(r) })),
      workflow: bestVersion(rounds),
    })
  },
}

const HELP = `rpf: the tools of recursive priced falsification

  ${USAGE.install}
      put the skill, with these tools, where your agent finds it
  rpf init
      make the record (.rpf/): the ledger, the closed list, the rounds, your copy of the workflow
  ${USAGE.brief}
      write a worker's task. Your forecast is sealed and not shown. --card puts a scout's card in it,
      --from the report of the hop before (a breaker gets the change and the claim, not the reasons),
      --copy gives the worker its own copy of the files it may change. A thinker reads no record at all
  ${USAGE.worker}
      start a worker in a fresh, headless session, stopped at its stake. A headless session may
      change files only if its host allows it: give the host's own flags in --host-args (or RPF_HOST_ARGS)
  ${USAGE.check}
      is the report complete? if not, the message that sends it back to its author
  ${USAGE.recall}
      the five-part message for any other gate that failed
  ${USAGE.desk}
      rank the cards in the files named, or every card in .rpf/cards/, by odds x size / stake, and
      pick (written to .rpf/picks.json; L marks the long shot). --drop: cards that repeat another;
      --rate: what a unit of the second resource is worth; --floor: the smallest expected gain worth a trial
  ${USAGE.trial}
      record a trial after you have re-run its test. paid: a gain entered the accepted design (it
      needs its paired comparison, from rpf pair); alive: the idea goes on to the next hop; dead: the
      idea ended here. For a yes-or-no question the result is 1 or 0. A pricer's or builder's trial
      says its family and stage. --lesson keeps what it taught, on the trial that taught it
  ${USAGE.pair}
      compare the base and the new form case by case, on the same inputs. Each file holds one JSON
      object a line: {"case", "ok", "output", "cost"}. Prints outputs that differ, cases wrong in only
      one, and differing outputs where one side is right; exact means none of the last two. --control:
      where the change moves how the evaluator draws its randomness, the base run again with only that
      moved; then it is "within control" if it changes no more verdicts and fails no more cases. Exit 0
      only when it is exact or within control. --id writes it where rpf trial looks for it
  ${USAGE.frontier}
      read the best score outside this run, with the time, and how it has moved: the usual step and
      how long a top holds. --ours: our margin, and whether it beats the usual step. --watch: return
      when the top moves (exit 0), or after --for minutes (exit 2)
  ${USAGE.numbers}
      every number in a text that no file of the record (or --from) holds, and every forbidden word
      (--forbid, or .rpf/forbidden.txt). Run it on anything that goes out
  ${USAGE.digest}
      the record for a fresh planner: what paid, the record by family and stage, forecasts, the closed
      list, lessons and what ended last round (written to .rpf/digest.md). --find: only what has the words
  ${USAGE.close}
      close a direction, or park it (grade "argument"); closing one again amends it
  ${USAGE.reopen}
  rpf closed
      the closed list
  ${USAGE.round}
      record a round under the version of the workflow that ran it
  rpf contracts
      the fields of every report, the verdicts, the outcomes and the grades
  ${USAGE.score}
      what each kind of trial has paid (by family unless --by says), forecasts by role (sizes by their
      log error, chances by their Brier score), card odds against outcomes, each version of the workflow

  every command takes --dir <folder> (default .rpf)`
if (!cmd || cmd === 'help' || cmd === '--help') { out(HELP); process.exit(0) }
if (!commands[cmd]) fail(HELP)
try { commands[cmd]() } catch (e) { fail(e.message) }
