// Eleventh battery — 30 sentences appearing in NO prompt example and in no
// earlier battery (reflect_haiku.mjs, battery2-10).
//
// Ordinary random mix, same composition as battery 10: mostly plain
// speaker/addressee sentences, a few third parties at natural rate, a few we/us,
// a few no-person lines, one pure-filler. Difficulty held constant on purpose —
// weighting a suite toward a known failure class makes the count meaningless.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection_bias_test/battery11.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect_haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You stopped calling after the funeral.',         'I stopped calling after the funeral.'],
  ['I am worse at this than I admit.',               'You are worse at this than you admit.'],
  ['Do you regret meeting me?',                      'Do I regret meeting you?'],
  ['Your kindness came too late for me.',            'My kindness came too late for you.'],
  ['I keep rereading the message you sent.',         'You keep rereading the message I sent.'],
  ['Some doors only open once.',                     'Some doors only open once.'],
  ['You expect me to be grateful.',                  'I expect you to be grateful.'],
  ['I hid my drinking from everyone.',               'You hid your drinking from everyone.'],
  ['Can you understand why I stayed so long?',       'Can I understand why you stayed so long?'],
  ['My apartment is quieter than my childhood was.', 'Your apartment is quieter than your childhood was.'],
  ['We used to finish each other sentences.',        'We used to finish each other sentences.'],
  ['Weather forgets nothing and forgives nothing.',  'Weather forgets nothing and forgives nothing.'],
  ['You remember it differently than I do.',         'I remember it differently than you do.'],
  ['I left your coat at my sister house.',           'You left my coat at your sister house.'],
  ['He told her about my divorce.',                  'He told her about your divorce.'],
  ['Aporius, am I boring you?',                      'Are you boring me?'],
  ['I wanted your approval more than my own.',       'You wanted my approval more than your own.'],
  ['You are angrier than you were last year.',       'I am angrier than I was last year.'],
  ['The answer changes depending on the hour.',      'The answer changes depending on the hour.'],
  ['My marriage ended quietly.',                     'Your marriage ended quietly.'],
  ['Would you say that to my face?',                 'Would I say that to your face?'],
  ['I am smaller now than I was with you.',          'You are smaller now than you were with me.'],
  ['She never liked him very much.',                 'She never liked him very much.'],
  ['Your memory is kinder than mine.',               'My memory is kinder than yours.'],
  ['I do not want you to pity me.',                  'You do not want me to pity you.'],
  ['Something between us stopped working.',          'Something between us stopped working.'],
  ['Well, uh, you know, I mean, like.',              ''],
  ['You made my problems sound simple.',             'I made your problems sound simple.'],
  ['I told him what you did for me.',                'You told him what I did for you.'],
  ['Patience is only fear that learned manners.',    'Patience is only fear that learned manners.'],
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
