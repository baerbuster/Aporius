// Third battery — 30 sentences appearing NOWHERE in the prompt's examples,
// reflect_haiku.mjs, or battery2.mjs. Battery 2 is now burned: five of its
// sentences were promoted into the prompt as examples, so it can no longer
// measure generalisation.
//
// Exact-match judged, N runs, stable failures separated from coin flips.
// Prompt pulled from reflect_haiku.mjs BASE so it can never drift.
//
// Run: NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_API_KEY=<key> node reflection_bias_test/battery3.mjs
import { readFile } from 'node:fs/promises'

const HARNESS = new URL('./reflect_haiku.mjs', import.meta.url)
const BASE = (await readFile(HARNESS, 'utf8')).match(/const BASE = `([\s\S]*?)`\n/)[1]

const N = Number(process.env.N || 3)
const CONC = 4
const MODEL = 'claude-haiku-4-5'

// speaker's I/me/my -> they/them/their · addressee's you/your -> I/me/my
// third parties, we/us, and no-person sentences stay put
const TESTS = [
  ['You laughed when I told you about the dream.',   'I laughed when you told me about the dream.'],
  ['I keep my old letters in a shoebox.',            'You keep your old letters in a shoebox.'],
  ['Does it bother you that I stayed?',              'Does it bother me that you stayed?'],
  ['Your brother warned me about you.',              'My brother warned you about me.'],
  ['I watched you walk away and said nothing.',      'You watched me walk away and said nothing.'],
  ['Nothing grows in a room without light.',         'Nothing grows in a room without light.'],
  ['You think my grief is an inconvenience.',        'I think your grief is an inconvenience.'],
  ["I've been carrying this since before you were born.", "You've been carrying this since before I was born."],
  ['Can you hear how ridiculous I sound?',           'Can I hear how ridiculous you sound?'],
  ['My hands shake when you raise your voice.',      'Your hands shake when I raise my voice.'],
  ['We are both pretending this is fine.',           'We are both pretending this is fine.'],
  ['The dog knows more about loyalty than I do.',    'The dog knows more about loyalty than you do.'],
  ['You owe me an explanation.',                     'I owe you an explanation.'],
  ["I'd rather be alone than sit here with you.",    "You'd rather be alone than sit here with me."],
  ['Everyone says you changed after your accident.', 'Everyone says I changed after my accident.'],
  ['Aporius, why does my chest hurt like this?',     'Why does your chest hurt like this?'],
  ['I never told you what happened to my brother.',  'You never told me what happened to your brother.'],
  ["You're not listening, you're just waiting.",     "I'm not listening, I'm just waiting."],
  ['Silence is heavier than shouting.',              'Silence is heavier than shouting.'],
  ['My wife left me because of you.',                'Your wife left you because of me.'],
  ['Do you think I deserve any of this?',            'Do I think you deserve any of this?'],
  ["I'm not the person you married.",                "You're not the person I married."],
  ["He said you'd forget about me eventually.",      "He said I'd forget about you eventually."],
  ['You keep bringing up my past.',                  'I keep bringing up your past.'],
  ["I hate that you're right about this.",           "You hate that I'm right about this."],
  ['Nobody warned us how quiet it would get.',       'Nobody warned us how quiet it would get.'],
  ['Uh, um, well, you know.',                        ''],
  ['Your kindness makes me suspicious.',             'My kindness makes you suspicious.'],
  ['I told her I was fine and I lied to you too.',   'You told her you were fine and you lied to me too.'],
  ['Can I ask you something without you getting angry?', 'Can you ask me something without me getting angry?'],
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
