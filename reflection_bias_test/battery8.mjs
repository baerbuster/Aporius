// Eighth battery — 30 sentences appearing in NO prompt example and in no earlier
// battery (reflect_haiku.mjs, battery2-7). Battery 7 is burned: four of its
// sentences were promoted into the prompt.
//
// Weighted toward we/us, which is now the most persistent failure class.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection_bias_test/battery8.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect_haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You left before I finished the sentence.',       'I left before you finished the sentence.'],
  ['I can hear my mother in my own voice.',          'You can hear your mother in your own voice.'],
  ['Why did you choose me?',                         'Why did I choose you?'],
  ['Your family never accepted me.',                 'My family never accepted you.'],
  ['I threw away everything you gave me.',           'You threw away everything I gave you.'],
  ['Winter does not apologise for arriving.',        'Winter does not apologise for arriving.'],
  ['You want my honesty until you get it.',          'I want your honesty until I get it.'],
  ['I lied to my doctor about you.',                 'You lied to your doctor about me.'],
  ['Do we ever get to start over?',                  'Do we ever get to start over?'],
  ['My friends stopped asking about you.',           'Your friends stopped asking about me.'],
  ['We are running out of ways to say this.',        'We are running out of ways to say this.'],
  ['A promise is only a shape of time.',             'A promise is only a shape of time.'],
  ['You are gentler with strangers than with me.',   'I am gentler with strangers than with you.'],
  ['I showed him your letters.',                     'You showed him my letters.'],
  ['She told you things I never said.',              'She told me things you never said.'],
  ['Aporius, can you keep my secret?',               'Can I keep your secret?'],
  ['I dreamed you were my brother.',                 'You dreamed I was your brother.'],
  ["You have my father's temper.",                   "I have your father's temper."],
  ['Nothing survives being explained.',              'Nothing survives being explained.'],
  ['My daughter asked me who you are.',              'Your daughter asked you who I am.'],
  ['Would you stay if I stopped asking?',            'Would I stay if you stopped asking?'],
  ['I trust you more than I trust myself.',          'You trust me more than you trust yourself.'],
  ['He said we were both lying.',                    'He said we were both lying.'],
  ['Your leaving taught me my own name.',            'My leaving taught you your own name.'],
  ['I want us to survive my honesty.',               'You want us to survive your honesty.'],
  ['Between us nothing was ever said plainly.',      'Between us nothing was ever said plainly.'],
  ['So, um, well, you know, like.',                  ''],
  ['You knew what I meant and said nothing.',        'I knew what you meant and said nothing.'],
  ['I am not asking you to fix me.',                 'You are not asking me to fix you.'],
  ['Every apology arrives too late.',                'Every apology arrives too late.'],
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
