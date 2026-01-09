
import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui.css';
import App from './App';

// רישום ה-Service Worker עם טיפול בעדכונים
if ((import.meta as any).env?.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // גרסה חדשה זמינה, מרעננים את הדף
              window.location.reload();
            }
          });
        }
      });
    }).catch(err => console.log('SW registration failed:', err));
  });
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
