import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The service worker is what makes Aporius installable/offline on a phone —
// and also what makes a desktop test build show yesterday's screen. So it is
// off by default and on only for phone builds:
//
//   npm run build         → testing. No service worker. Always the latest code.
//   npm run build:phone   → shipping. Full PWA, installable, works offline.
//
// With PWA off, selfDestroying emits a worker whose only job is to unregister
// any previously installed one, so old copies clear themselves out.
const PWA_ENABLED = process.env.APORIUS_PWA === '1'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      selfDestroying: !PWA_ENABLED,
      registerType: 'autoUpdate',
      includeAssets: ['*.png', '*.jpg'],
      manifest: {
        name: 'Aporius',
        short_name: 'Aporius',
        description: 'A Greek philosopher trapped in your phone.',
        display: 'fullscreen',
        orientation: 'portrait',
        background_color: '#DDCEC0',
        theme_color: '#DDCEC0',
        icons: [
          {
            src: '/thinker.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/thinker.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
