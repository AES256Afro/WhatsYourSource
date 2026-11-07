import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

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
    name: 'WhatsYourSource',
    short_name: 'WhatsYourSource',
    description: 'Check the source of highlighted text, images and posts with the AI of your choice: Google AI by default, your own key, or a local model.',
    permissions: ['contextMenus', 'storage', 'unlimitedStorage', 'activeTab', 'scripting'],
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
              strict_min_version: '128.0',
              // AMO requires this. The only thing ever sent off-device is the content the user
              // explicitly asks to check, to the AI provider they configured.
              data_collection_permissions: { required: ['websiteContent'] },
            },
          },
        }
      : {}),
  }),
});
