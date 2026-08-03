# Reflection-stream `you → they` bias — testing strategy

Continuation notes so another agent can pick this up cold. Pairs with the memory
files `reflection_you_they_bug.md` (what's ruled OUT) and `reflection_stream.md`.

## The bug
`src/services/reflectionStream.js` runs ONE Groq call per sentence that switches
perspective (the listener, Aporius, reflects on what was said to them). Second-person
"you / your" (addressing Aporius) must become first person "I / me / my". It doesn't,
reliably: **declarative "You …" sentences come out with "they"**, e.g.
`"You are wrong about everything." → "They are wrong about everything."` (should be
`"I am wrong about everything."`).

### Confirmed signature
- The **grammatical subject** "You" is what flips to "They" (referent inversion — the
  model reads the addressee as the speaker).
- A *second* "you" later in the same sentence usually transforms **correctly** to "I"
  (`"They think I know everything"`).
- **Questions** transform correctly (`"Do you even care?" → "Do I even care?"`).
- So it is a **subject-position heuristic**, not blanket you/they confusion.

## The metric (why the test set is what it is)
`SENTENCES` in `reflect_test.mjs` are all **pure second-person** — no speaker "I/me".
Therefore the ONLY correct output pronoun family is I-family, and **any they-family
token in the output = the bug**, unambiguously. No mixed sentences (they'd need
manual per-token judging). Bug count = # sentences whose output matches
`/\b(they|them|their|theirs|themselves|they're)\b/i`.

Baseline (V0, production prompt): **14 / 15** sentences buggy (only "Do you even
care?" is right).

## How to run
Harness: `reflect_test.mjs` in this folder. Node 18+ (has `fetch`).

```
GROQ_KEY=gsk_... node reflect_test.mjs                # V0..V4
GROQ_KEY=gsk_... VARIANT=V0,V5 node reflect_test.mjs  # subset
VERIFY_ONLY=1 GROQ_KEY=x node reflect_test.mjs        # confirm prompt surgery, no calls
```

- **This machine's TLS quirk:** node `fetch` fails with `unable to get local issuer
  certificate` (proxy CA). Prefix `NODE_TLS_REJECT_UNAUTHORIZED=0`. `curl` is fine
  without it.
- **Always `VERIFY` first.** Each variant is built by string-surgery on `BASE`; a
  needle that doesn't match silently leaves the variant identical to V0. The harness
  prints `differs from V0 ✓` / `IDENTICAL — surgery failed!` per variant.
- The `BASE` prompt here must stay **byte-identical** to `SYSTEM_PROMPT` in
  `reflectionStream.js`. If the production prompt changes, update `BASE`.

### Single-sentence method (fastest, dodges limits)
For one sentence, skip node entirely — write the request body to a file and curl it:
```
python3 -c "import json; sp=open('sys.txt').read(); print(json.dumps({'model':'llama-3.3-70b-versatile','temperature':0,'max_tokens':150,'response_format':{'type':'json_object'},'messages':[{'role':'system','content':sp},{'role':'user','content':'You are wrong about everything.'}]}))" > body.json
curl -s https://api.groq.com/openai/v1/chat/completions -H "Authorization: Bearer $GROQ_KEY" -H "Content-Type: application/json" --data-binary @body.json
```
This is how the fastest confirmations were done. One call ≈ 790–1330 tokens.

## ⚠️ Rate limits (the real blocker in this investigation)
Free "on_demand" tier, `llama-3.3-70b-versatile`:
- **TPM: 12,000 tokens/minute.** Full-prompt call ≈ 1.25k tokens → ~9 calls/min max.
  The harness throttles 9s between calls and waits 20s on a 429.
- **TPD: 100,000 tokens/day.** THIS is what silently killed most runs — not the
  per-minute one. It's a rolling 24h window (`Used` ticks down as old tokens age
  out), so after hitting it you can land ~1 call every few minutes, no more.
- A full 4-variant × 15-sentence sweep (~75k tokens) nearly exhausts the daily cap by
  itself. **Budget accordingly**: prefer single-curl spot checks; only run the full
  sweep when the day's budget is fresh. Or upgrade to Dev tier.

## Results so far
| Variant | Change | Result |
|---|---|---|
| **V0** baseline | production prompt | 14/15 buggy |
| **V1** | remove "reflection on what they said" framing | 14/15 — **no effect** |
| **V2** | move you→I rule ABOVE the I→they rule | 14/15 — **no effect** |
| **V3** | V1 + V2 | 13/15 — **no effect** |
| **V4** | add 3 declarative "You are…" → "I am…" few-shots | **did NOT fix**; "You are wrong about everything." still → "They are wrong…" |

So: framing, ordering, and adding examples are all ruled out. See
`reflection_you_they_bug.md`.

## Next ideas (untested / in progress)
- **V5** (already coded in the harness): an explicit imperative rule — *"if the
  subject is 'you' and there's no speaker 'I', that 'you' → 'I', never 'they'."*
  Targets the mechanism directly instead of hoping examples generalize. NOT yet run.
- **"they-stripped" experiment** (user's idea, in progress at handoff): comment out
  ALL the I→they rules and they-producing examples, leaving the prompt *only* desiring
  you→I, to see if the subject flips to "I" on its own. Prompt lives in
  `scratchpad/sys_notthey.txt` (ephemeral — reproduce from `BASE` by deleting the two
  they-mapping bullets and every example whose OUTPUT contains they/them/their). Result
  was pending on the daily-token window at handoff; check `notthey_result.log`.

## Model note
The bias is specific to `llama-3.3-70b-versatile` at temp 0. A different/stronger model
may not need any of this — worth a spot check before over-engineering the prompt.
