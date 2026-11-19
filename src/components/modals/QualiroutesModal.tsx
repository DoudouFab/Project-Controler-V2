import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  clearQualiroutesIndex,
  getQualiroutesMeta,
  getQualiroutesPage,
  indexQualiroutesPdfBuffer,
  lookupQualiroutesReference,
  QualiroutesMeta,
  QualiroutesSearchHit,
} from '../../utils/qualiroutesDb';

interface QualiroutesModalProps {
  initialRef?: string;
  initialDesc?: string;
  onClose: () => void;
}

const BUNDLED_QUALIROUTES_URL = './assets/aistudio/Qualiroutes_2026_01_275f1d52.pdf';

export const QualiroutesModal: React.FC<QualiroutesModalProps> = ({
  initialRef = '',
  initialDesc = '',
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [meta, setMeta] = useState<QualiroutesMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [query, setQuery] = useState(initialRef);
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<QualiroutesSearchHit[]>([]);
  const [activePageNum, setActivePageNum] = useState<number | null>(null);
  const [activePageText, setActivePageText] = useState<string>('');

  const runSearch = useCallback(async (q: string) => {
    const clean = q.trim();
    if (!clean) {
      setHits([]);
      return;
    }
    setSearching(true);
    setErrorMsg(null);
    try {
      const res = await lookupQualiroutesReference(clean);
      setHits(res);
      if (res.length > 0) {
        const firstPage = await getQualiroutesPage(res[0].pageNum);
        setActivePageNum(res[0].pageNum);
        setActivePageText(firstPage?.text || res[0].excerpt);
      } else {
        setActivePageNum(null);
        setActivePageText('');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erreur lors de la recherche dans Qualiroutes.'
      );
    } finally {
      setSearching(false);
    }
  }, []);

  const autoInitDoneRef = useRef(false);
  const queryRef = useRef(query);
  queryRef.current = query;

  const handleImportBuffer = useCallback(async (buf: ArrayBuffer, fileName: string) => {
    setIndexing(true);
    setErrorMsg(null);
    setProgressPct(1);
    setProgressMsg('Démarrage de l’indexation globale pour toute l’application…');
    try {
      const newMeta = await indexQualiroutesPdfBuffer(buf, fileName, (pct, msg) => {
        setProgressPct(pct);
        setProgressMsg(msg);
      });
      setMeta(newMeta);
      if (queryRef.current.trim()) {
        await runSearch(queryRef.current);
      }
    } catch (err) {
      setErrorMsg(
        `Impossible d’indexer ce PDF : ${err instanceof Error ? err.message : 'erreur inconnue'}`
      );
    } finally {
      setIndexing(false);
    }
  }, [runSearch]);

  const handleLocalFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    await handleImportBuffer(buf, file.name);
  };

  const handleIndexBundledPdf = useCallback(async () => {
    setIndexing(true);
    setErrorMsg(null);
    setProgressPct(1);
    setProgressMsg('Téléchargement unique du CCT Qualiroutes intégré…');
    try {
      const resp = await fetch(BUNDLED_QUALIROUTES_URL);
      if (!resp.ok) {
        throw new Error(`Document intégré indisponible (HTTP ${resp.status}). Importez le PDF localement.`);
      }
      const buf = await resp.arrayBuffer();
      await handleImportBuffer(buf, 'Qualiroutes_2026_01.pdf');
    } catch (err) {
      setIndexing(false);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Impossible de charger le PDF intégré hors-ligne. Importez votre fichier PDF local.'
      );
    }
  }, [handleImportBuffer]);

  useEffect(() => {
    if (autoInitDoneRef.current) return;
    autoInitDoneRef.current = true;
    let active = true;
    (async () => {
      const m = await getQualiroutesMeta();
      if (!active) return;
      setMeta(m);
      setLoadingMeta(false);
      if (m) {
        if (initialRef.trim()) {
          await runSearch(initialRef);
        }
      } else {
        await handleIndexBundledPdf();
      }
    })();
    return () => {
      active = false;
    };
  }, [initialRef, runSearch, handleIndexBundledPdf]);

  const openPage = async (pageNum: number) => {
    if (!meta || pageNum < 1 || pageNum > meta.numPages) return;
    const p = await getQualiroutesPage(pageNum);
    setActivePageNum(pageNum);
    setActivePageText(p?.text || '(Texte indisponible pour cette page)');
  };

  const handleClearIndex = async () => {
    await clearQualiroutesIndex();
    setMeta(null);
    setHits([]);
    setActivePageNum(null);
    setActivePageText('');
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#1e3a5f] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <BookOpen className="w-5 h-5 shrink-0 text-sky-300" />
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">
                Référentiel CCT Qualiroutes {initialRef ? `— Réf. ${initialRef}` : ''}
              </div>
              {initialDesc && (
                <div className="text-[11px] text-sky-100/85 truncate">{initialDesc}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barre indexation PDF + recherche */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            {loadingMeta ? (
              <span className="text-slate-500">Vérification de l’index global de l’application…</span>
            ) : meta ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                  Index global prêt : {meta.fileName} ({meta.numPages} pages · {meta.sectionCount}{' '}
                  articles)
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Enregistré une seule fois pour toute l’application — valable sur tous vos dossiers, même hors-ligne.
                </span>
              </div>
            ) : (
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                Aucun PDF Qualiroutes indexé sur cet appareil (valable une fois pour tous les dossiers).
              </span>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={indexing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                <FileUp className="w-3.5 h-3.5" /> {meta ? 'Remplacer le PDF' : 'Déposer PDF local'}
              </button>
              {!meta && (
                <button
                  type="button"
                  disabled={indexing}
                  onClick={() => void handleIndexBundledPdf()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1e3a5f] hover:bg-[#162d4b] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  Indexer Qualiroutes 2026
                </button>
              )}
              {meta && !indexing && (
                <button
                  type="button"
                  onClick={() => void handleClearIndex()}
                  title="Vider l'index global Qualiroutes"
                  className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleLocalFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {indexing && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                <span>{progressMsg}</span>
                <span className="font-mono font-bold">{progressPct}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-sky-600 transition-all duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {meta && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch(query);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un article (ex. F.2.3.1, H.1.2) ou un mot-clé…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={searching || indexing}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {searching ? 'Recherche…' : 'Consulter'}
              </button>
            </form>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Corps : résultats + liseuse texte d'extrait */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-12 gap-4 min-h-[280px]">
          {!meta ? (
            <div className="md:col-span-12 flex flex-col items-center justify-center text-center py-10 px-4 text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <p className="max-w-lg leading-relaxed">
                Cliquez sur <strong>« Indexer Qualiroutes 2026 »</strong> ou importez votre propre fichier{' '}
                <code>Qualiroutes_2026_01.pdf</code> local. L’index complet des chapitres et articles est stocké une seule fois dans votre navigateur (IndexedDB) pour une consultation instantanée, même hors-ligne.
              </p>
            </div>
          ) : (
            <>
              <div className="md:col-span-4 space-y-2 border-r border-slate-200 dark:border-slate-800 pr-0 md:pr-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Résultats ({hits.length})
                </div>
                {hits.length === 0 ? (
                  <div className="text-xs text-slate-500 italic py-4">
                    {query.trim()
                      ? 'Aucun article correspondant trouvé.'
                      : 'Saisissez une référence Qualiroutes ou un mot-clé.'}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                    {hits.map((h, i) => (
                      <button
                        key={`${h.pageNum}-${i}`}
                        type="button"
                        onClick={() => void openPage(h.pageNum)}
                        className={`w-full text-left p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                          activePageNum === h.pageNum
                            ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-sky-700 dark:text-sky-400">
                            {h.code}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            p. {h.pageNum}
                          </span>
                        </div>
                        <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5 line-clamp-2">
                          {h.title}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-8 flex flex-col">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800 mb-2">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {activePageNum ? `Extrait — Page ${activePageNum} / ${meta.numPages}` : 'Extrait'}
                  </div>
                  {activePageNum && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={activePageNum <= 1}
                        onClick={() => void openPage(activePageNum - 1)}
                        className="p-1 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                        title="Page précédente"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={activePageNum >= meta.numPages}
                        onClick={() => void openPage(activePageNum + 1)}
                        className="p-1 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                        title="Page suivante"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <pre className="flex-1 whitespace-pre-wrap font-sans text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 max-h-[420px] overflow-y-auto">
                  {activePageText || 'Sélectionnez un résultat à gauche pour lire l’extrait du CCT Qualiroutes.'}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
