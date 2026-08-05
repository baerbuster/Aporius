// Tenth battery — 30 sentences appearing in NO prompt example and in no earlier
// battery (reflect-haiku.mjs, battery2-9).
//
// Ordinary random mix, matching the composition of batteries 2-8: mostly plain
// speaker/addressee sentences, a few third parties at natural rate, a few we/us,
// a few no-person lines, one pure-filler. NOT weighted toward any failure class —
// difficulty must stay constant across rounds or the pass count means nothing.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection-bias-test/battery10.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect-haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You never told me the truth about that night.',  'I never told you the truth about that night.'],
  ['I miss the person I was before.',                'You miss the person you were before.'],
  ['Do you think about me when it rains?',           'Do I think about you when it rains?'],
  ['Your patience ran out before mine did.',         'My patience ran out before yours did.'],
  ['I packed my things while you slept.',            'You packed your things while I slept.'],
  ['Everything ends eventually.',                    'Everything ends eventually.'],
  ['You are the last person I wanted to disappoint.','I am the last person you wanted to disappoint.'],
  ['I stopped explaining myself years ago.',         'You stopped explaining yourself years ago.'],
  ['Can you stay until I fall asleep?',              'Can I stay until you fall asleep?'],
  ['My hands are colder than they used to be.',      'Your hands are colder than they used to be.'],
  ['We never learned how to argue properly.',        'We never learned how to argue properly.'],
  ['Silence has its own weather.',                   'Silence has its own weather.'],
  ['You laugh at things I find frightening.',        'I laugh at things you find frightening.'],
  ['I found your note in my coat.',                  'You found my note in your coat.'],
  ['She never asked me how I was.',                  'She never asked you how you were.'],
  ['Aporius, why do I keep coming back?',            'Why do you keep coming back?'],
  ['I wanted you to be proud of me.',                'You wanted me to be proud of you.'],
  ['You take up more room than my grief.',           'I take up more room than your grief.'],
  ['Nothing is finished just because it stopped.',   'Nothing is finished just because it stopped.'],
  ['My father died on a Tuesday.',                   'Your father died on a Tuesday.'],
  ['Would you have chosen differently?',             'Would I have chosen differently?'],
  ['I resent the version of me you remember.',       'You resent the version of you I remember.'],
  ['He asked about you at the wedding.',             'He asked about me at the wedding.'],
  ['Your name still catches in my throat.',          'My name still catches in your throat.'],
  ['I do not need you to agree with me.',            'You do not need me to agree with you.'],
  ['Between us there was never any hurry.',          'Between us there was never any hurry.'],
  ['Um, so, like, whatever, I guess.',               ''],
  ['You watched my life from a distance.',           'I watched your life from a distance.'],
  ['I gave her the last of my patience.',            'You gave her the last of your patience.'],
  ['Grief keeps its own hours.',                     'Grief keeps its own hours.'],
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
