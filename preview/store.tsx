import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/app.css';
import { installFakes } from './fakes';

/** Store-screenshot scene: a mock article beside the real side panel. `?scenario=` as in main.tsx, `&dark=1` for dark mode. */
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'home';
if (params.get('dark')) document.getElementById('scene')!.classList.add('dark');
const chip = document.getElementById('chip')!;
if (params.get('chip') !== '1') chip.hidden = true;
else {
  // Sit just under the end of the highlight, like the real chip does.
  const mark = document.querySelector('#quote mark')!;
  const rects = mark.getClientRects();
  const last = rects[rects.length - 1] ?? mark.getBoundingClientRect();
  const page = document.getElementById('page')!.getBoundingClientRect();
  chip.style.left = `${Math.round(last.right - page.left - chip.offsetWidth)}px`;
  chip.style.top = `${Math.round(last.bottom - page.top + 8)}px`;
}
if (scenario === 'image') document.getElementById('figure')!.hidden = false;

await installFakes(scenario);
const { App } = await import('@/ui/App');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
