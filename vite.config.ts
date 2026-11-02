import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-180.png'],
      manifest: {
        name: 'Gate Runner',
        short_name: 'Gate Runner',
        description: 'Shoot through gates, multiply your bullets, hold the line.',
        display: 'fullscreen',
        orientation: 'portrait',
        background_color: '#0b0820',
        theme_color: '#0b0820',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
});
