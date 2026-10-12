import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/app.css';
import { OptionsApp } from '@/ui/options/OptionsApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
