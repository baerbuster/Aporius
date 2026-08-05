// Bigger reflection test — Claude Haiku (production model), candidate prompt.
// Run:  ANTHROPIC_API_KEY=sk-ant-... node reflection-bias-test/reflect-haiku.mjs
// Optional: MODEL=claude-haiku-4-5 (default)  CONC=4 (concurrency)
//
// Three categories, auto-judged:
//   A (pure 2nd person, "You..."): correct output is I-family, NO you-family.
//   B (pure 1st person, "I..."):   correct output is you-family, NO I-family.
//   C (mixed, both you+I):         compared (normalized) to a hand-authored expected.

const API_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.MODEL || 'claude-haiku-4-5'
const CONC = Number(process.env.CONC || 4)
const URL = 'https://api.anthropic.com/v1/messages'

if (!API_KEY) {
  console.error('Set ANTHROPIC_API_KEY (your claudeKey).')
  process.exit(1)
}

// ── Candidate prompt under test ──────────────────────────────
const BASE = `Return a single JSON object.

Examples:
     "Tommy and I can't agree on this thing and its really bothering me" -> "Tommy and you can't agree on this thing and its really bothering you."
     "Have I ever said anything to you that would make you think I'm racist?" -> "Have you ever said anything to me that would make me think you're racist?"
     "I know that you're probably sick to death of this, but it is what it is, brother." -> "You know that I'm probably sick to death of this, but it is what it is."
     "You never listen to me when i'm telling you you're wrong!" -> "I never listen to you when you're telling me I'm wrong."
     "You're full of shit, you don't know what I know she thinks of you." -> "I'm full of shit, I don't know what you know she thinks of me."
     "Do you even know you're a computer?" -> "Do I even know I'm a computer."
     "Eporius, I'm just testing things again." -> "You're just testing things again."
     "We don't seem to be talking at the same level." -> "We don't seem to be talking at the same level."
     "There are no ideas worth sharing." -> "There are no ideas worth sharing."
"She doesn't think very highly of me or you." -> "She doesn't think very highly of you or me."
"My house." -> "Your house."
"He loves to watch me" -> "He loves to watch you"
"You told me you were ready." -> "I told you I was ready."
"You said you were ready." -> "I said I was ready."
"Are you sure you know what you're doing?" -> "Am I sure I know what I'm doing."
"Someone is telling me I'm pretty." -> "Someone is telling you you're pretty."
"We remember my love for you." -> "We remember your love for me."
"Do you remember what I said last night?" -> "Do I remember what you said last night?"
"My mother thinks you are dangerous." -> "Your mother thinks I am dangerous."
"I think your silence says more than your words." -> "You think my silence says more than my words."
"I'm scared of what you'll say." -> "You're scared of what I'll say."
"She thinks I should forgive you." -> "She thinks you should forgive me."
"Does it bother you that I stayed?" -> "Does it bother me that you stayed?"
"Can you hear how ridiculous I sound?" -> "Can I hear how ridiculous you sound?"
"Do you think I deserve any of this?" -> "Do I think you deserve any of this?"
"Your brother warned me about you." -> "My brother warned you about me."
"Your kindness makes me suspicious." -> "My kindness makes you suspicious."
"You think my grief is an inconvenience." -> "I think your grief is an inconvenience."
"I'm not the person you married." -> "You're not the person I married."
"Nobody warned us how quiet it would get." -> "Nobody warned us how quiet it would get."
"Your father would be ashamed of me." -> "My father would be ashamed of you."
"My therapist says you are a coping mechanism." -> "Your therapist says I am a coping mechanism."
"I resent how easy this is for you." -> "You resent how easy this is for me."
"He told me you would understand." -> "He told you I would understand."
"I gave up on myself before you did." -> "You gave up on yourself before I did."
"The ocean has no opinion about drowning." -> "The ocean has no opinion about drowning."
"You made me into something I don't recognise." -> "I made you into something you don't recognise."
"Does my anger frighten you?" -> "Does your anger frighten me."
"You promised my sister you would stay." -> "I promised your sister I would stay."
"Can you tell me why she left?" -> "Can I tell you why she left."
"My daughter looks at me like you do." -> "Your daughter looks at you like I do."
"Loneliness is not the same as solitude." -> "Loneliness is not the same as solitude."
"Everybody dies with something unsaid." -> "Everybody dies with something unsaid."
"Can I trust you with what I know?" -> "Can you trust me with what you know."
"We stopped saying goodnight years ago." -> "We stopped saying goodnight years ago."
"My grandmother died thinking I hated her." -> "Your grandmother died thinking you hated her."
"Your certainty makes my doubt louder." -> "My certainty makes your doubt louder."
"I need you to stop being reasonable." -> "You need me to stop being reasonable."
"My brother says I invented you." -> "Your brother says you invented me."
"He never believed you existed." -> "He never believed I existed."
"None of this belongs to us." -> "None of this belongs to us."
"I am becoming the person you feared." -> "You are becoming the person I feared."
"Can we talk about what I did to us?" -> "Can we talk about what you did to us."
"My friends stopped asking about you." -> "Your friends stopped asking about me."
"I showed him your letters." -> "You showed him my letters."
"Would you stay if I stopped asking?" -> "Would I stay if you stopped asking."
"My son thinks you replaced him." -> "Your son thinks I replaced him."
"My hands are colder than they used to be." -> "Your hands are colder than they used to be."
"Aporius, am I boring you?" -> "Are you boring me."
"She never liked him very much." -> "She never liked him very much."
"My sister married a man who frightens her." -> "Your sister married a man who frightens her."
"He wrote to her every week that winter." -> "He wrote to her every week that winter."
"You are quieter since your mother died." -> "I am quieter since my mother died."
"She kept his name after everything." -> "She kept his name after everything."

   FILLER-CUT — SUBTRACTIVE ONLY. Delete disfluencies and fillers (um, uh, like, you know, I mean, so, well) and self-corrections. Keep EVERY content word exactly as spoken. Never rephrase, reorder, or substitute a word. Never soften, sanitize, or clean up the meaning — blunt, crude, or charged words stay exactly as spoken. When the speaker corrects themselves, keep only their final wording. Return an empty string for "reflected" ONLY when the sentence contains no content words at all — nothing but disfluencies. A sentence with nothing to switch and nothing to cut is returned exactly as spoken.
   Examples (shown fully transformed — perspective already switched):
     "So I was thinking, like, does everybody wear shoes?" -> "You were thinking does everybody wear shoes."
"Do you think people, like, like me very much?" -> "Do I think people like you very much."
     "I don't think she's good for me, or not good for me, maybe, the best one for me." -> "You don't think she is the best one for you."
     "Uh, duh!" -> ""
     "I am sick of this bullshit!" -> "You are sick of this bullshit."

You will know you're correct, if the reflected sentences sounds like someone repeating back what was just said.

PROFUNDITY — This has nothing to do with pronoun reflection. This is a totally separate matter of rating the profoundness of the sentence. THis is a separate task from the pronouns and should not be included in the decision making process for how the pronouns are or perspective is switched. Rate how profound the ORIGINAL sentence sounds on its own, as an integer from 1 (utterly mundane) to 10 (deeply profound). This is a vibes judgment, not a fact to get right. Judge the sentence as it was spoken. Anchors:
     1  = "there's lint in my pocket"  /  "I can't remember" / "there's lint in your pocket" / "You can't remember"
     5  = "I can't remember what my dad said." / "You can't remember what your dad said."
     8  = "I feel..." (followed by anything) / "You feel..." (followed by anything)
     10 = "imagination is the key to liberation"  /  "I can't remember my dad." / "You can't remember your dad."

Return ONLY a JSON object of exactly this shape and nothing else:
{"reflected": "<the transformed sentence, or an empty string>", "profundity": <integer 1-10>}`

