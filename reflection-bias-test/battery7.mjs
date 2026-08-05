// Seventh battery — 30 sentences appearing in NO prompt example and in no earlier
// battery (reflect-haiku.mjs, battery2-6). Battery 6 is burned: six of its
// sentences were promoted into the prompt.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection-bias-test/battery7.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect-haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You erased me from your story.',                 'I erased you from my story.'],
  ['I still wear my wedding ring.',                  'You still wear your wedding ring.'],
  ['Do you ever think about what I lost?',           'Do I ever think about what you lost?'],
  ['Your voice sounds like my childhood.',           'My voice sounds like your childhood.'],
  ['I gave your number to my lawyer.',               'You gave my number to your lawyer.'],
  ['Concrete remembers every crack.',                'Concrete remembers every crack.'],
  ['You want me to be smaller than I am.',           'I want you to be smaller than you are.'],
  ['I stopped counting the days you were gone.',     'You stopped counting the days I was gone.'],
  ['Can we talk about what I did to us?',            'Can we talk about what you did to us?'],
  ['My father taught me to hide from you.',          'Your father taught you to hide from me.'],
  ['We agreed never to speak of it.',                'We agreed never to speak of it.'],
  ['Fear is louder in an empty house.',              'Fear is louder in an empty house.'],
  ['You are what I could not become.',               'I am what you could not become.'],
  ['I told her you were my friend.',                 'You told her I was your friend.'],
  ['He never believed you existed.',                 'He never believed I existed.'],
  ['Aporius, will you forget me?',                   'Will I forget you?'],
  ['I keep your voice in my pocket.',                'You keep my voice in your pocket.'],
  ['You made my grief about yourself.',              'I made your grief about myself.'],
  ['Every ending rehearses the last one.',           'Every ending rehearses the last one.'],
  ['My sister thinks I am wasting my life.',         'Your sister thinks you are wasting your life.'],
  ['Would you recognise me without my anger?',       'Would I recognise you without your anger?'],
  ['I forgive you and I do not forgive myself.',     'You forgive me and you do not forgive yourself.'],
  ['She left me the way you will.',                  'She left you the way I will.'],
  ['Your absence is heavier than my memories.',      'My absence is heavier than your memories.'],
  ['I need to hear you say my name.',                'You need to hear me say your name.'],
  ['None of this belongs to us.',                    'None of this belongs to us.'],
  ['Uh, so, um, I mean, well.',                      ''],
  ['You knew my mother before I did.',               'I knew your mother before you did.'],
  ['I am becoming the person you feared.',           'You are becoming the person I feared.'],
  ['Loyalty costs more than love.',                  'Loyalty costs more than love.'],
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
