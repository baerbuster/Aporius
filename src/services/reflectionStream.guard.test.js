import { describe, it, expect } from 'vitest'
import {
  rawTokens,
  expandedTokens,
  passesGuard,
  trimOriginal,
  normalizeScore,
  extractJson,
} from './reflectionStream'

// Layer 1 — the validation guard and its helpers.
//
// This is the place a bug hides in total silence: a guard that is too loose lets
// an invented sentence through and Aporius murmurs something the speaker never
// said; a guard that is too tight rejects every reflection and every murmur
// silently becomes the trimmed original. Neither throws. Neither logs an error a
// user would ever see. So it gets pinned here.

describe('rawTokens', () => {
  it('lowercases, strips punctuation, and splits on whitespace', () => {
    expect(rawTokens('The Cat, sat!')).toEqual(['the', 'cat', 'sat'])
  })

  it('collapses apostrophes rather than splitting on them', () => {
    // "don't" must stay ONE token — splitting it would put a bare "t" in the set.
    expect(rawTokens("don't")).toEqual(['dont'])
  })

  it('normalizes curly apostrophes to straight ones first', () => {
    // Deepgram's smart_format emits curly quotes; the model replies with straight
    // ones. Without normalizing, "you're" and "you’re" are different tokens.
    expect(rawTokens('you’re')).toEqual(rawTokens("you're"))
  })

  it('drops empty tokens from repeated whitespace', () => {
    expect(rawTokens('  a   b  ')).toEqual(['a', 'b'])
  })

  it('returns an empty list for a string with no words', () => {
    expect(rawTokens('... !?')).toEqual([])
  })
})

describe('expandedTokens', () => {
  it.each([
    ["I'm tired", ['i', 'am', 'tired']],
    ["you're tired", ['you', 'are', 'tired']],
    ["I've seen", ['i', 'have', 'seen']],
    ["you'll see", ['you', 'will', 'see']],
    ["you'd know", ['you', 'would', 'know']],
    ["won't stop", ['will', 'not', 'stop']],
    ["can't stop", ['can', 'not', 'stop']],
    ["doesn't stop", ['does', 'not', 'stop']],
    ["she's leaving", ['she', 'is', 'leaving']],
    ["that's it", ['that', 'is', 'it']],
  ])('expands %s', (input, expected) => {
    expect(expandedTokens(input)).toEqual(expected)
  })

  it("treats a possessive 's as the bare noun, not a copula", () => {
    // "Sarah's book" is not "Sarah is book" — the generic \w+'s rule drops the 's
    // entirely, and only the listed pronouns get the "is" treatment.
    expect(expandedTokens("Sarah's book")).toEqual(['sarah', 'book'])
  })
})

