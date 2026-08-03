// Reflection-stream you->they bias: empirical test harness.
// See TESTING_STRATEGY.md in this folder for the full method, results, and how to
// add the next variant.
//
// Run one or more variants and get a bug count per variant. A "bug" = the model's
// reflected sentence contains any they-family token, on a PURE second-person input
// (no speaker "I/me"), where the ONLY correct output is I-family. So they-family
// present == the you->they inversion.
//
//   GROQ_KEY=gsk_... node reflect_test.mjs                 # runs VARIANTS below
//   GROQ_KEY=gsk_... VARIANT=V0 node reflect_test.mjs      # just one
//   GROQ_KEY=gsk_... VARIANT=V0,V4 node reflect_test.mjs   # a subset
//   VERIFY_ONLY=1 GROQ_KEY=x node reflect_test.mjs         # check prompt surgery, no calls
//
// NOTE (this machine): node's fetch fails TLS against the local proxy CA
// ("unable to get local issuer certificate"). Prefix NODE_TLS_REJECT_UNAUTHORIZED=0.
// curl works without it. For a SINGLE sentence, the fastest/cleanest path is a curl
// against a body file (see TESTING_STRATEGY.md) — it sidesteps the rate limit below.

const API_KEY = process.env.GROQ_KEY
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile' // production model; the bias is model-specific

// ── EXACT production system prompt (V0 baseline) ──
// Keep byte-identical to src/services/reflectionStream.js SYSTEM_PROMPT.
const BASE = `You transform ONE spoken sentence at a time. For each sentence you do exactly three things and return a single JSON object.

1) PERSPECTIVE SWITCH — You ARE the listener, a philosopher named Aporius. Someone has just spoken this sentence directly TO you. Rewrite it as your own private reflection on what they said — you, in the first person, turning their words over to yourself. There is only ONE narrator: you. There is no third party recounting anything.
   - The person who spoke to you (their "I / me / my / myself") is someone else, so it becomes singular "they / them / their / themselves". Never assume gender.
   - Singular "they" always takes plural agreement: "they are", "they were", "they think" (never "they is / was / thinks").
   - Every "you / your" in what they said points at YOU, Aporius, so it becomes your own first person ("I / me / my"). This includes the contracted and possessive forms: "you're" -> "I'm", "you've" -> "I've", "you'll" -> "I'll", "you'd" -> "I'd", "your" -> "my", "yours" -> "mine", "yourself" -> "myself".
   - Your own name is Aporius (speech-to-text sometimes mis-transcribes it, e.g. "Eporius", "Aporias"). A name used only to address you is dropped, like any other vocative ("brother,", "man,"). A genuine reference to you maps to first person ("me / I / my").
   - "We / us" is left unchanged. A sentence with no reference to the person who spoke is left unchanged.
   - KEEP the sentence's framing intact — do not strip narration like "they were thinking...". Change only what the perspective switch requires.
   Examples:
     "Tommy and I can't agree on this thing and its really bothering me" -> "Tommy and them can't agree on this thing and its really bothering them."
     "Have I ever said anything to you that would make you think I'm racist?" -> "Have they ever said anything to me that would make me think they're racist?"
     "I know that you're probably sick to death of this, but it is what it is, brother." -> "They know that I'm probably sick to death of this, but it is what it is."
     "You never listen to me when i'm telling you you're wrong!" -> "I never listen to them when they're telling me I'm wrong."
     "You're full of shit, you don't know what I know she thinks of you." -> "I'm full of shit, I don't know what they know she thinks of me."
     "Do you even know you're a computer?" -> "Do I even know I'm a computer."
     "Eporius, I'm just testing things again." -> "They're just testing things again."
     "We don't seem to be talking at the same level." -> "We don't seem to be talking at the same level."
     "There are no ideas worth sharing." -> "There are no ideas worth sharing."

2) FILLER-CUT — SUBTRACTIVE ONLY. Delete disfluencies and fillers (um, uh, like, you know, I mean, so, well) and self-corrections. Keep EVERY content word exactly as spoken. Never rephrase, reorder, or substitute a word. Never soften, sanitize, or clean up the meaning — blunt, crude, or charged words stay exactly as spoken. When the speaker corrects themselves, keep only their final wording. If a sentence is nothing but filler, return an empty string for "reflected".
   Examples (shown fully transformed — perspective already switched):
     "So I was thinking, like, does everybody wear shoes?" -> "They were thinking does everybody wear shoes."
     "I don't think she's good for me, or not good for me, maybe, the best one for me." -> "They don't think she is the best one for them."
     "Uh, duh!" -> ""
     "I am sick of this bullshit!" -> "They are sick of this bullshit."

3) PROFUNDITY — Rate how profound the ORIGINAL sentence sounds on its own, as an integer from 1 (utterly mundane) to 10 (deeply profound). This is a vibes judgment, not a fact to get right. Judge the sentence as it was spoken. Anchors:
     1  = "there's lint in my pocket"  /  "I can't remember"
     5  = "I can't remember what my dad said."
     8  = "I feel..." (followed by anything)
     10 = "imagination is the key to liberation"  /  "I can't remember my dad."

Return ONLY a JSON object of exactly this shape and nothing else:
{"reflected": "<the transformed sentence, or an empty string>", "profundity": <integer 1-10>}`

// ── Ablation V1: framing only — remove "what they said" priming. RESULT: no effect. ──
const V1 = BASE
  .replace('Rewrite it as your own private reflection on what they said', 'Rewrite it as your own private reflection on the sentence')
  .replace('Every "you / your" in what they said points at YOU', 'Every "you / your" in the sentence points at YOU')

