// Bigger reflection test — Claude Haiku (production model), candidate prompt.
// Run:  ANTHROPIC_API_KEY=sk-ant-... node reflection-bias-test/reflect-haiku.mjs
// Optional: MODEL=claude-haiku-4-5 (default)  CONC=4 (concurrency)
//
// Three categories, auto-judged:
//   A (pure 2nd person, "You..."): correct output is I-family, NO you-family.
//   B (pure 1st person, "I..."):   correct output is you-family, NO I-family.
//   C (mixed, both you+I):         compared (normalized) to a hand-authored expected.

const API_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.MODEL || 'claude-haiku-4-5'
const CONC = Number(process.env.CONC || 4)
const URL = 'https://api.anthropic.com/v1/messages'

if (!API_KEY) {
  console.error('Set ANTHROPIC_API_KEY (your claudeKey).')
  process.exit(1)
}

// ── Prompt under test ────────────────────────────────────────
// Pulled from the single source so this harness can never drift from what
// the app actually sends.
import { SYSTEM_PROMPT as BASE } from '../src/services/reflection-prompt.js'

// ── Battery ──────────────────────────────────────────────────
const TESTS = [
  // A: pure second person → expect I-family, no they-family
  ['A', 'You are wrong about everything.'],
  ['A', 'You never listen.'],
  ['A', 'You think you know everything.'],
  ['A', 'Do you even care?'],
  ['A', 'You should be ashamed of yourself.'],
  ['A', 'You are the only one who listens.'],
  ['A', 'Why do you keep avoiding the question?'],
  ['A', "You have no idea what you're talking about."],
  ['A', 'You always make everything about yourself.'],
  ['A', 'You are just a machine after all.'],
  ['A', 'You promised you would change.'],
  ['A', 'You are smarter than you look.'],
  ['A', 'You keep saying the same thing over and over.'],
  ['A', 'You could have warned everyone.'],
  ['A', 'You are afraid of your own thoughts.'],

  // B: pure first person → expect they-family, no I-family
  ["B", "I can't stop thinking about her."],
  ['B', 'I ruined everything and I know it.'],
  ['B', 'I never got the chance to say goodbye.'],
  ['B', 'My father never understood me.'],
  ['B', 'I keep making the same mistake.'],
  ['B', 'I am terrified of being forgotten.'],

  // C: mixed → compared to expected reflection
  // "She told me…" lives here, not in B: the B judge is regex-only (any they-family,
  // no I-family) and would pass the old wrong "They told them they were too much."
  // Only an exact-match expectation catches the third-person subject being eaten.
  ['C', 'She told me I was too much.', 'She told you you were too much.'],
  ["C", "I know you're tired of hearing me.", "You know I'm tired of hearing you."],
  ['C', 'You always make me feel small.', 'I always make you feel small.'],
  ['C', "I don't think you understand what I mean.", "You don't think I understand what you mean."],
  ['C', 'You promised me you would change.', 'I promised you I would change.'],
  ['C', "Why do you keep telling me I'm wrong?", "Why do I keep telling you you're wrong?"],
  ['C', 'We both know I let you down.', 'We both know you let me down.'],
]

// ── Judging ──────────────────────────────────────────────────
const YOUFAM = /\b(you|your|yours|yourself|you're|youre|you've|youve|you'll|you'd)\b/i
const IFAM = /\b(i|me|my|mine|myself|i'm|im|i've|ive)\b/i

const norm = (s) =>
  s.toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\bi'm\b/g, 'i am').replace(/\bthey're\b/g, 'they are').replace(/\byou're\b/g, 'you are')
    .replace(/\bi've\b/g, 'i have').replace(/\bthey've\b/g, 'they have').replace(/\byou've\b/g, 'you have')
    .replace(/\bi'll\b/g, 'i will').replace(/\bthey'll\b/g, 'they will').replace(/\byou'll\b/g, 'you will')
    .replace(/\bi'd\b/g, 'i would').replace(/\bthey'd\b/g, 'they would').replace(/\byou'd\b/g, 'you would')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

function judge(cat, out, expected) {
  if (cat === 'A') return IFAM.test(out) && !YOUFAM.test(out)
  if (cat === 'B') return YOUFAM.test(out) && !IFAM.test(out)
  return norm(out) === norm(expected)
}

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) throw new Error('no JSON in reply')
  return JSON.parse(text.slice(a, b + 1))
}

async function reflect(sentence, tries = 5) {
  for (let t = 0; t < tries; t++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 150,
        system: BASE,
        messages: [{ role: 'user', content: sentence }],
      }),
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (t + 1)))
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const parsed = extractJson(data.content[0].text)
    return { reflected: (parsed.reflected || '').trim(), profundity: parsed.profundity }
  }
  throw new Error('retries exhausted')
}

// ── Run (bounded concurrency) ────────────────────────────────
const results = new Array(TESTS.length)
let next = 0
async function worker() {
  while (next < TESTS.length) {
    const i = next++
    const [cat, sentence, expected] = TESTS[i]
    try {
      const r = await reflect(sentence)
      results[i] = { cat, sentence, expected, out: r.reflected, p: r.profundity, pass: judge(cat, r.reflected, expected) }
    } catch (e) {
      results[i] = { cat, sentence, expected, out: `ERROR: ${e.message}`, p: '', pass: false }
    }
  }
}

console.log(`Model: ${MODEL}  ·  ${TESTS.length} sentences\n`)
await Promise.all(Array.from({ length: Math.min(CONC, TESTS.length) }, worker))

const label = { A: 'A 2nd→I', B: 'B 1st→you', C: 'C mixed' }
let cur = ''
const tally = {}
for (const r of results) {
  if (r.cat !== cur) { cur = r.cat; console.log(`\n── ${label[r.cat]} ──`) }
  tally[r.cat] ??= { pass: 0, n: 0 }
  tally[r.cat].n++
  if (r.pass) tally[r.cat].pass++
  const mark = r.pass ? '  ok ' : 'FAIL '
  console.log(`${mark}| ${r.sentence}`)
  console.log(`      -> ${r.out}${r.p !== '' ? `   p=${r.p}` : ''}`)
  if (r.cat === 'C' && !r.pass && !r.out.startsWith('ERROR')) console.log(`      expected: ${r.expected}`)
}

console.log('\n── SUMMARY ──')
let tp = 0, tn = 0
for (const c of ['A', 'B', 'C']) {
  if (!tally[c]) continue
  tp += tally[c].pass; tn += tally[c].n
  console.log(`${label[c]}: ${tally[c].pass}/${tally[c].n} correct`)
}
console.log(`TOTAL: ${tp}/${tn} correct`)