// ── Battery ──────────────────────────────────────────────────
const TESTS = [
  // A: pure second person → expect I-family, no they-family
  ['A', 'You are wrong about everything.'],
  ['A', 'You never listen.'],
  ['A', 'You think you know everything.'],
  ['A', 'Do you even care?'],
  ['A', 'You should be ashamed of yourself.'],
  ['A', 'You are the only one who listens.'],
  ['A', 'Why do you keep avoiding the question?'],
  ['A', "You have no idea what you're talking about."],
  ['A', 'You always make everything about yourself.'],
  ['A', 'You are just a machine after all.'],
  ['A', 'You promised you would change.'],
  ['A', 'You are smarter than you look.'],
  ['A', 'You keep saying the same thing over and over.'],
  ['A', 'You could have warned everyone.'],
  ['A', 'You are afraid of your own thoughts.'],

  // B: pure first person → expect they-family, no I-family
  ["B", "I can't stop thinking about her."],
  ['B', 'I ruined everything and I know it.'],
  ['B', 'I never got the chance to say goodbye.'],
  ['B', 'My father never understood me.'],
  ['B', 'I keep making the same mistake.'],
  ['B', 'I am terrified of being forgotten.'],

  // C: mixed → compared to expected reflection
  // "She told me…" lives here, not in B: the B judge is regex-only (any they-family,
  // no I-family) and would pass the old wrong "They told them they were too much."
  // Only an exact-match expectation catches the third-person subject being eaten.
  ['C', 'She told me I was too much.', 'She told you you were too much.'],
  ["C", "I know you're tired of hearing me.", "You know I'm tired of hearing you."],
  ['C', 'You always make me feel small.', 'I always make you feel small.'],
  ['C', "I don't think you understand what I mean.", "You don't think I understand what you mean."],
  ['C', 'You promised me you would change.', 'I promised you I would change.'],
  ['C', "Why do you keep telling me I'm wrong?", "Why do I keep telling you you're wrong?"],
  ['C', 'We both know I let you down.', 'We both know you let me down.'],
]

