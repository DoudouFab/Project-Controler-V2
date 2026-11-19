import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      regs.forEach((r) => {
        void r.unregister();
      });
    })
    .catch(() => {
      // Ignorer
    });
} else {
  try {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        void updateSW(true);
      },
    });
  } catch {
    // Service worker optionnel selon l'environnement
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  (window as unknown as { __PC_BOOTED__?: boolean }).__PC_BOOTED__ = true;
  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
