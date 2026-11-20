import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'auth';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { canNativePrompt, isInstalled, isIOS, isAndroid, promptInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canNativePrompt) {
      const outcome = await promptInstall();
      if (outcome !== 'unavailable') return;
    }
    setShowGuide(true);
  };

  const buttonClass =
    variant === 'auth'
      ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/15 hover:bg-white/25 border border-white/25 text-white cursor-pointer whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-sky-800 dark:text-sky-300 cursor-pointer whitespace-nowrap shrink-0';

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={buttonClass}
        title="Installer ProjectController V2.0 sur Android, iOS ou ordinateur"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Installer</span>
      </button>

      {showGuide && (
        <div
          className="no-print fixed inset-0 z-[75] bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 bg-[#1e3a5f] text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Smartphone className="w-4 h-4 text-sky-300" />
                Installer ProjectController V2.0
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 rounded hover:bg-white/10 cursor-pointer"
                aria-label="Fermer"
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
                      Vérifiez le nom <strong>ProjectController V2.0</strong> puis appuyez sur{' '}
                      <strong>Ajouter</strong>.
                    </li>
                  </ol>
                </>
              ) : isAndroid ? (
                <>
                  <p>
                    Pour installer <strong>ProjectController V2.0</strong> directement sur Android :
                  </p>
                  <ol className="list-decimal pl-4 space-y-1.5">
                    <li>
                      Ouvrez l’application dans <strong>Google Chrome</strong> (hors navigateur intégré d’une autre app).
                    </li>
                    <li>
                      Appuyez sur le menu <strong>⋮</strong> en haut à droite de Chrome, puis sur{' '}
                      <strong>« Ajouter à l’écran d’accueil »</strong> →{' '}
                      <strong>« Installer »</strong>.
                    </li>
                    <li>
                      L’icône <strong>ProjectController V2.0</strong> apparaît directement sur votre écran d’accueil Android et fonctionne en plein écran.
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <p>
                    Pour installer <strong>ProjectController V2.0</strong> sur votre ordinateur ou téléphone Android :
                  </p>
                  <ol className="list-decimal pl-4 space-y-1.5">
                    <li>
                      Ouvrez l’application directement dans Chrome ou Edge (hors fenêtre intégrée).
                    </li>
                    <li>
                      Cliquez sur l’icône <strong>Installer</strong> dans la barre d’adresse à droite, ou dans le menu{' '}
                      <strong>⋮ → Ajouter à l’écran d’accueil / Installer l’application</strong>.
                    </li>
                    <li>
                      L’application dispose ensuite de son raccourci{' '}
                      <strong>ProjectController V2.0</strong> et reste utilisable hors-ligne.
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
