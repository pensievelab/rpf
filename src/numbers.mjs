// Numbers in a text that goes out (a note, a report, a status) are copied from result files, never
// retyped. This lists every number in the text that no source holds, and every word that may not go out.

const NUM = /(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w]|\.\d)/g

/** The numbers written in a text, as written with thousands commas removed, with where each starts. */
export function numbersIn(text) {
  return [...text.matchAll(NUM)].map((m) => ({ value: m[0].replace(/,+$/, '').replace(/,/g, ''), at: m.index })).filter((n) => n.value)
}

// 1.50 and 1.5 are one number
const key = (x) => (x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x)

/**
 * Every number of `text` that appears in none of the `sources` (texts), with its lines. Whole numbers
 * under `min` and years are skipped: they are counts and dates more often than results. Every word
 * of `forbid` found in the text is listed with its lines, whatever its case.
 */
export function unfound(text, sources, { min = 13, forbid = [] } = {}) {
  const known = new Set()
  for (const s of sources) for (const n of numbersIn(s)) { known.add(n.value); known.add(key(n.value)) }
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const line = (at) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1 } return lo + 1 }
  const missing = new Map()
  for (const n of numbersIn(text)) {
    if (!n.value.includes('.')) { const v = Number(n.value); if (v < min || (v >= 1990 && v <= 2030)) continue }
    if (known.has(n.value) || known.has(key(n.value))) continue
    if (!missing.has(n.value)) missing.set(n.value, [])
    missing.get(n.value).push(line(n.at))
  }
  const lower = text.toLowerCase(), words = []
  for (const w of forbid.map((x) => x.trim()).filter(Boolean)) {
    const lines = []
    for (let i = lower.indexOf(w.toLowerCase()); i >= 0; i = lower.indexOf(w.toLowerCase(), i + 1)) lines.push(line(i))
    if (lines.length) words.push({ word: w, lines: [...new Set(lines)] })
  }
  return { numbers: numbersIn(text).length, unfound: [...missing].map(([value, lines]) => ({ value, lines })), forbidden: words }
}
