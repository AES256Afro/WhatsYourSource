import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/app.css';
import { installFakes } from './fakes';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'home';

await installFakes(scenario);

if (scenario === 'popup') {
  document.getElementById('frame')!.classList.add('popup');
  const { PopupApp } = await import('@/ui/popup/PopupApp');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>,
  );
} else {
  const { App } = await import('@/ui/App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
