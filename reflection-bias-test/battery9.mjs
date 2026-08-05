// Ninth battery — 30 sentences appearing in NO prompt example and in no earlier
// battery (reflect-haiku.mjs, battery2-8). Battery 8 is burned: three of its
// sentences were promoted into the prompt.
//
// Weighted toward named/third-party referents (he/she/him/her/names), which is
// now the most persistent failure class — the third party keeps getting absorbed
// into the speaker or addressee slot.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection-bias-test/battery9.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect-haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You told him what I said about her.',            'I told him what you said about her.'],
  ['I gave her your address.',                       'You gave her my address.'],
  ['Why does she trust you and not me?',             'Why does she trust me and not you?'],
  ['Your uncle asked me about him.',                 'My uncle asked you about him.'],
  ['I watched him choose you over me.',              'You watched him choose me over you.'],
  ['Rain falls on the just and the ruined alike.',   'Rain falls on the just and the ruined alike.'],
  ['You let her say those things to me.',            'I let her say those things to you.'],
  ['I never told him about your visit.',             'You never told him about my visit.'],
  ['Can she hear us arguing?',                       'Can she hear us arguing?'],
  ['My son thinks you replaced him.',                'Your son thinks I replaced him.'],
  ['We both loved her differently.',                 'We both loved her differently.'],
  ['A locked door is still a door.',                 'A locked door is still a door.'],
  ['You are more like him than you admit.',          'I am more like him than I admit.'],
  ['I wrote to her about you and me.',               'You wrote to her about me and you.'],
  ['She thinks we are the same person.',             'She thinks we are the same person.'],
  ['Aporius, does he know what I did?',              'Does he know what you did?'],
  ['I lost him the year you found me.',              'You lost him the year I found you.'],
  ['You made her choose between us.',                'I made her choose between us.'],
  ['Habit outlasts intention.',                      'Habit outlasts intention.'],
  ['My mother still asks about your health.',        'Your mother still asks about my health.'],
  ['Would he forgive me the way you did?',           'Would he forgive you the way I did?'],
  ['I keep telling her you are not the problem.',    'You keep telling her I am not the problem.'],
  ['He said you and I deserve each other.',          'He said I and you deserve each other.'],
  ['Your sister blames me for his silence.',         'My sister blames you for his silence.'],
  ['I want him to see what you see.',                'You want him to see what I see.'],
  ['Nobody told us she was leaving.',                'Nobody told us she was leaving.'],
  ['Uh, I mean, like, so, yeah.',                    ''],
  ['You knew her before I was born.',                'I knew her before you were born.'],
  ['I am not him and you know it.',                  'You are not him and I know it.'],
  ['Distance explains nothing.',                     'Distance explains nothing.'],
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
