import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let globalIsInstalled =
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true);

const listeners = new Set<() => void>();
let captureInitialized = false;

function notifyAll() {
  listeners.forEach((fn) => fn());
}

export function initPWAInstallCapture(): void {
  if (captureInitialized || typeof window === 'undefined') return;
  captureInitialized = true;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyAll();
  });

  window.addEventListener('appinstalled', () => {
    globalIsInstalled = true;
    globalDeferredPrompt = null;
    notifyAll();
  });
}

// Capture immediately at module load so events firing on AuthGate are never missed
initPWAInstallCapture();

export function usePWAInstall() {
  const [, setTick] = useState(0);

  useEffect(() => {
    initPWAInstallCapture();
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);

    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onMqChange = (ev: MediaQueryListEvent) => {
      if (ev.matches) {
        globalIsInstalled = true;
        globalDeferredPrompt = null;
        notifyAll();
      }
    };
    mq?.addEventListener?.('change', onMqChange);

    return () => {
      listeners.delete(bump);
      mq?.removeEventListener?.('change', onMqChange);
    };
  }, []);

  const ua = typeof window !== 'undefined' ? window.navigator.userAgent : '';
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);

  const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!globalDeferredPrompt) return 'unavailable';
    const promptEvt = globalDeferredPrompt;
    globalDeferredPrompt = null;
    notifyAll();
    try {
      await promptEvt.prompt();
      const { outcome } = await promptEvt.userChoice;
      if (outcome === 'accepted') {
        globalIsInstalled = true;
        notifyAll();
      }
      return outcome;
    } catch {
      return 'unavailable';
    }
  };

  return {
    canNativePrompt: Boolean(globalDeferredPrompt),
    isInstalled: globalIsInstalled,
    isIOS,
    isAndroid,
    promptInstall,
  };
}
