// Thirteenth battery — 30 sentences appearing in NO prompt example and in no
// earlier battery (reflect_haiku.mjs, battery2-12).
//
// Ordinary random mix, same composition as batteries 10-12. Difficulty held
// constant on purpose.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection_bias_test/battery13.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect_haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You always answer a question with a question.',  'I always answer a question with a question.'],
  ['I am not as forgiving as I pretend.',            'You are not as forgiving as you pretend.'],
  ['Do you remember my old address?',                'Do I remember your old address?'],
  ['Your brother stopped speaking to me.',           'My brother stopped speaking to you.'],
  ['I cancelled the trip without telling you.',      'You cancelled the trip without telling me.'],
  ['Every winter arrives ahead of schedule.',        'Every winter arrives ahead of schedule.'],
  ['You mistake my exhaustion for indifference.',    'I mistake your exhaustion for indifference.'],
  ['I have been rehearsing this for months.',        'You have been rehearsing this for months.'],
  ['Can you say that again more slowly?',            'Can I say that again more slowly?'],
  ['My uncle drank himself out of the family.',      'Your uncle drank himself out of the family.'],
  ['We were happier before the house.',              'We were happier before the house.'],
  ['A question can be a kind of accusation.',        'A question can be a kind of accusation.'],
  ['You read my hesitation as a lie.',               'I read your hesitation as a lie.'],
  ['I kept your photograph in my desk.',             'You kept my photograph in your desk.'],
  ['She warned him about the neighbours.',           'She warned him about the neighbours.'],
  ['Aporius, do I sound ridiculous to you?',         'Do you sound ridiculous to me?'],
  ['I gave up the piano the year I met you.',        'You gave up the piano the year you met me.'],
  ['You are gentler now than you used to be.',       'I am gentler now than I used to be.'],
  ['The truth arrives whether anyone wants it.',     'The truth arrives whether anyone wants it.'],
  ['My grandfather built that house alone.',         'Your grandfather built that house alone.'],
  ['Would you tell me if my work was bad?',          'Would I tell you if your work was bad?'],
  ['I resent you for being right.',                  'You resent me for being right.'],
  ['He left her the house and nothing else.',        'He left her the house and nothing else.'],
  ['Your certainty used to comfort me.',             'My certainty used to comfort you.'],
  ['I am not asking for your forgiveness.',          'You are not asking for my forgiveness.'],
  ['Neither of us wanted to say it first.',          'Neither of us wanted to say it first.'],
  ['Um, well, so, like, you know, yeah.',            ''],
  ['You noticed my hands were shaking.',             'I noticed your hands were shaking.'],
  ['I asked him about you last spring.',             'You asked him about me last spring.'],
  ['Some griefs are inherited, not earned.',         'Some griefs are inherited, not earned.'],
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