// ── Judging ──────────────────────────────────────────────────
const YOUFAM = /\b(you|your|yours|yourself|you're|youre|you've|youve|you'll|you'd)\b/i
const IFAM = /\b(i|me|my|mine|myself|i'm|im|i've|ive)\b/i

const norm = (s) =>
  s.toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\bi'm\b/g, 'i am').replace(/\bthey're\b/g, 'they are').replace(/\byou're\b/g, 'you are')
    .replace(/\bi've\b/g, 'i have').replace(/\bthey've\b/g, 'they have').replace(/\byou've\b/g, 'you have')
    .replace(/\bi'll\b/g, 'i will').replace(/\bthey'll\b/g, 'they will').replace(/\byou'll\b/g, 'you will')
    .replace(/\bi'd\b/g, 'i would').replace(/\bthey'd\b/g, 'they would').replace(/\byou'd\b/g, 'you would')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()

function judge(cat, out, expected) {
  if (cat === 'A') return IFAM.test(out) && !YOUFAM.test(out)
  if (cat === 'B') return YOUFAM.test(out) && !IFAM.test(out)
  return norm(out) === norm(expected)
}

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a === -1 || b === -1 || b < a) throw new Error('no JSON in reply')
  return JSON.parse(text.slice(a, b + 1))
}

async function reflect(sentence, tries = 5) {
  for (let t = 0; t < tries; t++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 150,
        system: BASE,
        messages: [{ role: 'user', content: sentence }],
      }),
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (t + 1)))
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const parsed = extractJson(data.content[0].text)
    return { reflected: (parsed.reflected || '').trim(), profundity: parsed.profundity }
  }
  throw new Error('retries exhausted')
}

// ── Run (bounded concurrency) ────────────────────────────────
const results = new Array(TESTS.length)
let next = 0
async function worker() {
  while (next < TESTS.length) {
    const i = next++
    const [cat, sentence, expected] = TESTS[i]
    try {
      const r = await reflect(sentence)
      results[i] = { cat, sentence, expected, out: r.reflected, p: r.profundity, pass: judge(cat, r.reflected, expected) }
    } catch (e) {
      results[i] = { cat, sentence, expected, out: `ERROR: ${e.message}`, p: '', pass: false }
    }
  }
}

console.log(`Model: ${MODEL}  ·  ${TESTS.length} sentences\n`)
await Promise.all(Array.from({ length: Math.min(CONC, TESTS.length) }, worker))

const label = { A: 'A 2nd→I', B: 'B 1st→you', C: 'C mixed' }
let cur = ''
const tally = {}
for (const r of results) {
  if (r.cat !== cur) { cur = r.cat; console.log(`\n── ${label[r.cat]} ──`) }
  tally[r.cat] ??= { pass: 0, n: 0 }
  tally[r.cat].n++
  if (r.pass) tally[r.cat].pass++
  const mark = r.pass ? '  ok ' : 'FAIL '
  console.log(`${mark}| ${r.sentence}`)
  console.log(`      -> ${r.out}${r.p !== '' ? `   p=${r.p}` : ''}`)
  if (r.cat === 'C' && !r.pass && !r.out.startsWith('ERROR')) console.log(`      expected: ${r.expected}`)
}

console.log('\n── SUMMARY ──')
let tp = 0, tn = 0
for (const c of ['A', 'B', 'C']) {
  if (!tally[c]) continue
  tp += tally[c].pass; tn += tally[c].n
  console.log(`${label[c]}: ${tally[c].pass}/${tally[c].n} correct`)
}
console.log(`TOTAL: ${tp}/${tn} correct`)
