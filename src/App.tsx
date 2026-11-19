import React, { Suspense } from 'react';
import { AuthGate } from './components/AuthGate';

const AppWorkspace = React.lazy(() =>
  import('./AppWorkspace').then((m) => ({ default: m.AppWorkspace }))
);

export default function App() {
  return (
    <AuthGate>
      {(session, onSignOut) => (
        <Suspense
          fallback={
            <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-[#1e3a5f] dark:border-sky-400 border-t-transparent rounded-full animate-spin" />
                <div className="text-sm font-semibold">Chargement de l’espace de travail…</div>
              </div>
            </div>
          }
        >
          <AppWorkspace session={session} onSignOut={onSignOut} />
        </Suspense>
      )}
    </AuthGate>
  );
}
