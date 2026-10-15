#!/usr/bin/env node
// The evaluator of the example task. It is exact: every one of the 256 inputs is run.
//   node evaluate.mjs [program.txt]
// A program is a list of lines `name = a OP b`, `name = ~a` or `name = a`. Operands are names or
// whole numbers (0x.. allowed); values are 8 bits. The input is `x`; the answer is read from `out`.
// Score = operations x registers, lower is better. A line with an operator is one operation;
// constants and plain copies are free. A register is a distinct name, `x` and `out` included.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OPS = { '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b, '+': (a, b) => a + b, '-': (a, b) => a - b, '>>': (a, b) => a >> b, '<<': (a, b) => a << b }
const NAME = /^[a-z_][a-z0-9_]*$/i, NUM = /^(0x[0-9a-f]+|\d+)$/i

export function parse(text) {
  const lines = []
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const m = line.match(/^(\S+)\s*=\s*(.+)$/)
    if (!m || !NAME.test(m[1])) throw new Error(`line ${i + 1}: expected "name = ..."`)
    const t = m[2].trim().split(/\s+/)
    const operand = (s) => { if (!NAME.test(s) && !NUM.test(s)) throw new Error(`line ${i + 1}: bad operand ${s}`); return s }
    if (t.length === 1 && t[0].startsWith('~')) lines.push({ to: m[1], op: '~', a: operand(t[0].slice(1)) })
    else if (t.length === 1) lines.push({ to: m[1], op: null, a: operand(t[0]) })
    else if (t.length === 3 && OPS[t[1]]) lines.push({ to: m[1], op: t[1], a: operand(t[0]), b: operand(t[2]) })
    else throw new Error(`line ${i + 1}: expected "a OP b" with OP one of ${Object.keys(OPS).join(' ')}, "~a" or "a"`)
  }
  return lines
}

export function evaluate(text) {
  const lines = parse(text)
  const names = new Set(['x', 'out'])
  for (const l of lines) for (const s of [l.to, l.a, l.b]) if (s !== undefined && NAME.test(s)) names.add(s)
  const wrong = [], cases = []
  for (let x = 0; x < 256; x++) {
    const reg = { x }
    const val = (s) => {
      if (NUM.test(s)) return Number(s) & 255
      if (!(s in reg)) throw new Error(`${s} is read before it is written`)
      return reg[s]
    }
    for (const l of lines) reg[l.to] = (l.op === null ? val(l.a) : l.op === '~' ? ~val(l.a) : OPS[l.op](val(l.a), val(l.b))) & 255
    let want = 0
    for (let b = 0; b < 8; b++) want += (x >> b) & 1
    if (reg.out !== want) wrong.push(x)
    cases.push({ case: x, ok: reg.out === want, output: reg.out })
  }
  const ops = lines.filter((l) => l.op !== null).length, registers = names.size
  // each case carries the program's cost, so two programs can be compared case by case (rpf pair)
  for (const c of cases) c.cost = ops * registers
  return { ok: wrong.length === 0, wrong: wrong.length, first_wrong: wrong.slice(0, 5), ops, registers, score: wrong.length ? null : ops * registers, cases }
}

// node evaluate.mjs [program.txt] [--cases]: the score, or with --cases one line for each input
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const perCase = process.argv.includes('--cases')
  const file = process.argv.slice(2).find((a) => a !== '--cases') ?? join(dirname(fileURLToPath(import.meta.url)), 'program.txt')
  let result
  try { result = evaluate(readFileSync(file, 'utf8')) } catch (e) { result = { ok: false, error: e.message, score: null } }
  if (perCase && result.cases) { for (const c of result.cases) console.log(JSON.stringify(c)); process.exit(0) }
  const { cases, ...summary } = result
  console.log(JSON.stringify(summary))
  process.exit(result.ok ? 0 : 1)
}
