// The reflection phase's voice — everything Aporius says before he answers.
//
// That whole phase is him thinking aloud to himself: the murmurs AND the
// speaker's own sentences turned over out loud. It is not addressed to anyone,
// so it should not sound addressed to anyone. This gives all of it the same
// treatment; his actual reply is the only thing that comes through at full
// presence, which is what makes the contrast land.
//
// A lowpass filter was tried here and cut — muffling the voice sounded bad
// rather than private. Level, placement and pace do the work instead.
//
// Signal chain: <audio> → panner → gain → speakers.

// ── Tune these by ear ──────────────────────────────────────
const GAIN = 0.9 // level, replacing the element's own volume
const PLAYBACK_RATE = 0.85 // slower than his speaking voice
const PRESERVE_PITCH = true // true → rate changes speed only, pitch stays put
const PAN_SPREAD = 0.35 // each clip lands at a random ±this. 0 = dead centre.
//                         Barely audible on a phone speaker; lands on headphones.

// One AudioContext for the app's lifetime. Created lazily on the first clip,
// which always follows a button press, so it is never blocked by autoplay policy.
let ctx = null

function audioContext() {
  if (ctx) return ctx
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (Ctor) ctx = new Ctor()
  return ctx
}

// Build the graph for one clip. Returns a teardown that unwinds it.
function connectGraph(ac, audio) {
  const src = ac.createMediaElementSource(audio)

  const gain = ac.createGain()
  gain.gain.value = GAIN

  // createStereoPanner is missing on some older WebKit builds; the chain just
  // skips that link there.
  const panner = ac.createStereoPanner ? ac.createStereoPanner() : null
  if (panner) panner.pan.value = (Math.random() * 2 - 1) * PAN_SPREAD

  const nodes = panner ? [src, panner, gain] : [src, gain]
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
  gain.connect(ac.destination)

  return () => {
    for (const n of nodes) {
      try { n.disconnect() } catch { /* already torn down */ }
    }
  }
}

// Play one clip through the chain, resolving when it ends.
//
// Note an element routed into an AudioContext stops honouring its own `volume`,
// so level is set on the gain node instead. If Web Audio is unavailable the clip
// still plays, just dry — never silently dropped.
export function playMurmur(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url)
    audio.playbackRate = PLAYBACK_RATE
    // Standard property plus the two vendor spellings still in the wild.
    audio.preservesPitch = PRESERVE_PITCH
    audio.mozPreservesPitch = PRESERVE_PITCH
    audio.webkitPreservesPitch = PRESERVE_PITCH

    let teardown = () => {}
    const ac = audioContext()

    if (ac) {
      try {
        if (ac.state === 'suspended') ac.resume()
        teardown = connectGraph(ac, audio)
      } catch (err) {
        console.warn('[Murmur] filter unavailable, playing dry:', err?.message || err)
        audio.volume = GAIN
      }
    } else {
      audio.volume = GAIN
    }

    const done = () => {
      teardown()
      resolve()
    }
    audio.onended = done
    audio.onerror = done
    audio.play().catch(done)
  })
}
