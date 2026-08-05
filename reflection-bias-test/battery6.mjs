// Sixth battery — 30 sentences appearing in NO prompt example and in no earlier
// battery (reflect-haiku.mjs, battery2-5). Battery 5 is burned: six of its
// sentences were promoted into the prompt.
//
// Keeps 4 no-person aphorisms to check the empty-string rule rewrite.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection-bias-test/battery6.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect-haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You forgot my birthday again.',                  'I forgot your birthday again.'],
  ["I can't look at my reflection anymore.",         "You can't look at your reflection anymore."],
  ['Why do you flinch when I reach for you?',        'Why do I flinch when you reach for me?'],
  ['Your mother called me a liar.',                  'My mother called you a liar.'],
  ['I built this whole life around you.',            'You built this whole life around me.'],
  ['Rust does not ask permission.',                  'Rust does not ask permission.'],
  ["You think I'm exaggerating about my pain.",      "I think you're exaggerating about your pain."],
  ['I dreamt about your hands last night.',          'You dreamt about my hands last night.'],
  ['Can I trust you with what I know?',              'Can you trust me with what you know?'],
  ['My brother says I invented you.',                'Your brother says you invented me.'],
  ['We stopped saying goodnight years ago.',         'We stopped saying goodnight years ago.'],
  ['Debt outlives the person who made it.',          'Debt outlives the person who made it.'],
  ['You are the only witness to my worst year.',     'I am the only witness to your worst year.'],
  ['I never showed you what my father wrote.',       'You never showed me what your father wrote.'],
  ['She asked me if you were kind.',                 'She asked you if I was kind.'],
  ['Aporius, does my honesty scare you?',            'Does your honesty scare me?'],
  ['I apologised to you before I understood why.',   'You apologised to me before you understood why.'],
  ['You keep score of my mistakes.',                 'I keep score of your mistakes.'],
  ['Shame arrives faster than memory.',              'Shame arrives faster than memory.'],
  ['My grandmother died thinking I hated her.',      'Your grandmother died thinking you hated her.'],
  ['Would you tell me if I were failing?',           'Would I tell you if you were failing?'],
  ['I compare myself to you constantly.',            'You compare yourself to me constantly.'],
  ['He warned you that I would leave.',              'He warned me that you would leave.'],
  ['Your certainty makes my doubt louder.',          'My certainty makes your doubt louder.'],
  ['I need you to stop being reasonable.',           'You need me to stop being reasonable.'],
  ['Between us there is only weather.',              'Between us there is only weather.'],
  ['Um, yeah, so, like, right.',                     ''],
  ['You held my secret longer than I did.',          'I held your secret longer than you did.'],
  ['I hate my voice when I talk to you.',            'You hate your voice when you talk to me.'],
  ['Regret has no clock.',                           'Regret has no clock.'],
]

const norm = (s) =>
  s.toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\bi'm\b/g, 'i am').replace(/\bthey're\b/g, 'they are').replace(/\byou're\b/g, 'you are')
    .replace(/\bi've\b/g, 'i have').replace(/\bthey've\b/g, 'they have').replace(/\byou've\b/g, 'you have')
    .replace(/\bi'll\b/g, 'i will').replace(/\bthey'll\b/g, 'they will').replace(/\byou'll\b/g, 'you will')
    .replace(/\bi'd\b/g, 'i would').replace(/\bthey'd\b/g, 'they would').replace(/\byou'd\b/g, 'you would')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

async function reflect(sentence) {
  for (let t = 0; t < 5; t++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL, temperature: 0, max_tokens: 150,
        system: BASE, messages: [{ role: 'user', content: sentence }],
      }),
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (t + 1)))
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const txt = (await res.json()).content[0].text
    return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)).reflected.trim()
  }
  throw new Error('retries exhausted')
}

const stats = TESTS.map(([s, e]) => ({ sentence: s, expected: e, pass: 0, outs: new Map() }))

for (let run = 0; run < N; run++) {
  let next = 0
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < TESTS.length) {
      const i = next++
      const st = stats[i]
      let out
      try { out = await reflect(st.sentence) } catch (e) { out = `ERROR: ${e.message}` }
      if (norm(out) === norm(st.expected)) st.pass++
      st.outs.set(out, (st.outs.get(out) || 0) + 1)
    }
  }))
  process.stdout.write(`run ${run + 1}/${N} done\n`)
}

const stable = stats.filter((s) => s.pass === 0)
const flaky = stats.filter((s) => s.pass > 0 && s.pass < N)

console.log(`\n${TESTS.length} sentences · ${N} runs · ${MODEL}`)
console.log(`clean ${stats.filter((s) => s.pass === N).length} · flaky ${flaky.length} · stable-fail ${stable.length}`)

const show = (title, list) => {
  if (!list.length) return
  console.log(`\n── ${title} ──`)
  for (const s of list) {
    console.log(`\n${s.sentence}   [${s.pass}/${N} pass]`)
    console.log(`  want: ${s.expected || '(empty)'}`)
    for (const [o, c] of [...s.outs].sort((a, b) => b[1] - a[1])) {
      if (norm(o) !== norm(s.expected)) console.log(`  got:  ${o || '(empty)'}   (${c}/${N})`)
    }
  }
}
show(`STABLE FAILURES (0/${N})`, stable)
show('FLAKY', flaky)
