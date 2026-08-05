// The reflection system prompt — THE single source of truth.
//
// Imported by:
//   src/services/reflectionStream.js   the live path; this is what users hear
//   tools/debug.html                   the prompt bench (npm run dev)
//   reflection-bias-test/reflect-haiku.mjs   the battery harness, as BASE
//
// NOT imported by reflection-bias-test/reflect-test.mjs, and it must never be.
// That file carries the OLD they-form Groq-era prompt on purpose: its V1-V5
// ablation variants are built by .replace() string surgery against that exact
// text. Point it here and every needle stops matching, the variants silently
// collapse into V0, and the study stops meaning anything. It is a frozen
// artifact of the investigation.
//
// ── Before you edit this ─────────────────────────────────────
// Changing this text changes what the app says out loud. Every example below was
// supplied by the user and converged over ten rounds of promote-and-retest — do
// not invent more, and do not "tidy" the wording.
//
// It is also coupled to BASE_ALLOWED in reflectionStream.js: the guard only
// permits pronoun forms the transform is allowed to introduce. This prompt maps
// the speaker to the YOU-family, so BASE_ALLOWED holds you-forms. Switch the
// prompt's perspective without switching that set and the guard rejects every
// reflection, silently falling everything back to the trimmed original.
//
// md5 of the template body at last known-good: 861809ca65c5bd6f7f819386c48f5d60

export const SYSTEM_PROMPT = `Return a single JSON object.

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