describe('passesGuard', () => {
  it('passes a sentence returned unchanged', () => {
    expect(passesGuard('I am tired.', 'I am tired.')).toBe(true)
  })

  it('passes the legitimate first-to-second person swap', () => {
    // The whole point of the transform: "I am" becomes "you are", and both of
    // those forms are in BASE_ALLOWED.
    expect(passesGuard('I am tired.', 'You are tired.')).toBe(true)
  })

  it('rejects an invented word', () => {
    // The failure the guard exists for: a paraphrase that means the same thing
    // but uses a word the speaker never said.
    expect(passesGuard('I am tired.', 'You are exhausted.')).toBe(false)
  })

  it('rejects a they-form, now that the speaker maps to you', () => {
    // Pins the 2026-07-29 prompt switch. When the prompt spoke in they-form,
    // "they" was in BASE_ALLOWED; it was removed when the prompt moved to
    // you-form. If someone re-adds it without switching the prompt back, this
    // fails loudly instead of the murmurs quietly changing person.
    expect(passesGuard('I am tired.', 'They are tired.')).toBe(false)
  })

  it('still passes a third-party they that was in the original', () => {
    // "they" is not allowed by default, but it IS in the original's token set,
    // so a sentence genuinely about other people survives.
    expect(passesGuard('They left without me.', 'They left without you.')).toBe(true)
  })

  it('passes a contraction the model expanded', () => {
    expect(passesGuard("She's leaving.", 'She is leaving.')).toBe(true)
  })

  it('passes a contraction the model introduced', () => {
    expect(passesGuard('I am tired.', "You're tired.")).toBe(true)
  })

  it('ignores case and punctuation differences', () => {
    expect(passesGuard('i am TIRED', 'I am tired...')).toBe(true)
  })

  it('accepts the user name when one is supplied', () => {
    expect(passesGuard('I am tired.', 'You are tired, Buster.', 'Buster')).toBe(true)
  })

  it('rejects that same name when none is supplied', () => {
    expect(passesGuard('I am tired.', 'You are tired, Buster.')).toBe(false)
  })

  it('accepts every word of a multi-part name', () => {
    expect(passesGuard('I am tired.', 'You are tired, Buster Baer.', 'Buster Baer')).toBe(true)
  })

  it('passes a purely subtractive edit', () => {
    // Cutting filler is allowed — every remaining word came from the original.
    expect(passesGuard('I mean, I am really quite tired.', 'You are tired.')).toBe(true)
  })

  it('passes an empty reflection', () => {
    // Vacuously true: no tokens to check. The caller drops empty reflections
    // before it ever reaches the guard, so this documents the contract rather
    // than a live path.
    expect(passesGuard('I am tired.', '')).toBe(true)
  })
})

describe('trimOriginal', () => {
  it('collapses runs of whitespace and trims the ends', () => {
    expect(trimOriginal('  I  am\n\ttired  ')).toBe('I am tired')
  })

  it('changes nothing else', () => {
    // The safety property: the fallback is subtractive by construction, so it
    // always passes the guard.
    const s = "I'm tired, and I don't know why."
    expect(trimOriginal(s)).toBe(s)
    expect(passesGuard(s, trimOriginal(s))).toBe(true)
  })
})

describe('normalizeScore', () => {
  it.each([
    [5, 5],
    ['7', 7],
    [4.6, 5],
    [4.4, 4],
  ])('keeps %s as %s', (input, expected) => {
    expect(normalizeScore(input)).toBe(expected)
  })

  it.each([
    [0, 1],
    [-3, 1],
    [11, 10],
    [999, 10],
  ])('clamps %s to %s', (input, expected) => {
    expect(normalizeScore(input)).toBe(expected)
  })

  it.each([['abc'], [undefined], [NaN], [{}]])(
    'falls back to 1 for the unparseable value %s',
    (input) => {
      expect(normalizeScore(input)).toBe(1)
    },
  )

  it('treats null as 0 and clamps it, rather than rejecting it', () => {
    // Number(null) is 0, not NaN — so null takes the clamp path, not the
    // fallback path. Same answer either way; noted so the difference is
    // deliberate rather than a coincidence someone "fixes" later.
    expect(normalizeScore(null)).toBe(1)
  })
})

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"reflected":"You are tired.","profundity":6}')).toEqual({
      reflected: 'You are tired.',
      profundity: 6,
    })
  })

  it('tolerates prose on either side', () => {
    expect(extractJson('Sure! {"profundity":3} Hope that helps.')).toEqual({ profundity: 3 })
  })

  it('keeps a nested object whole', () => {
    // Uses lastIndexOf('}'), so the closing brace of the OUTER object wins.
    expect(extractJson('{"a":{"b":2}}')).toEqual({ a: { b: 2 } })
  })

  it('throws when there is no object at all', () => {
    expect(() => extractJson('no json here')).toThrow('no JSON object in reply')
  })

  it('throws when the braces are in the wrong order', () => {
    expect(() => extractJson('} {')).toThrow('no JSON object in reply')
  })

  it('throws when the braces hold something unparseable', () => {
    // A different throw from the one above, but the caller treats both the same:
    // fall back for this sentence and keep the queue moving.
    expect(() => extractJson('{not json}')).toThrow()
  })
})
