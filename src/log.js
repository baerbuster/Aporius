// Logging.
//
// Turn the trace logs on:   localStorage.setItem('aporius_debug', '1')  then reload
// Turn them off again:      localStorage.removeItem('aporius_debug')
//
// ── Why a runtime flag and not import.meta.env.DEV ──────────
// The usual move is to strip debug logging out of production at build time. That
// is wrong here: the Dock app serves a BUILD (see docs/dock-app.md), so build-time
// stripping would kill these logs in the one place they actually get read. A
// localStorage flag works in the Dock app, in the PWA, and in `npm run dev`
// alike, and it survives reloads.
//
// ── What goes where ─────────────────────────────────────────
// debug()          trace: timings, per-sentence reflections, transcripts. OFF by
//                  default. These print what the user said out loud — the
//                  transcript, every reflected sentence, the whole ranked list.
//                  That is the most private content in the app, so it is not
//                  written to the console unless someone deliberately asks for it.
// console.warn     degraded but recovered: quota fallbacks, a rejected reflection,
//                  a dropped socket. Left unwrapped and always on — this is how
//                  you find out ElevenLabs ran dry.
// console.error    something broke. Left unwrapped and always on.

const DEBUG_KEY = 'aporius_debug'

// Read once at module load. Flipping the flag needs a reload, which keeps this a
// plain boolean check on a hot path rather than a storage read per call.
let enabled = false
try {
  enabled = localStorage.getItem(DEBUG_KEY) === '1'
} catch {
  enabled = false
}

export function debug(...args) {
  if (enabled) console.log(...args)
}
