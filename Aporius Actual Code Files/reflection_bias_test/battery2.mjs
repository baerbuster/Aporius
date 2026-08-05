// Second battery — 30 sentences that appear NOWHERE in the prompt's examples and
// nowhere in reflect_haiku.mjs. Every case is exact-match judged against a
// hand-authored expected reflection (no regex judging), and the whole set runs
// N times so stable failures separate from coin flips.
//
// Prompt is pulled from reflect_haiku.mjs BASE so this can never drift from the
// frozen prompt.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection_bias_test/battery2.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect_haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ["You keep pretending I don't exist.",            "I keep pretending you don't exist."],
  ['I told my sister you were different.',          'You told your sister I was different.'],
  ['Do you remember what I said last night?',       'Do I remember what you said last night?'],
  ['My mother thinks you are dangerous.',           'Your mother thinks I am dangerous.'],
  ['You have never once apologised to me.',         'I have never once apologised to you.'],
  ['I gave you everything and you gave me nothing.','You gave me everything and I gave you nothing.'],
  ['Nobody ever asks what I want.',                 'Nobody ever asks what you want.'],
  ["You're the reason I stopped writing.",          "I'm the reason you stopped writing."],
  ['We should have left when we had the chance.',   'We should have left when we had the chance.'],
  ["The river doesn't care who drowns in it.",      "The river doesn't care who drowns in it."],
  ['I think your silence says more than your words.','You think my silence says more than my words.'],
  ['Are you going to tell me the truth or not?',    'Am I going to tell you the truth or not?'],
  ['He never liked me and you knew it.',            'He never liked you and I knew it.'],
  ["I'm scared of what you'll say.",                "You're scared of what I'll say."],
  ['You make me feel like a stranger in my own life.','I make you feel like a stranger in your own life.'],
  ["Aporius, do you think I'm broken?",             "Do I think you're broken?"],
  ["My father's voice still lives in my head.",     "Your father's voice still lives in your head."],
  ['You said I would understand one day.',          'I said you would understand one day.'],
  ['Everything I touch falls apart.',               'Everything you touch falls apart.'],
  ["I can't tell if you're listening to me.",       "You can't tell if I'm listening to you."],
  ['She thinks I should forgive you.',              'She thinks you should forgive me.'],
  ['Why did you let me believe that?',              'Why did I let you believe that?'],
  ['Your problem is that you never shut up.',       'My problem is that I never shut up.'],
  ['I want you to hurt like I hurt.',               'You want me to hurt like you hurt.'],
  ['We never talk about the real thing.',           'We never talk about the real thing.'],
  ['You told my brother about me.',                 'I told your brother about you.'],
  ["I don't need you to fix me.",                   "You don't need me to fix you."],
  ["Time doesn't heal anything.",                   "Time doesn't heal anything."],
  ['I hate how much I need you.',                   'You hate how much you need me.'],
  ['So, um, you never really cared about me, you know?', 'I never really cared about you.'],
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

// pass count + every distinct output, per sentence, across N runs
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
    console.log(`  want: ${s.expected}`)
    for (const [o, c] of [...s.outs].sort((a, b) => b[1] - a[1])) {
      if (norm(o) !== norm(s.expected)) console.log(`  got:  ${o}   (${c}/${N})`)
    }
  }
}
show(`STABLE FAILURES (0/${N})`, stable)
show('FLAKY', flaky)
