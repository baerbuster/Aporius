# The Dock app

Aporius runs as a native-feeling macOS app: a Dock icon that opens a phone-shaped
Chrome window with no browser chrome. There is no Electron and no packaging step
— it is the ordinary Vite build, served locally, wrapped in a four-file `.app`
bundle.

The whole thing exists because of one macOS security rule, and every odd decision
below traces back to it.

## The problem: TCC blocks the Desktop

macOS TCC (Transparency, Consent & Control) protects `~/Desktop`. A process
launched from the Dock by `launchd` gets **no permission to read files inside the
Desktop folder** — every open returns `Operation not permitted`. The project
lives on the Desktop, so a static server pointed at `Desktop/.../dist` can never
start when launched from the Dock. It works fine from Terminal (which has its own
TCC grant) and fails the moment you double-click the icon, which is exactly the
kind of bug that eats an afternoon.

## The fix: serve a copy from a non-protected location

The runnable copy of the built site lives at:

```
~/Library/Application Support/Aporius/
├── dist/         the built site (what Chrome loads)
├── serve.py      the static server (see below)
└── BUILD_STAMP   ISO timestamp of the last sync
```

`~/Library/Application Support` is not TCC-protected, so the launcher can read it.
The icon still sits on the Desktop where you want it; only the served bytes moved.

## Keeping the copy fresh

A second copy is a second thing that can go stale, so the sync is not a step you
remember — it is part of the build.

```
npm run build   →  vite build && node scripts/sync-app.mjs
```

[`scripts/sync-app.mjs`](../scripts/sync-app.mjs) stages into `dist.incoming`,
swaps it into place with a rename, retires the old copy, then writes
`BUILD_STAMP`. Staging-then-swapping means a crash mid-copy can never leave a
half-written app behind.

> **`npm run build:only` does not sync.** It is `vite build` with the sync
> deliberately omitted. It proves the bundle compiles while leaving the Dock app
> on the *previous* build — the exact staleness this pipeline exists to prevent.
> Use it only when you genuinely want a build the Dock app will not pick up.

## The server: `serve.py`

`sync-app.mjs` writes `serve.py` into `APP_HOME` — **outside** `dist/`, so a
rebuild that replaces `dist/` wholesale can never delete the server that serves it.

It is `http.server` with two modifications:

- every response carries `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
- `Last-Modified` and `ETag` are **dropped** on the way out

Without the second part the first part is not enough: Chrome will happily answer
from its own cache off a validator alone, and you get a window rendering a build
from two days ago while the files on disk are current. The app is served from
localhost, so caching buys nothing and costs stale screens.

## The launcher

[`Aporius.app/Contents/MacOS/Aporius`](../Aporius.app/Contents/MacOS/Aporius) is a
bash script. In order it:

1. Appends to `/tmp/aporius_launch.log`, recording the `BUILD_STAMP` it is about
   to serve — so "am I looking at an old build?" is one `cat` away.
2. Kills the previous instance: the recorded PID in `/tmp/aporius_server.pid`,
   then anything still squatting port **8890** (`kill`, then `kill -9`).
3. Starts `serve.py` on 8890 bound to `127.0.0.1`, falling back to plain
   `python3 -m http.server` if `serve.py` is somehow missing.
4. Polls the port with `curl` for up to 15s before opening the window — opening
   Chrome against a server that has not bound yet gives you a connection-refused
   page that does not retry.
5. `open -na "Google Chrome" --args --app=http://localhost:8890 --window-size=430,860`
   — app mode, phone-shaped.
6. Blocks in a `sleep 5` loop while the server PID is alive, so the Dock icon
   stays lit for as long as the app is actually running.

No Node is needed at runtime. It reuses the Python 3.13 framework build if
present, otherwise whatever `python3` is on `PATH`.

## Installing it

`Aporius.app/` sits at the repo root and is the live bundle — the one that is
tracked is the one that runs, so there is no copy to keep in sync.

```
npm install
npm run build      # populates ~/Library/Application Support/Aporius
```

Then drag `Aporius.app` to the Dock.

`Update Aporius.command`, also at the root, is kept only for muscle memory — it
`cd`s to its own directory and runs `npm run build`, which already syncs.

## Debugging

| What | Where |
|---|---|
| Launch log, incl. the served `BUILD_STAMP` | `/tmp/aporius_launch.log` |
| Server stdout/stderr | `/tmp/aporius_server.log` |
| Server PID | `/tmp/aporius_server.pid` |
| Build timestamp actually being served | `~/Library/Application Support/Aporius/BUILD_STAMP` |

If a change is not showing up, check `BUILD_STAMP` and the asset hashes in
`~/Library/Application Support/Aporius/dist/assets/` before suspecting anything
else. Nine times out of ten the copy simply did not move.

## Service worker

PWA precaching was rendering old builds during testing, so the service worker is
**off** for normal builds — `vite.config.js` sets `selfDestroying: true` unless
`APORIUS_PWA=1`. Build the installable PWA with `npm run build:phone`.