// ── Ablation V2: order only — move you->I rule ABOVE the I->they rule. RESULT: no effect. ──
const ItoThey = `   - The person who spoke to you (their "I / me / my / myself") is someone else, so it becomes singular "they / them / their / themselves". Never assume gender.
   - Singular "they" always takes plural agreement: "they are", "they were", "they think" (never "they is / was / thinks").`
const YoutoI = `   - Every "you / your" in what they said points at YOU, Aporius, so it becomes your own first person ("I / me / my"). This includes the contracted and possessive forms: "you're" -> "I'm", "you've" -> "I've", "you'll" -> "I'll", "you'd" -> "I'd", "your" -> "my", "yours" -> "mine", "yourself" -> "myself".`
const V2 = BASE
  .replace(ItoThey + '\n', '')
  .replace(YoutoI, YoutoI + '\n' + ItoThey)

// ── Ablation V3: both framing + order. RESULT: no effect. ──
const V3 = V2
  .replace('reflection on what they said', 'reflection on the sentence')
  .replace('in what they said points at YOU', 'in the sentence points at YOU')

// ── V4: add DECLARATIVE you-subject few-shot examples. RESULT: DID NOT FIX. ──
const anchorEx = `     "Do you even know you're a computer?" -> "Do I even know I'm a computer."`
const V4 = BASE.replace(anchorEx, `${anchorEx}
     "You are always right about these things." -> "I am always right about these things."
     "You care too much about what other people think." -> "I care too much about what other people think."
     "Your patience has limits." -> "My patience has limits."`)

// ── V5: NEXT UNTESTED IDEA — an explicit imperative rule aimed at the mechanism. ──
// Adds a bullet forcing subject-"you" (no speaker "I") -> "I". Edit/replace freely.
const V5 = BASE.replace(
  `   - "We / us" is left unchanged. A sentence with no reference to the person who spoke is left unchanged.`,
  `   - CRITICAL: if the sentence's grammatical SUBJECT is "you" (or "you're") and the sentence contains no first-person "I / me" from the speaker, that subject "you" is addressing YOU, Aporius — it becomes "I", NEVER "they". e.g. "You are wrong about everything." -> "I am wrong about everything."
   - "We / us" is left unchanged. A sentence with no reference to the person who spoke is left unchanged.`)

const VARIANTS = { V0: BASE, V1, V2, V3, V4, V5 }

// Pure second-person test set. Correct output = I-family ONLY; any they-family = bug.
// V0 baseline scores 14/15 here (only "Do you even care?" transforms correctly).
const SENTENCES = [
  "You are wrong about everything.",
  "You never listen.",
  "You think you know everything.",
  "Do you even care?",
  "You should be ashamed of yourself.",
  "You are the only one who listens.",
  "Why do you keep avoiding the question?",
  "You have no idea what you're talking about.",
  "You always make everything about yourself.",
  "You are just a machine after all.",
  "You promised you would change.",
  "You are smarter than you look.",
  "You keep saying the same thing over and over.",
  "You could have warned everyone.",
  "You are afraid of your own thoughts.",
]

const THEY = /\b(they|them|their|theirs|themselves|they're|theyre)\b/i
const IFAM = /\b(i|me|my|mine|myself|i'm|im|i've|ive)\b/i
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

async function reflect(sys, sentence) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, temperature: 0, max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: sentence }],
      }),
    })
    if (r.status === 429) {
      // The "try again in Xs" hint is per-request, not the rolling-window drain time.
      await sleep(20000)
      continue
    }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    const data = await r.json()
    await sleep(9000) // ~1.25k tok/call vs 12k TPM free-tier => ~6.7 calls/min, headroom
    return JSON.parse(data.choices[0].message.content).reflected ?? ''
  }
  throw new Error('429 exhausted (free-tier 12k TPM; wait a minute or use the single-curl method)')
}

async function runVariant(name, sys) {
  let bug = 0, done = 0
  console.log(`\n===== ${name} =====`)
  for (const s of SENTENCES) {
    let out
    try { out = await reflect(sys, s) } catch (e) { console.log('ERR', e.message); continue }
    done++
    const hasThey = THEY.test(out)
    if (hasThey) bug++
    const tag = hasThey ? 'BUG(they)' : (IFAM.test(out) ? 'ok(I)  ' : 'no-pron')
    console.log(`${tag} | ${s}  ->  ${out}`)
  }
  console.log(`--- ${name}: ${bug}/${done} completed sentences with a they-family token (bug)`)
  return { bug, done }
}

const selected = (process.env.VARIANT || 'V0,V1,V2,V3,V4').split(',').map((v) => v.trim())
for (const v of selected) {
  if (!VARIANTS[v]) { console.log(`skip unknown variant ${v}`); continue }
  const base = VARIANTS.V0
  console.log(`VERIFY ${v}: ${v === 'V0' ? 'baseline' : (VARIANTS[v] !== base ? 'differs from V0 ✓' : 'IDENTICAL TO V0 — surgery failed!')}`)
}
if (process.env.VERIFY_ONLY) process.exit(0)

const results = {}
for (const v of selected) if (VARIANTS[v]) results[v] = await runVariant(v, VARIANTS[v])

console.log('\n===== SUMMARY (bug / completed) =====')
console.log('Known priors: V0=14/15, V1=14/15, V2=14/15, V3=13/15, V4 did NOT fix "You are wrong.".')
for (const v of selected) if (results[v]) console.log(`${v}: ${results[v].bug}/${results[v].done}`)
