import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

// ESLint flat config.
//
// Scope note: this project has four separate JavaScript environments, and a single
// global set would either miss real bugs or invent fake ones. They are configured
// separately below:
//
//   src/          browser + React     the app
//   public/       AudioWorklet        no window, no DOM — its own globals
//   scripts/      Node                the build's sync step
//   tools/        browser, no React   the prompt bench
//
// `eslint-config-prettier` goes last in every block: it switches OFF the stylistic
// rules Prettier already owns, so the two tools can never disagree about formatting.

export default [
  {
    // `coverage/` is the v8 reporter's generated HTML report, not source.
    ignores: ['dist/**', 'node_modules/**', 'Aporius.app/**', 'coverage/**'],
  },

  // ── The app ──────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,

      // The two classic hook rules, enabled by name rather than via the plugin's
      // `recommended-latest` preset. That preset also turns on the newer
      // `react-hooks/purity` and `react-hooks/refs` rules, which flag 15 places in
      // this codebase — the Path B timing probes calling performance.now() inside
      // handleSpeakAporius (an event handler, not render — a false positive), and
      // the latest-value ref assignment in useAudioCapture.js:51, which is
      // deliberate and commented. Adopting those rules is a real decision about
      // this code; it is not the same decision as "configure a linter".
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // This codebase uses the modern JSX transform — React is not in scope and
      // does not need to be imported for JSX to work.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // Prop-types are a runtime type system this project doesn't use.
      'react/prop-types': 'off',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Empty catch blocks are deliberate throughout the teardown paths — a
      // disconnect that throws because the node is already gone is not an error.
      // Requiring a comment keeps them honest without forcing dead handlers.
      'no-empty': ['error', { allowEmptyCatch: true }],

      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ── The test suite ───────────────────────────────────────
  // Same browser environment as the app (jsdom), plus Vitest's globals, which
  // are injected by the runner rather than imported — `globals: true` in
  // vitest.config.js. Without this block every `describe` is a no-undef error.
  {
    files: ['src/**/*.test.{js,jsx}', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.vitest },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { react },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...js.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ── AudioWorklet — runs on the audio thread, not the main thread ──
  {
    files: ['public/audio-processor.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.worker,
        // Supplied by the AudioWorklet scope itself; absent from `globals`.
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
        currentFrame: 'readonly',
      },
    },
    rules: js.configs.recommended.rules,
  },

  // ── Build scripts and the .mjs harnesses ──────────────────
  {
    files: ['scripts/**/*.{js,mjs}', 'reflection-bias-test/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: js.configs.recommended.rules,
  },

  // ── The prompt bench: browser, but no React ──────────────
  {
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: js.configs.recommended.rules,
  },

  prettier,
]
