import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/** `npm run preview` — the side panel UI against a fake browser API. Not part of the extension build. */
export default defineConfig({
  root: 'preview',
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5174, strictPort: true },
});
