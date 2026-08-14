import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Vitest's own config, deliberately NOT `vite.config.js`.
//
// The app's config wraps everything in VitePWA, which generates a service worker
// on load. A test run has no use for one and generating it just adds noise and
// files. Vitest prefers this file when both exist, so the app build keeps its PWA
// plugin and the suite never sees it.
//
// Everything here is mocked — no API keys, no network, no microphone. That is the
// whole reason this suite can run in CI while `reflection-bias-test/` (which makes
// real paid calls) cannot.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      // main.jsx is the ReactDOM mount call, prompt files are string constants,
      // and icons are static SVG paths. Nothing in any of them can fail a test.
      exclude: [
        'src/main.jsx',
        'src/services/aporius-prompt.js',
        'src/services/reflection-prompt.js',
        'src/components/icons/**',
        'src/**/*.test.{js,jsx}',
      ],
      reporter: ['text', 'html'],
    },
  },
})
