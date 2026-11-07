import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/app.css';
import { SnapshotPage } from '@/ui/SnapshotPage';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SnapshotPage />
  </React.StrictMode>,
);
