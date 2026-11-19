import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { canNativePrompt, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canNativePrompt) {
      const outcome = await promptInstall();
      if (outcome !== 'unavailable') return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-sky-800 dark:text-sky-300 cursor-pointer whitespace-nowrap shrink-0"
        title="Installer ProjectController comme application (bureau / mobile)"
      >
        <Download className="w-3.5 h-3.5" />
        Installer
      </button>

      {showGuide && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 bg-[#1e3a5f] text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Smartphone className="w-4 h-4 text-sky-300" />
                Installer l’application
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 rounded hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              {isIOS ? (
                <>
                  <p>
                    Sur iPhone / iPad (Safari), l’installation passe par le menu de partage :
                  </p>
                  <ol className="list-decimal pl-4 space-y-1.5">
                    <li>
                      Appuyez sur l’icône <Share className="inline w-3.5 h-3.5 mx-0.5 text-sky-600" />{' '}
                      <strong>Partager</strong> en bas ou en haut de Safari.
                    </li>
                    <li>
                      Faites défiler et choisissez <strong>« Sur l’écran d’accueil »</strong>.
                    </li>
                    <li>
                      Confirmez en appuyant sur <strong>Ajouter</strong>.
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <p>
                    Pour installer <strong>ProjectController</strong> sur votre ordinateur ou téléphone Android :
                  </p>
                  <ol className="list-decimal pl-4 space-y-1.5">
                    <li>
                      Ouvrez l’application directement dans son propre onglet Chrome ou Edge (hors fenêtre intégrée).
                    </li>
                    <li>
                      Cliquez sur l’icône <strong>Installer</strong> dans la barre d’adresse à droite, ou dans le menu <strong>⋮ → Caster, enregistrer et partager → Installer la page en tant qu’application</strong>.
                    </li>
                    <li>
                      Une fois installée, l’application dispose de son icône dédiée et reste utilisable hors-ligne.
                    </li>
                  </ol>
                </>
              )}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#1e3a5f] text-white font-semibold cursor-pointer"
                >
                  Compris
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
