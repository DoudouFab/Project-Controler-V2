import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  FilePlus2,
  FolderKanban,
  HardDriveDownload,
  History,
  Link2,
  Link2Off,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { ProjectData } from '../../types/project';
import { fmt } from '../../utils/calculations';
import {
  ChantierRecord,
  listSnapshots,
  SnapshotRecord,
  supportsLocalFileHandle,
} from '../../utils/projectsDb';

interface DossiersModalProps {
  dossiers: ChantierRecord[];
  activeDossierId: string | null;
  autoSaveEnabled: boolean;
  lastAutoSaveAt: string | null;
  isDirtySinceJson: boolean;
  linkedFileName: string | null;
  onClose: () => void;
  onSwitchDossier: (id: string) => void;
  onCreateNewDossier: () => void;
  onDuplicateDossier: (id: string) => void;
  onDeleteDossier: (id: string) => void;
  onToggleAutoSave: (enabled: boolean) => void;
  onSaveSnapshotNow: () => void;
  onRestoreSnapshot: (snap: SnapshotRecord) => void;
  onExportJson: () => void;
  onLinkLocalFile: () => void;
  onUnlinkLocalFile: () => void;
}

function formatDateTimeFr(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const DossiersModal: React.FC<DossiersModalProps> = ({
  dossiers,
  activeDossierId,
  autoSaveEnabled,
  lastAutoSaveAt,
  isDirtySinceJson,
  linkedFileName,
  onClose,
  onSwitchDossier,
  onCreateNewDossier,
  onDuplicateDossier,
  onDeleteDossier,
  onToggleAutoSave,
  onSaveSnapshotNow,
  onRestoreSnapshot,
  onExportJson,
  onLinkLocalFile,
  onUnlinkLocalFile,
}) => {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);

  useEffect(() => {
    if (!activeDossierId) return;
    let alive = true;
    listSnapshots(activeDossierId).then((list) => {
      if (alive) setSnapshots(list);
    });
    return () => {
      alive = false;
    };
  }, [activeDossierId, lastAutoSaveAt]);

  const canUseFsApi = supportsLocalFileHandle();

  return (
    <div
      className="no-print fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="px-5 py-3.5 bg-[#1e3a5f] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <FolderKanban className="w-5 h-5 text-sky-300" />
            <div>
              <div className="text-sm font-bold">Mes chantiers locaux &amp; Sauvegarde automatique</div>
              <div className="text-[11px] text-sky-100/80">
                Stockage local multi-dossiers (IndexedDB — 0 lecture Firestore) · Instantanés auto toutes les 7 min
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
          {/* Bandeau sauvegarde auto 7 min */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    Enregistrement automatique toutes les 7 minutes
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Dernier instantané auto :{' '}
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {formatDateTimeFr(lastAutoSaveAt)}
                    </span>
                    {isDirtySinceJson && (
                      <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                        · Modifié depuis le dernier export .json
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSaveEnabled}
                    onChange={(e) => onToggleAutoSave(e.target.checked)}
                  />
                  <span className="font-medium">Actif (7 min)</span>
                </label>
                <button
                  type="button"
                  onClick={onSaveSnapshotNow}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 text-sky-800 dark:text-sky-300 font-semibold cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" /> Instantané maintenant
                </button>
                <button
                  type="button"
                  onClick={onExportJson}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold cursor-pointer"
                >
                  <HardDriveDownload className="w-3.5 h-3.5" /> Exporter (.json)
                </button>
              </div>
            </div>

            {/* Option fichier disque lié (Chrome / Edge) */}
            {canUseFsApi && (
              <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="text-slate-600 dark:text-slate-400">
                  {linkedFileName ? (
                    <span>
                      Fichier disque lié :{' '}
                      <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                        {linkedFileName}
                      </strong>{' '}
                      (mis à jour automatiquement toutes les 7 min)
                    </span>
                  ) : (
                    <span>
                      Optionnel : liez un fichier <code className="font-mono">.json</code> sur votre PC/OneDrive pour qu’il soit mis à jour automatiquement toutes les 7 min.
                    </span>
                  )}
                </div>
                {linkedFileName ? (
                  <button
                    type="button"
                    onClick={onUnlinkLocalFile}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    <Link2Off className="w-3 h-3" /> Délier le fichier
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onLinkLocalFile}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 text-slate-800 dark:text-slate-200 font-medium cursor-pointer"
                  >
                    <Link2 className="w-3 h-3" /> Lier un fichier .json
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Barre d'actions dossiers */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold uppercase tracking-wider text-[11px] text-slate-500 dark:text-slate-400">
              Dossiers enregistrés sur cet appareil ({dossiers.length})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSnapshots((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                {showSnapshots ? 'Masquer historique auto' : `Historique auto (${snapshots.length})`}
              </button>
              <button
                type="button"
                onClick={onCreateNewDossier}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-sky-800 text-white font-semibold cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" /> Nouveau dossier vierge
              </button>
            </div>
          </div>

          {/* Liste des chantiers */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-800">
            {dossiers.map((d) => {
              const isActive = d.id === activeDossierId;
              return (
                <div
                  key={d.id}
                  className={`p-3 flex flex-wrap items-center justify-between gap-3 ${
                    isActive
                      ? 'bg-sky-50/70 dark:bg-sky-950/30'
                      : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-700 text-white text-[10px] font-bold">
                          <Check className="w-3 h-3" /> Actif
                        </span>
                      )}
                      <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                        {d.nomProjet}
                      </span>
                      {d.marche && (
                        <span className="font-mono text-[11px] text-sky-700 dark:text-sky-400">
                          {d.marche}
                        </span>
                      )}
                    </div>
                    {d.intitule && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
                        {d.intitule}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      <span>Budget : {fmt(d.budget)} €</span>
                      <span>{d.nbTroncons} tronçon(s)</span>
                      <span>{d.nbEA} EA validé(s)</span>
                      <span>Modifié : {formatDateTimeFr(d.updatedAt)}</span>
                      {d.lastJsonExportAt && (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Export JSON : {formatDateTimeFr(d.lastJsonExportAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => onSwitchDossier(d.id)}
                        className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-semibold cursor-pointer"
                      >
                        Ouvrir
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDuplicateDossier(d.id)}
                      title="Dupliquer ce dossier"
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {dossiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeleteDossier(d.id)}
                        title="Supprimer ce dossier local"
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Instantanés automatiques du dossier actif */}
          {showSnapshots && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2 bg-slate-50/70 dark:bg-slate-950/50">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Instantanés du dossier actif (10 derniers conservés)
              </div>
              {snapshots.length === 0 ? (
                <div className="text-[11px] text-slate-500 italic py-2">
                  Aucun instantané enregistré pour le moment (création automatique toutes les 7 minutes ou via « Instantané maintenant »).
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {snapshots.map((s) => (
                    <div key={s.id} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {formatDateTimeFr(s.savedAt)}
                        </span>
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {s.reason === 'auto' ? 'Auto 7 min' : 'Manuel'}
                        </span>
                        <span className="ml-2 text-[11px] text-slate-500">
                          {s.data.tronconsEgout?.length || 0} tronçons · {s.data.historiqueEA?.length || 0} EA
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRestoreSnapshot(s)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-800 dark:text-amber-300 text-[11px] font-semibold cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" /> Restaurer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
