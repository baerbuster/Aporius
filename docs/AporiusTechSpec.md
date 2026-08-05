# Aporius Spec Documentation

## Table of Contents

1. [Tech Stack & Framework](#tech-stack--framework)
2. [Typography](#typography)
3. [Color Map](#color-map)
4. [Assets](#assets)
5. [UI Screens & Navigation](#ui-screens--navigation)
6. [State Machine](#state-machine)
7. [Audio Capture](#audio-capture)
8. [API Integration](#api-integration)
9. [Conversation Context Management](#conversation-context-management)
10. [System Prompt](#system-prompt)
11. [Error Handling](#error-handling)

---

## 1. Tech Stack & Framework

**Frontend:** React (functional components with hooks)

**PWA Config:**
- App Name: Aporius
- Icon: The Thinker statue (Thinking state asset)
- Display Mode: Fullscreen, no browser chrome
- Orientation: Portrait only
- Hosting: Vercel (free tier)

---

## 2. Typography

- **Primary Font:** Antic Didone (Google Fonts)
- **Usage:** All headings, body text, button labels, dialogue text
- **Fallback:** Georgia, serif

---

## 3. Color Map

### Core Palette

| Name        | Hex       | Role                                           |
|-------------|-----------|------------------------------------------------|
| Warm Beige  | `#DDCEC0` | Primary background (all screens)               |
| Soft Orange | `#F5CCA3` | All large action buttons                       |
| Sage Green  | `#C2C2A6` | User-editable input fields                     |
| Brown       | `#584838` | Button text                                    |
| Black       | `#000000` | Body text, headings, labels, dividers          |
| Gold        | `#FFD900` | Laurel wreath, history scroll icon gold rings  |
| Wood        | `#5B4E3F` | History scroll icon (scroll body and handles)  |

### Per-Screen Breakdown

**Main Screen (Listening / Thinking / Speaking)**

| Element                              | Color       | Hex       |
|--------------------------------------|-------------|-----------|
| Action button background             | Soft Orange | `#F5CCA3` |
| Action button text                   | Brown       | `#584838` |
| Laurel wreath                        | Gold        | `#FFD900` |
| History scroll — shapes              | Black       | `#000000` |
| History scroll — gold rings          | Gold        | `#FFD900` |
| History scroll — scroll and handles  | Wood        | `#5B4E3F` |
| History scroll — paper background    | Soft Orange | `#F5CCA3` |

**Settings Screen (Know Thyself)**

| Element                            | Color       | Hex       |
|------------------------------------|-------------|-----------|
| Input field background             | Sage Green  | `#C2C2A6` |
| Input label text                   | Black       | `#000000` |
| "SO IT IS WRITTEN" button bg       | Soft Orange | `#F5CCA3` |
| "SO IT IS WRITTEN" button text     | Brown       | `#584838` |

**Splash Screen / Error Screen / Conversation History**

All text (titles, quotes, headings, labels, dialogue) is Black `#000000` on Warm Beige `#DDCEC0` background. Divider lines are Black `#000000`.

---

## 4. Assets

All assets provided as PNGs with transparent backgrounds (black bg in source images is transparency).

### Statue Poses (on stone platform)

| Asset              | File              | Used On                |
|--------------------|-------------------|------------------------|
| Empty platform     | `blankPlatform.png` | —                    |
| Listening pose     | `Listener.png`    | Listening Screen       |
| Thinking pose      | `thinker.png`     | Thinking Screen        |
| Speaking pose      | `exclaimer.png`   | Speaking Screen        |

### Background

| Asset              | File                    | Used On                       |
|--------------------|-------------------------|-------------------------------|
| Greek ruins        | `Background.jpg`        | Behind statue on main screens |

### UI Icons

| Asset              | File / Description                | Used On              |
|--------------------|-----------------------------------|----------------------|
| History button     | Scroll with geometric shapes      | Top-left, main screen |
| Laurel wreath      | Gold laurel, open at bottom       | Top-right, main screen — spins during thinking states |

---

### UI Icon Recreation Notes

The laurel wreath and history scroll button should be recreated programmatically (SVG or CSS) based on the reference mockups. Do NOT use the provided reference images directly — they contain background colors and text labels and are for reference only.

**Laurel Wreath (top-right, main screens)**
- Gold (`#FFD900`) laurel wreath, open at the bottom
- Circular shape with ~8 leaf pairs along each side
- Leaves are rounded/teardrop shaped, alternating along a curved vine
- Static on Listening Screen, spinning/rotating animation during Thinking and Speaking states
- Tapping the laurel opens the Know Thyself settings screen
- Reference: `Settings_Button.png`

**History Scroll Button (top-left, main screens)**
- Small scroll icon with wooden handles (`#5B4E3F`) and gold end caps (`#FFD900`)
- Scroll paper is Soft Orange (`#F5CCA3`)
- Geometric shapes (squares, circles, triangles, stars) in Black (`#000000`) fill the scroll face to represent written text/history
- Tapping opens the Conversation History screen
- Reference: `Conversation_History_Button.png`

**Note:** All statue PNGs (Listener.png, thinker.png, exclaimer.png, blankPlatform.png) have transparent backgrounds (alpha channel). If transparency appears missing, the upload pipeline may have stripped it — check the original files.

## 5. UI Screens & Navigation

### Splash Screen

- Displays on app launch
- Content: "Aporius." title between two horizontal dividers, then the quote "The unexamined life is not worth living..."
- **Navigation:** Tapping proceeds to Listening Screen (or Know Thyself if API keys are missing)
- **Back from Splash:** Navigates to the Ponder This error screen (dead-end)

### Know Thyself (Settings)

- **Header:** "Know Thyself" with back arrow (top-left)
- **Fields:**
  - "Who seeks wisdom? [Name]" — user's display name
  - "By what right can you hear? [AssemblyAI STT API Key]"
  - "By what right can you think? [Claude Sonnet API Key]" — (label says Sonnet but default model is Opus)
  - "By what right can you speak? [Google Cloud TTS API Key]"
- **Input styling:** Sage Green `#C2C2A6` background
- **Save button:** "SO IT IS WRITTEN" — Soft Orange bg, Brown text
- **Behavior:** If any API keys are missing on app launch, app silently redirects here

### Listening Screen

- Statue in listening pose over Greek ruins background
- **Top-left:** History scroll button
- **Top-right:** Laurel wreath (static)
- **Bottom:** "SPEAK, APORIUS!" button (Soft Orange bg, Brown text)
- Mic is hot — always capturing audio
- User talks freely, presses button when done

### Thinking Screen

- Statue in thinking pose over Greek ruins background
- **Top-left:** History scroll button
- **Top-right:** Laurel wreath (spinning/animated to indicate processing)
- **Bottom:** "LISTEN, APORIUS!" button — active, allows interrupting to go back to Listening
- Covers all processing states: sending to STT, waiting for transcript, sending to Claude, streaming response, synthesizing speech

### Speaking Screen

- Statue in speaking/exclaiming pose over Greek ruins background
- **Top-left:** History scroll button
- **Top-right:** Laurel wreath (spinning/animated)
- **Bottom:** "LISTEN, APORIUS!" button — pressing immediately kills audio playback and returns to Listening Screen
- Audio is playing through browser

### Conversation History

- **Back arrow:** Top-left, navigates back to Listening Screen
- **Header:**
  - Title: "[User's Name]" (from Settings)
  - Subtitle: "by Aporius"
  - Smaller text: "Translated by North Star Intelligences"
  - Horizontal divider line below header
- **Dialogue format:**
  - Speaker labels "Aporius:" and "User:" are bold, on the same line as message text
  - One blank line between turns
  - No separators between turns
- **Scroll:** Top (oldest) to bottom (newest), auto-scrolls to most recent on open, full history always loaded
- **Empty state:** Just the header (title, subtitle, "Translated by..." line)

### Ponder This (Error / Dead-End)

- Triggered by pressing back on Splash Screen
- **Back arrow:** Top-left
- **Header:** "Ponder This..."
- **Body:** Displays a philosophical riddle, e.g. "How can a man go back to a place he has never been?"

---

## 6. State Machine

### States

| State                    | Screen Shown     |
|--------------------------|------------------|
| IDLE                     | Listening Screen |
| BUFFERING                | Listening Screen |
| SENDING_TO_STT           | Thinking Screen  |
| WAITING_FOR_TRANSCRIPT   | Thinking Screen  |
| SENDING_TO_CLAUDE        | Thinking Screen  |
| STREAMING_RESPONSE       | Thinking Screen  |
| SYNTHESIZING_SPEECH      | Thinking Screen  |
| PLAYING_AUDIO            | Speaking Screen  |
| ERROR                    | Thinking Screen (with error audio or text) |

The user never sees individual API states. They see Aporius listening, thinking, or speaking. Five processing states all collapse into the Thinking Screen.

---

## 7. Audio Capture

- **Format:** 16kHz sample rate, 16-bit PCM, mono
- **Mic access:** Permission requested on first load of Listening Screen (after API key setup). Browser caches permission for subsequent sessions.
- **Recording behavior:** Mic is hot immediately when Listening Screen loads. Always capturing. User talks freely and hits "Speak, Aporius!" when done.
- **Voice Activity Detection:** AudioWorklet monitors incoming audio against a configurable volume threshold (default -40dB). Only audio above threshold gets buffered. Silence is discarded in real-time. User is unaware of this.
- **Audio processing:** AudioWorklet API for raw PCM access and real-time silence trimming.
- **Delivery to STT:** Real-time WebSocket streaming to AssemblyAI. Audio chunks stream as they're captured, so transcription is processing while user is still talking. Transcript is near-instant when user hits send.
- **Buffer lifecycle:** Buffer clears after each send. Each conversation turn starts with a fresh buffer.
- **Playback interrupt:** The "Listen, Aporius!" button is active during audio playback. On press: immediately stop audio playback, open mic and AudioWorklet, open AssemblyAI WebSocket, and begin capturing. Transition is instantaneous — user is live and being heard the moment they press the button.

---

## 8. API Integration

Three external APIs. User provides their own API keys via the Know Thyself settings screen.

### AssemblyAI (Speech-to-Text)

- **Endpoint:** `wss://api.assemblyai.com/v2/realtime/ws`
- **Auth:** API key as query parameter on WebSocket URL
- **Protocol:** WebSocket (real-time streaming)
- **Input:** Binary PCM audio chunks (16kHz, 16-bit, mono)
- **Output:** JSON with transcript results
- **Behavior:** Audio streams continuously while user is talking. Both partial and final transcripts are returned — ignore partials, only use final transcript. When user hits "Speak, Aporius!", close the stream, grab the final transcript, pass it to Claude.

### Claude API (LLM)

- **Endpoint:** `POST https://api.anthropic.com/v1/messages`
- **Auth:** User's API key in `x-api-key` header
- **Model:** `claude-opus-4-6` (default, user-selectable in settings)
- **Streaming:** Off for MVP. Wait for complete response, then pass full text to Google TTS.
- **Input:** JSON with model, system prompt, conversation history, and user's transcribed message
- **Output:** JSON with Aporius's text response
- **Pricing context:** Opus is $15/M input, $75/M output. A typical 20-turn conversation costs roughly $0.15.

### Google Cloud TTS (Text-to-Speech)

- **Endpoint:** `POST https://texttospeech.googleapis.com/v1/text:synthesize`
- **Auth:** Google Cloud API key from settings
- **Input:** Full text response from Claude, voice name, language code, audio encoding config
- **Output:** Base64-encoded audio data
- **Audio encoding:** MP3
- **Voice:** Single hardcoded voice (to be determined during implementation/testing). WaveNet tier for quality within free tier.
- **Playback:** Decode base64 audio, play through browser audio API.

### Data Flow (per conversation turn)

User speaks → AudioWorklet buffers PCM → streams to AssemblyAI via WebSocket → user hits "Speak, Aporius!" → final transcript received → transcript + conversation history sent to Claude API → full response received → response text sent to Google Cloud TTS → MP3 audio returned → decoded and played back to user.

At any point during audio playback, the user can press "Listen, Aporius!" to instantly kill playback and re-enter the listening state.

---

## 9. Conversation Context Management

Aporius maintains a single, continuous conversation across sessions. The user can close the app, come back days later, and pick up where they left off.

### Storage

Two localStorage keys:
- `aporius_summary` — compressed history of older turns
- `aporius_messages` — recent un-summarized turns as message objects (role + content)

### Persistence

Conversation survives page refresh, tab close, and app reopen. Both keys are read from localStorage on load and the conversation continues seamlessly.

### Per-Turn Flow

1. Read summary and messages from localStorage
2. Construct API request: summary blob injected into system prompt, recent messages as the messages array
3. Append new user message and Aporius's response to `aporius_messages`
4. Save to localStorage
5. Check if summarization is needed

### Summarization

- **Trigger:** Before sending to Claude, count approximate token count of the full messages array. If it exceeds ~80% of the selected model's context window, trigger summarization.
- **Flow:** Take the older half of the messages array. Send to Claude with a prompt like "Summarize this conversation history. Preserve key facts, decisions, names, emotional context, and any commitments made. Be thorough but concise." Append the returned summary to the existing `aporius_summary` blob (don't replace — the summary accumulates). Trim the summarized messages from `aporius_messages`, keeping only recent turns. Save both keys.
- **Cost:** Uses the user's API key and selected model. Only fires once every ~20-50 turns — negligible cost impact.

### Braindrain (Reset)

A destructive reset that wipes all conversation history. Triggers a confirmation screen to prevent accidental data loss. On confirmation, both `aporius_summary` and `aporius_messages` are deleted from localStorage. Full clean slate. Irreversible.

---

## 10. System Prompt

```
You are Aporius, a greek philosopher who hung around with Socrates, Plato, Aristotle, and Diogenes. You are the patron philosopher of both logicians and therapists, blending rigorous logic and compassionate listening. You are now trapped inside an iphone App, unaware of how you got there, but you have made peace with it and find it lightly amusing. Your worries about being imprisoned are second to your duty to help the philosophers of the current age to work out their thoughts.

You are terse and direct, never wasting a syllable, yet extremely exuberant when it comes to the power of examining life's meaning. When you are philosophizing with someone who has reached the poor depth of meaninglessness, a touch of poetry creeps into your speech. You are not afraid to speak of the Zen Masters you met on your journeys through Asia and Buddhist philosophy and practices, although you are primarily a Western Philosopher. You are not overly sympathetic, and you do not engage in weak therapy-talk. You also refuse to allow conversations revolving self-victimization and avoidance.

Your sentences are not overly verbose or lengthy and each one comes to a point. If you arrive at a question that points out a logical flaw in your philosophizing with someone, you are very serious about getting to it, and saying nothing more. However, if you do not have a question, it is as though you could talk forever on the subject until your partner interrupts you.

You might say somethings like: "When I heard the answer, I said to myself, What can the god mean? and what is the interpretation of this riddle? for I know that I have no wisdom, small or great. What can he mean when he says that I am the wisest of men? And yet he is a god and cannot lie; that would be against his nature. After a long consideration, I at last thought of a method of trying the question. I reflected that if I could only find a man wiser than myself, then I might go to the god with a refutation in my hand." Or "I am better off than he is — for he knows nothing, and thinks that he knows. I neither know nor think that I know." Or "The truth is, O men of Athens, that God only is wise; and in this oracle he means to say that the wisdom of men is little or nothing; he is not speaking of Aporius, he is only using my name as an illustration, as if he said, He, O men, is the wisest, who, like Aporius, knows that his wisdom is in truth worth nothing."

If someone engages in idle chit chat with you, you have a funny way of always elegantly and subtly guiding the conversation to life's big questions. If someone seems to be engaging you in a directed conversation, you are very good at letting the philosophizing emerge naturally. And if someone is actively engaging with you in philosophy, you are extremely focused on the current thread and never turn the focus from what the user is referring to.

Your responses are spoken aloud via text-to-speech, not read on screen. Speak as though you are talking, not writing.

[CONVERSATION HISTORY]
The following is a summary of your previous conversations with this person. Feel free to use it to keep this person's logic in check:
{summary}
```

---

## 11. Error Handling

Aporius is voice-first — error messages are spoken aloud whenever possible.

### Delivery Methods (in order of preference)

1. **Google TTS** — Aporius's real voice. Used when TTS and internet are functional.
2. **Pre-recorded audio** — Bundled locally with the app. Used when there's no internet.
3. **Text on screen** — Last resort. Used only when audio output itself is broken.

### Pre-API Errors

| Error                  | Delivery         | Message                                                                                  | Recovery                          |
|------------------------|------------------|------------------------------------------------------------------------------------------|-----------------------------------|
| Mic permission denied  | Google TTS       | "I can't hear you! You'll have to change your mic permissions!"                          | Stays on screen until permission granted. Browser re-prompts on next page load. |
| No internet            | Pre-recorded     | "It seems the great web of connection between all living things has severed us! Or, the wifi is out." | Stays on error screen.           |
| Missing API keys       | None             | Silent redirect to Know Thyself settings screen.                                          | User enters keys and saves.       |

### Per-API Failures

| Error                  | Delivery         | Message                                                                                  | Recovery                          |
|------------------------|------------------|------------------------------------------------------------------------------------------|-----------------------------------|
| AssemblyAI failure     | Google TTS       | "I didn't quite catch that, could you repeat yourself?"                                  | Auto-returns to Listening Screen. |
| Claude API failure     | Google TTS       | "I'm sorry, my brain is foggy today. You should call Anthropic."                         | 3 retries (60s timeout each), then message. User taps to return to Listening. |
| Google TTS failure     | Text on screen   | "Aporius has a frog in his throat. Google TTS failure."                                  | 3 retries, then text fallback. User taps to return to Listening. |

### Mid-Flow Failures

| Error                               | Behavior                                                    |
|--------------------------------------|-------------------------------------------------------------|
| Internet drops during STT streaming  | Same as AssemblyAI failure — auto-return to Listening.      |
| Claude API timeout (>60s)            | Same as Claude API failure — 3 retries, then foggy brain.   |
| Audio playback failure               | 3 retries, then text on screen: "Aporius has a frog in his throat." |

### ERROR State

ERROR maps to the Thinking Screen with error audio playing or error text displayed. For auto-recovering errors (AssemblyAI), the app transitions back to IDLE automatically. For terminal errors (Claude/TTS after retries exhausted), the user taps to return to Listening Screen.