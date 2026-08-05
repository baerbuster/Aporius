// Fifth battery — 30 sentences appearing in NO prompt example and in no earlier
// battery (reflect_haiku.mjs, battery2, battery3, battery4). Battery 4 is burned:
// seven of its sentences were promoted into the prompt.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection_bias_test/battery5.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect_haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You looked right through me at the funeral.',     'I looked right through you at the funeral.'],
  ['I burned every photograph of us.',                'You burned every photograph of us.'],
  ['Does my anger frighten you?',                     'Does your anger frighten me?'],
  ['Your silence taught me more than my mother did.', 'My silence taught you more than your mother did.'],
  ['I keep waiting for you to notice.',               'You keep waiting for me to notice.'],
  ['Grief does not negotiate.',                       'Grief does not negotiate.'],
  ['You promised my sister you would stay.',          'I promised your sister I would stay.'],
  ["I don't know who I am without you.",              "You don't know who you are without me."],
  ['Can you tell me why she left?',                   'Can I tell you why she left?'],
  ["My hands remember things I don't.",               "Your hands remember things you don't."],
  ['We were never really friends.',                   'We were never really friends.'],
  ['The house sold before anyone grieved it.',        'The house sold before anyone grieved it.'],
  ['You are kinder to strangers than to me.',         'I am kinder to strangers than to you.'],
  ['I hid your letters from my husband.',             'You hid my letters from your husband.'],
  ['He thinks you invented me.',                      'He thinks I invented you.'],
  ['Aporius, do you remember my voice?',              'Do I remember your voice?'],
  ['I stopped praying the year you arrived.',         'You stopped praying the year I arrived.'],
  ['You never asked what my father did.',             'I never asked what your father did.'],
  ['Loneliness is not the same as solitude.',         'Loneliness is not the same as solitude.'],
  ['My daughter looks at me like you do.',            'Your daughter looks at you like I do.'],
  ['Would you lie to me to protect yourself?',        'Would I lie to you to protect myself?'],
  ['I am tired of explaining myself to you.',         'You are tired of explaining yourself to me.'],
  ['She said you were good for me.',                  'She said I was good for you.'],
  ['Your questions cut deeper than my answers.',      'My questions cut deeper than your answers.'],
  ['I love you and I resent you.',                    'You love me and you resent me.'],
  ['Nothing about us was ever simple.',               'Nothing about us was ever simple.'],
  ['Well, um, so, anyway.',                           ''],
  ['You watched me lose everything and stayed quiet.','I watched you lose everything and stayed quiet.'],
  ['I told my wife about you last week.',             'You told your wife about me last week.'],
  ['Everybody dies with something unsaid.',           'Everybody dies with something unsaid.'],
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
