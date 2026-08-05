// Twelfth battery — 30 sentences appearing in NO prompt example and in no
// earlier battery (reflect-haiku.mjs, battery2-11).
//
// Ordinary random mix, same composition as batteries 10 and 11. Difficulty held
// constant on purpose.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection-bias-test/battery12.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect-haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You disappeared for two whole years.',           'I disappeared for two whole years.'],
  ['I am tired of being the reasonable one.',        'You are tired of being the reasonable one.'],
  ['Do you still keep my letters?',                  'Do I still keep your letters?'],
  ['Your father never learned my name.',             'My father never learned your name.'],
  ['I moved out while you were at work.',            'You moved out while I was at work.'],
  ['Old wounds keep their own calendar.',            'Old wounds keep their own calendar.'],
  ['You treat my worry like an accusation.',         'I treat your worry like an accusation.'],
  ['I burned the letters before anyone read them.',  'You burned the letters before anyone read them.'],
  ['Can you sit with me a while longer?',            'Can I sit with you a while longer?'],
  ['My sister married a man who frightens her.',     'Your sister married a man who frightens her.'],
  ['We agreed to stop keeping score.',               'We agreed to stop keeping score.'],
  ['A house remembers who left first.',              'A house remembers who left first.'],
  ['You hear my silence as agreement.',              'I hear your silence as agreement.'],
  ['I sent your gift back unopened.',                'You sent my gift back unopened.'],
  ['He wrote to her every week that winter.',        'He wrote to her every week that winter.'],
  ['Aporius, do you get tired of me?',               'Do I get tired of you?'],
  ['I stopped believing my own excuses.',            'You stopped believing your own excuses.'],
  ['You are quieter since your mother died.',        'I am quieter since my mother died.'],
  ['Nothing gets easier, it only gets familiar.',    'Nothing gets easier, it only gets familiar.'],
  ['My childhood happened to somebody else.',        'Your childhood happened to somebody else.'],
  ['Would you have believed me back then?',          'Would I have believed you back then?'],
  ['I need you more than I want to.',                'You need me more than you want to.'],
  ['She kept his name after everything.',            'She kept his name after everything.'],
  ['Your silence taught me to shout.',               'My silence taught you to shout.'],
  ['I do not blame you for leaving.',                'You do not blame me for leaving.'],
  ['Whatever we had is still unfinished.',           'Whatever we had is still unfinished.'],
  ['So, uh, like, um, whatever.',                    ''],
  ['You knew my answer before I spoke.',             'I knew your answer before you spoke.'],
  ['I told her about you and she laughed.',          'You told her about me and she laughed.'],
  ['Every road looks shorter going home.',           'Every road looks shorter going home.'],
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
