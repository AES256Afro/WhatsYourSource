import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { EXTENSION_DESCRIPTION, EXTENSION_NAME } from './src/lib/meta';

// One codebase, two targets: `wxt build` (Chrome MV3) and `wxt build -b firefox` (Firefox MV3).
// WXT generates the right background shape (service worker vs event page) and the right
// side panel key (`side_panel` vs `sidebar_action`) from the entrypoints.
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: EXTENSION_NAME,
    short_name: EXTENSION_NAME,
    description: EXTENSION_DESCRIPTION,
    permissions: ['contextMenus', 'storage', 'unlimitedStorage', 'activeTab', 'scripting'],
    // sidePanel needs 114; AbortSignal.any (used by the page fetcher) needs 116.
    ...(browser === 'firefox' ? {} : { minimum_chrome_version: '116' }),
    // Firefox's MV3 default is "script-src 'self'; upgrade-insecure-requests", which silently turns
    // http://localhost:11434 into https:// and breaks every local model. Say exactly what we want.
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';" },
    host_permissions: [
      'https://generativelanguage.googleapis.com/*',
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      'https://api.search.brave.com/*',
      'https://api.tavily.com/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    // Requested per site, on demand (image bytes, page fetches for local models).
    ...(browser === 'firefox' ? { optional_permissions: ['<all_urls>'] } : { optional_host_permissions: ['<all_urls>'] }),
    commands: {
      'check-selection': {
        // Not Ctrl+Shift+S: Firefox binds that to Take Screenshot, and Cmd+Shift+S is taken on macOS.
        suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
        description: 'Check the source of the selected text',
      },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'whatsyoursource@aes256afro.github.io',
              strict_min_version: '140.0',
              // AMO requires this. The only thing ever sent off-device is the content the user
              // explicitly asks to check, to the AI provider they configured.
              data_collection_permissions: { required: ['websiteContent'] },
            },
          },
        }
      : {}),
  }),
});
