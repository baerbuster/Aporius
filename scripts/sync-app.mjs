// Pushes the freshly built site to the copy the Dock app actually serves.
//
// The launcher cannot read the Desktop (macOS TCC blocks Dock-launched apps
// from the Desktop folder), so the runnable copy lives in
// ~/Library/Application Support/Aporius. This runs automatically after every
// `npm run build`, so that copy can never fall behind the source again.

import { cpSync, rmSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const PROJECT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(PROJECT, 'dist')
const APP_HOME = join(homedir(), 'Library', 'Application Support', 'Aporius')

if (!existsSync(DIST)) {
  console.error(`[sync-app] no build to sync — ${DIST} does not exist`)
  process.exit(1)
}

mkdirSync(APP_HOME, { recursive: true })

// Stage then swap, so a crash mid-copy can't leave a half-written app.
const staging = join(APP_HOME, 'dist.incoming')
const live = join(APP_HOME, 'dist')
const retired = join(APP_HOME, 'dist.old')

rmSync(staging, { recursive: true, force: true })
cpSync(DIST, staging, { recursive: true })

rmSync(retired, { recursive: true, force: true })
if (existsSync(live)) renameSync(live, retired)
renameSync(staging, live)
rmSync(retired, { recursive: true, force: true })

const stamp = new Date().toISOString()
writeFileSync(join(APP_HOME, 'BUILD_STAMP'), `${stamp}\n`)

// The launcher's web server. Kept here (not in dist) so a rebuild never
// deletes it. Sends no-store on everything: the app is served from localhost,
// so caching buys nothing and costs stale screens.
writeFileSync(join(APP_HOME, 'serve.py'), `#!/usr/bin/env python3
# Static server for Aporius. Every response is no-store so the Chrome window
# can never show a build older than the files on disk.
import sys, os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop validators so the browser cannot answer from its own cache.
        if keyword.lower() in ('last-modified', 'etag'):
            return
        super().send_header(keyword, value)

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8890
    root = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    os.chdir(root)
    ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
`)

console.log(`[sync-app] Dock app updated → ${live}`)
console.log(`[sync-app] build stamp ${stamp}`)
