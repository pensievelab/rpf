#!/usr/bin/env node
// rpf: the tools of recursive priced falsification, for any coding agent that can run a shell command.
import { readFileSync, existsSync, mkdirSync, writeFileSync, cpSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { missing, recall, CONTRACTS, OPTIONAL, VERDICTS } from '../src/contracts.mjs'
import { pick } from '../src/desk.mjs'
import { openLedger, openClosedList, GRADES, OUTCOMES } from '../src/record.mjs'
import { forecastBias, chanceScore, brier, roundYield, bestVersion } from '../src/score.mjs'

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
const KINDS = { scout: 'card', pricer: 'price', builder: 'build', breaker: 'break', 'red-team': 'redteam' }
const TAKES = {
  // a builder gets the design and its test, not the pricer's doubts
  builder: ['card', 'design', 'acceptance', 'model', 'premises', 'falsifier'],
  // a breaker gets the change and the claim, never the reasons
  breaker: ['card', 'base', 'new', 'switch', 'gain', 'for_breaker'],
}

const USAGE = {
  install: 'rpf install [--host claude|codex|pi|all] [--global] [--to <folder>]',
  brief: 'rpf brief --id <trial id> --role <scout|pricer|builder|breaker|red-team> --question <text> --forecast <a number, a range "a to b", or a chance> --falsifier <the result that ends it> [--chance] [--minutes 30] [--round N] [--lens <one way of looking, for a scout>] [--read a,b] [--card <card id>] [--from <report of the hop before>] [--copy a,b]',
  worker: 'rpf worker --brief <file> [--host claude|codex|pi [--host-args="<flags for the host>"] | --cmd "<command that reads the brief on stdin>"] [--minutes 30] [--out <file>]',
  check: 'rpf check <card|price|build|break|redteam> <file.json | file.jsonl> [more files]',
  recall: 'rpf recall --check <text> --evidence <text> --scope <text> --acceptance <text> [--tries-left 2]',
  desk: 'rpf desk [cards.jsonl ...] [--drop id,id] [--rate N] [--floor N] [--extra 2]',
  reopen: 'rpf reopen --direction <text, as on the list> --because <the number that reopened it>',
  trial: `rpf trial --id <id> --result <the number> --outcome <${OUTCOMES.join('|')}> [--gain N] [--worker-forecast <text>] [--family <name>] [--odds 0.3] [--round N]   |   rpf trial <trial.json>`,
  close: `rpf close --direction <text> --reason <text> --grade <${GRADES.join('|')}> --reopens-if <the number that would reopen it>`,
  round: 'rpf round --round N --version V --gain <gain kept> --tokens <tokens spent> [--note <text>]',
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
    const id = flags.id, kind = KINDS[flags.role], minutes = Number(flags.minutes ?? 30)
    const sealed = join(dir, 'briefs', `${id}.json`), text = join(dir, 'briefs', `${id}.md`)
    const report = flags.role === 'scout' ? join(dir, 'cards', `${id}.jsonl`) : join(dir, 'reports', `${id}.json`)
    if (existsSync(sealed)) fail(`brief ${id} is already written; a forecast is not changed after the fact`)
    const card = flags.card ? findCard(flags.card) : null
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
    writeFileSync(sealed, JSON.stringify({ id, round: Number(flags.round ?? 0), role: flags.role, chance: flags.chance === true || undefined, question: flags.question, forecast: { planner: flags.forecast }, falsifier: flags.falsifier, stake_minutes: minutes, card: card?.id, family: card?.family, odds: card?.odds, sealed_at: now.toISOString() }, null, 2) + '\n')
    const block = (title, x) => [title, '', '```json', JSON.stringify(x, null, 2), '```', '']
    writeFileSync(text, [
      readFileSync(join(SKILL, 'roles', `${flags.role}.md`), 'utf8').trim(), '',
      '## Your task', '', ...(flags.lens && flags.lens !== true ? [`Your lens: ${flags.lens}`] : []), `Question: ${flags.question}`, `The result that would end this line of work: ${flags.falsifier}`, '',
      ...(card ? block('The card:', card) : []),
      ...(takes ? block('Handed over by the hop before you:', takes) : []),
      '## Stake', '', `You have ${minutes} minutes. This brief was written at ${clock(now)}, so stop by about ${clock(new Date(now.getTime() + minutes * 60_000))} (\`date\` gives the time). One deliverable: the report below. If the job cannot be done as asked, say so; do not swap it for an easier one.`, '',
      '## Read only these', '', ...(list(flags.read).length ? list(flags.read).map((r) => `- ${r}`) : ['- nothing beyond this brief']), '', `Read nothing else under ${dir}, other briefs least of all.`, '',
      ...(work ? ['## Your copy', '', `Work only in ${work}. It holds your own copy of: ${list(flags.copy).join(', ')}. Leave the originals as they are.`, ''] : []),
      '## Tools', '', `\`rpf\` is \`${tool}\`, run from ${process.cwd()}, with \`--dir ${dir}\` on every call.`, '',
      '## Report', '', 'Before you run anything, write down your own forecast of the answer. It goes in the report (for a scout, a card\'s `odds` and `size` are the forecast) and in your last message.',
      flags.role === 'scout' ? `Write your cards to ${report}, one JSON object a line, then run \`${tool} check card ${report} --dir ${dir}\` and fix what it lists.`
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
    for (const s of scored) out(`${s.card.id === longShot ? 'L' : chosen.includes(s.card.id) ? '*' : ' '} ${String(s.card.id).padEnd(14)} odds ${s.odds.toFixed(2)}  size ${s.size.toFixed(1).padStart(9)}  expected ${s.expected.toFixed(1).padStart(8)}  stake ${String(s.stake).padStart(4)} min  value ${s.value.toFixed(2).padStart(8)}  ${s.card.lens}`)
    for (const r of rejected) out(`- ${String(r.card.id ?? '?').padEnd(14)} not ranked: ${r.why}`)
    // in the order of their value; the long shot (L) last
    const picked = scored.filter((s) => chosen.includes(s.card.id) && s.card.id !== longShot).map((s) => s.card.id).concat(longShot ? [longShot] : [])
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'picks.json'), JSON.stringify({ picked, long_shot: longShot, dropped, floor, ranked: scored.map((s) => ({ id: s.card.id, lens: s.card.lens, odds: s.odds, size: s.size, expected: s.expected, stake: s.stake, value: s.value })), not_ranked: rejected.map((r) => ({ id: r.card.id, why: r.why })) }, null, 2) + '\n')
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
      trial = { ...readJson(sealed), result: flags.result, outcome: flags.outcome, recorded_at: new Date().toISOString() }
      if (flags['worker-forecast']) trial.forecast.worker = flags['worker-forecast']
      if (flags.family) trial.family = flags.family
      if (flags.odds !== undefined) trial.odds = Number(flags.odds)
      if (flags.gain !== undefined) trial.gain = Number(flags.gain)
      if (flags.round !== undefined) trial.round = Number(flags.round)
    }
    out(`appended ${openLedger(join(dir, 'ledger.jsonl')).append(trial).id}`)
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
    out({
      trials: trials.length, paid: count('paid'), alive: count('alive'), dead: count('dead'),
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
      --copy gives the worker its own copy of the files it may change
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
      record a trial after you have re-run its test. paid: a gain entered the accepted design;
      alive: the idea goes on to the next hop; dead: the idea ended here. For a yes-or-no question
      the result is 1 or 0
  ${USAGE.close}
      close a direction, or park it (grade "argument"); closing one again amends it
  ${USAGE.reopen}
  rpf closed
      the closed list
  ${USAGE.round}
      record a round under the version of the workflow that ran it
  rpf contracts
      the fields of every report, the verdicts, the outcomes and the grades
  rpf score
      forecasts by role (sizes by their log error, chances by their Brier score), card odds against
      outcomes, and each version of the workflow

  every command takes --dir <folder> (default .rpf)`
if (!cmd || cmd === 'help' || cmd === '--help') { out(HELP); process.exit(0) }
if (!commands[cmd]) fail(HELP)
try { commands[cmd]() } catch (e) { fail(e.message) }
