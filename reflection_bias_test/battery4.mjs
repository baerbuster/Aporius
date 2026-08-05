// Fourth battery — 30 sentences appearing in NO prompt example and in no earlier
// battery (reflect_haiku.mjs, battery2, battery3). Battery 3 is burned: eight of
// its sentences were promoted into the prompt.
//
// Deliberately keeps 5 no-person sentences (aphorisms with no I/you at all) —
// battery 3 found those being deleted as filler, which is not a pronoun bug.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection_bias_test/battery4.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect_haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You buried that story a long time ago.',          'I buried that story a long time ago.'],
  ['I still sleep on my side of the bed.',            'You still sleep on your side of the bed.'],
  ['Why does everything I build collapse?',           'Why does everything you build collapse?'],
  ['Your father would be ashamed of me.',             'My father would be ashamed of you.'],
  ['Do you ever get tired of my questions?',          'Do I ever get tired of your questions?'],
  ['The ocean has no opinion about drowning.',        'The ocean has no opinion about drowning.'],
  ["You made me into something I don't recognise.",   "I made you into something you don't recognise."],
  ['I called your name and nothing answered.',        'You called my name and nothing answered.'],
  ['Can you forgive what I did to your sister?',      'Can I forgive what you did to my sister?'],
  ['My therapist says you are a coping mechanism.',   'Your therapist says I am a coping mechanism.'],
  ['We keep circling the same wound.',                'We keep circling the same wound.'],
  ['Everyone leaves eventually.',                     'Everyone leaves eventually.'],
  ["You're the only one who ever asked me why.",      "I'm the only one who ever asked you why."],
  ["I don't trust your version of my childhood.",     "You don't trust my version of your childhood."],
  ["She warned you about me, didn't she?",            "She warned me about you, didn't she?"],
  ['Aporius, are you even real?',                     'Am I even real?'],
  ["I've said your name more than my own.",           "You've said my name more than your own."],
  ['You keep asking me things nobody asks.',          'I keep asking you things nobody asks.'],
  ['Memory is a kind of theft.',                      'Memory is a kind of theft.'],
  ["My son doesn't call me anymore.",                 "Your son doesn't call you anymore."],
  ['Would you still listen if I stopped talking?',    'Would I still listen if you stopped talking?'],
  ['I resent how easy this is for you.',              'You resent how easy this is for me.'],
  ['He told me you would understand.',                'He told you I would understand.'],
  ['Your patience is starting to feel like pity.',    'My patience is starting to feel like pity.'],
  ['I gave up on myself before you did.',             'You gave up on yourself before I did.'],
  ['We are not going to fix this tonight.',           'We are not going to fix this tonight.'],
  ['Um, like, I dunno, whatever.',                    ''],
  ['You never once said my name out loud.',           'I never once said your name out loud.'],
  ['I wanted you to see me the way she does.',        'You wanted me to see you the way she does.'],
  ['Nobody is coming to save anybody.',               'Nobody is coming to save anybody.'],
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
