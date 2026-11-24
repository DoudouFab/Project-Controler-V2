import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  CalendarClock,
  ClipboardList,
  Database,
  FileCheck2,
  FilePlus2,
  FolderKanban,
  FolderOpen,
  Layers,
  LogOut,
  Moon,
  Printer,
  Redo2,
  Route,
  Save,
  Scale,
  Shield,
  Sun,
  Undo2,
  WifiOff,
} from 'lucide-react';
import type { AuthSession } from './components/AuthGate';
import { ConfirmDialog, ConfirmDialogState, ToastContainer, ToastMessage } from './components/AppDialogs';
import { PWAInstallButton } from './components/PWAInstallButton';
import { DossiersModal } from './components/modals/DossiersModal';
import { MultiPrintModal, PrintTabSelection } from './components/modals/MultiPrintModal';
import { Tab1Global } from './components/Tab1Global';
import { Tab2Encodage } from './components/Tab2Encodage';
import { Tab3Carnet } from './components/Tab3Carnet';
import { Tab4EaEnCours } from './components/Tab4EaEnCours';
import { Tab5EaValides } from './components/Tab5EaValides';
import { Tab6Cumul } from './components/Tab6Cumul';
import { Tab7Delais } from './components/Tab7Delais';
import { isAdminUser } from './firebase';

const Tab8Acces = React.lazy(() =>
  import('./components/Tab8Acces').then((m) => ({ default: m.Tab8Acces }))
);
import { ProjectData, TronconEgout } from './types/project';
import {
  calculerEtatDelai,
  fmt,
  genererStructureVierge,
  mnt,
  prochainNumeroEA,
  srcP,
} from './utils/calculations';
import { INASEP_LOGO_BASE64 } from './constants/inasep';
import { buildInasepDelaySheetHtml, printHtmlViaIframe } from './utils/inasepPrint';
import {
  ChantierRecord,
  deleteDossier,
  generateDossierId,
  getDossier,
  initDossiersWorkspace,
  listDossiers,
  LocalFileHandleLike,
  markDossierExported,
  pickJsonBackupHandle,
  savePrefs,
  saveSnapshot,
  SnapshotRecord,
  upsertDossier,
  writeProjectToFileHandle,
} from './utils/projectsDb';

const QualiroutesModal = React.lazy(() =>
  import('./components/modals/QualiroutesModal').then((m) => ({ default: m.QualiroutesModal }))
);

const STORAGE_DATA_KEY = 'projectcontroller_inasep_data';
const STORAGE_THEME_KEY = 'projectcontroller_theme';
const STORAGE_ACTIVE_DOSSIER_KEY = 'projectcontroller_active_dossier_id';
const STORAGE_IDB_DIRTY_KEY = 'projectcontroller_idb_pending';

function normalizeProjectData(raw: unknown): ProjectData {
  const base = genererStructureVierge();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<ProjectData>;

  const tronconsEgout: TronconEgout[] = Array.isArray(r.tronconsEgout)
    ? r.tronconsEgout.map((t, idx) => ({
        ref: t.ref || `T${idx + 1}`,
        ordreEncodage: typeof t.ordreEncodage === 'number' ? t.ordreEncodage : idx + 1,
        de: t.de || '',
        a: t.a || '',
        long: Number(t.long) || 0,
        p_amo: Number(t.p_amo) || 0,
        p_ava: Number(t.p_ava) || 0,
        sf: Number(t.sf) || 0,
        fond: Number(t.fond) || 0,
        rev: Number(t.rev) || 0,
        epExist: Number(t.epExist) || 0,
        natureTuyau: t.natureTuyau || 'BA',
        dn: Number(t.dn) || 300,
        diamExt: Number(t.diamExt) || Number(t.dn) || 300,
        milieu: t.milieu || 'TN',
        remblaiType: t.remblaiType || 'Terrain Naturel',
        chauxPourcent: Number(t.chauxPourcent) || 0,
        d9000Type: t.d9000Type || '',
        fait: t.fait !== false,
        lt_force: t.lt_force !== undefined && t.lt_force !== null ? Number(t.lt_force) : null,
        insp_porter: Boolean(t.insp_porter),
        insp_qte: t.insp_qte !== undefined && t.insp_qte !== null ? Number(t.insp_qte) : null,
        cet_porter: Boolean(t.cet_porter),
        cet_qte: t.cet_qte !== undefined && t.cet_qte !== null ? Number(t.cet_qte) : null,
        rocheux: t.rocheux || null,
        compact: t.compact || null,
        remplacement: t.remplacement || null,
        blindage: t.blindage || null,
        avecEnrobage: t.avecEnrobage !== false,
        cvAmo: t.cvAmo || { dint: 0, h: 0 },
        cvAva: t.cvAva || { dint: 0, h: 0 },
      }))
    : [];

  return {
    nomProjet: r.nomProjet || base.nomProjet,
    infosAdministratives: {
      ...base.infosAdministratives,
      ...(r.infosAdministratives || {}),
    },
    marche3P: Array.isArray(r.marche3P)
      ? r.marche3P.map((p) => ({
          id: String(p.id ?? ''),
          ...(p.ref ? { ref: String(p.ref) } : {}),
          ...(p.code ? { code: String(p.code) } : {}),
          ...(p.remarques ? { remarques: String(p.remarques) } : {}),
          desc: String(p.desc ?? ''),
          u: String(p.u ?? ''),
          qte: Number(p.qte) || 0,
          pu: Number(p.pu) || 0,
        }))
      : [],
    avenants: Array.isArray(r.avenants) ? r.avenants : [],
    tronconsEgout,
    compteurTroncons:
      typeof r.compteurTroncons === 'number' ? r.compteurTroncons : tronconsEgout.length,
    ordreTroncons:
      typeof r.ordreTroncons === 'number' ? r.ordreTroncons : tronconsEgout.length,
    carnetMesurage: {
      lignesManuelles: Array.isArray(r.carnetMesurage?.lignesManuelles)
        ? r.carnetMesurage.lignesManuelles
        : [],
      statutsLignes: r.carnetMesurage?.statutsLignes || {},
      overrides: r.carnetMesurage?.overrides || {},
      cvAutoGeneres: Array.isArray(r.carnetMesurage?.cvAutoGeneres)
        ? r.carnetMesurage.cvAutoGeneres
        : [],
    },
    historiqueEA: Array.isArray(r.historiqueEA) ? r.historiqueEA : [],
    delais: {
      ...base.delais,
      ...(r.delais || {}),
      joursMarques: r.delais?.joursMarques || {},
      delaisCompl: Array.isArray(r.delais?.delaisCompl) ? r.delais.delaisCompl : [],
      arrets: Array.isArray(r.delais?.arrets) ? r.delais.arrets : [],
      observationsOverrides: r.delais?.observationsOverrides || {},
    },
    configVoirie: r.configVoirie?.parTroncon ? r.configVoirie : { parTroncon: {} },
    configDemolition: r.configDemolition?.parTroncon ? r.configDemolition : { parTroncon: {} },
    ...(r.metreRecapMeta ? { metreRecapMeta: r.metreRecapMeta } : {}),
    ...(Array.isArray(r.mrPostes) ? { mrPostes: r.mrPostes } : {}),
    ...(r.justificationsCumul && typeof r.justificationsCumul === 'object'
      ? { justificationsCumul: r.justificationsCumul }
      : {}),
  };
}

function setPrintOrientationStyle(orient: 'portrait' | 'landscape') {
  let el = document.getElementById('print-orient-style') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'print-orient-style';
    document.head.appendChild(el);
  }
  el.textContent = `@page { size: A4 ${orient}; margin: 12mm 12mm 15mm 12mm; }`;
}

const BASE_TABS = [
  { id: 1, label: '1. Global & Bordereau', icon: Database },
  { id: 2, label: '2. Encodage Tronçons', icon: Route },
  { id: 3, label: '3. Carnet de Mesurage', icon: ClipboardList },
  { id: 4, label: '4. EA en Cours', icon: Layers },
  { id: 5, label: '5. EA Validés', icon: FileCheck2 },
  { id: 6, label: '6. Cumul & Concordance', icon: Scale },
  { id: 7, label: '7. Délais', icon: CalendarClock },
] as const;

interface AppWorkspaceProps {
  session: AuthSession;
  onSignOut: () => Promise<void>;
}

export const AppWorkspace: React.FC<AppWorkspaceProps> = ({ session, onSignOut }) => {
  const [appData, setAppData] = useState<ProjectData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DATA_KEY);
      if (saved) return normalizeProjectData(JSON.parse(saved));
    } catch {
      // Fallback to clean project structure
    }
    return genererStructureVierge();
  });

  const [activeTab, setActiveTab] = useState<number>(1);
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_THEME_KEY) === 'dark';
    } catch {
      return false;
    }
  });
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [hideBordereauPrint, setHideBordereauPrint] = useState<boolean>(false);
  const [sansCalendrier, setSansCalendrier] = useState<boolean>(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastSeq = useRef(1);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [showMultiPrintModal, setShowMultiPrintModal] = useState<boolean>(false);
  const [multiPrintBatch, setMultiPrintBatch] = useState<PrintTabSelection[] | null>(null);
  const [qualiroutesCtx, setQualiroutesCtx] = useState<{ ref: string; desc: string } | null>(null);
  const [showAccesModal, setShowAccesModal] = useState<boolean>(false);
  const [showDossiersModal, setShowDossiersModal] = useState<boolean>(false);

  const [dossiers, setDossiers] = useState<ChantierRecord[]>([]);
  const [activeDossierId, setActiveDossierId] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(true);
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<string | null>(null);
  const [isDirtySinceJson, setIsDirtySinceJson] = useState<boolean>(false);
  const [linkedFileName, setLinkedFileName] = useState<string | null>(null);

  const canManageAccess = session.isAdmin && isAdminUser(session.user);

  const jsonInputRef = useRef<HTMLInputElement>(null);
  const undoStackRef = useRef<ProjectData[]>([]);
  const redoStackRef = useRef<ProjectData[]>([]);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const appDataRef = useRef<ProjectData>(appData);
  const activeDossierIdRef = useRef<string | null>(activeDossierId);
  const dbReadyRef = useRef<boolean>(false);
  const lastLoadedDataRef = useRef<ProjectData | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const linkedFileHandleRef = useRef<LocalFileHandleLike | null>(null);

  appDataRef.current = appData;
  activeDossierIdRef.current = activeDossierId;

  const [showScrollTop, setShowScrollTop] = useState<boolean>(false);
  const isFreeScrollHeaderTab =
    activeTab === 2 || activeTab === 4 || activeTab === 5 || activeTab === 6;

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 220);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [activeTab]);

  useEffect(() => {
    const onUp = () => setIsOnline(true);
    const onDown = () => setIsOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, []);

  const syncHistoryCounts = useCallback(() => {
    setHistoryCounts({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }, []);

  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryCounts();
  }, [syncHistoryCounts]);

  const notify = useCallback((type: ToastMessage['type'], text: string) => {
    const id = toastSeq.current++;
    setToasts((prev) => [...prev.slice(-4), { id, type, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const openConfirm = useCallback((opts: ConfirmDialogState) => {
    setConfirmDialog(opts);
  }, []);

  const openQualiroutes = useCallback((ref = '', desc = '') => {
    setQualiroutesCtx({ ref, desc });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(appData));
      if (dbReadyRef.current && lastLoadedDataRef.current !== appData) {
        localStorage.setItem(STORAGE_IDB_DIRTY_KEY, '1');
      }
    } catch {
      // Ignore quota errors silently
    }
  }, [appData]);

  // Initialisation du workspace multi-dossiers IndexedDB (avec récupération fallback)
  useEffect(() => {
    let alive = true;
    const initialLocal = appDataRef.current;
    let savedActiveHint: string | null = null;
    let hadPendingLocal = false;
    try {
      savedActiveHint = localStorage.getItem(STORAGE_ACTIVE_DOSSIER_KEY);
      hadPendingLocal = localStorage.getItem(STORAGE_IDB_DIRTY_KEY) === '1';
    } catch {
      // Ignore
    }

    initDossiersWorkspace(initialLocal, normalizeProjectData)
      .then(async (res) => {
        if (!alive) return;
        let finalData = res.activeData;
        let finalDossiers = res.dossiers;

        // Si une modification récente localStorage n'avait pas fini d'être écrite en IDB avant rechargement
        if (hadPendingLocal && savedActiveHint === res.activeId) {
          finalData = initialLocal;
          await upsertDossier(res.activeId, initialLocal);
          finalDossiers = await listDossiers();
        }
        try {
          localStorage.setItem(STORAGE_ACTIVE_DOSSIER_KEY, res.activeId);
          localStorage.removeItem(STORAGE_IDB_DIRTY_KEY);
        } catch {
          // Ignore
        }

        lastLoadedDataRef.current = finalData;
        dbReadyRef.current = true;
        setActiveDossierId(res.activeId);
        setDossiers(finalDossiers);
        setAutoSaveEnabled(res.prefs.autoSaveEnabled);
        setLastAutoSaveAt(res.prefs.lastAutoSaveAt || null);
        setAppData(finalData);

        const rec = finalDossiers.find((d) => d.id === res.activeId);
        const dirty = rec
          ? !rec.lastJsonExportAt || rec.updatedAt > rec.lastJsonExportAt
          : false;
        setIsDirtySinceJson(dirty);
      })
      .catch(async () => {
        if (!alive) return;
        const fallbackId = savedActiveHint || generateDossierId();
        const rec = await upsertDossier(fallbackId, initialLocal);
        try {
          localStorage.setItem(STORAGE_ACTIVE_DOSSIER_KEY, fallbackId);
          localStorage.removeItem(STORAGE_IDB_DIRTY_KEY);
        } catch {
          // Ignore
        }
        lastLoadedDataRef.current = initialLocal;
        dbReadyRef.current = true;
        setActiveDossierId(fallbackId);
        setDossiers([rec]);
      });

    return () => {
      alive = false;
    };
  }, []);

  const flushActiveDossierPersist = useCallback(async () => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const id = activeDossierIdRef.current;
    if (!dbReadyRef.current || !id) return;
    await upsertDossier(id, appDataRef.current);
    try {
      localStorage.removeItem(STORAGE_IDB_DIRTY_KEY);
    } catch {
      // Ignore
    }
    const list = await listDossiers();
    setDossiers(list);
  }, []);

  // Persistance debounced dans le dossier IndexedDB actif
  useEffect(() => {
    if (!dbReadyRef.current || !activeDossierId) return;
    if (lastLoadedDataRef.current === appData) {
      lastLoadedDataRef.current = null;
      return;
    }
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void upsertDossier(activeDossierId, appData).then(async () => {
        try {
          localStorage.removeItem(STORAGE_IDB_DIRTY_KEY);
        } catch {
          // Ignore
        }
        const list = await listDossiers();
        setDossiers(list);
      });
    }, 350);
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [appData, activeDossierId]);

  // Flush immédiat si l'onglet est mis en arrière-plan ou fermé sur Android / Desktop
  useEffect(() => {
    const flushNow = () => {
      if (persistTimerRef.current !== null && activeDossierIdRef.current && dbReadyRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        void upsertDossier(activeDossierIdRef.current, appDataRef.current).then(() => {
          try {
            localStorage.removeItem(STORAGE_IDB_DIRTY_KEY);
          } catch {
            // Ignore
          }
        });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Synchronisation automatique vers l'application parente (B.O.C) via postMessage
  const parentSyncInitRef = useRef(false);
  const postDossierSyncToParent = useCallback((dossierActuel: ProjectData) => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'PC_SYNC_DOSSIER',
            payload: dossierActuel,
          },
          '*'
        );
      }
    } catch {
      // Ignorer si la fenêtre parente refuse postMessage
    }
  }, []);

  useEffect(() => {
    if (!window.parent || window.parent === window) return;
    if (!parentSyncInitRef.current) {
      parentSyncInitRef.current = true;
      postDossierSyncToParent(appData);
      return;
    }
    const timer = window.setTimeout(() => {
      postDossierSyncToParent(appData);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [appData, postDossierSyncToParent]);

  useEffect(() => {
    if (!window.parent || window.parent === window) return;
    const onParentMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: unknown } | null;
      if (msg && typeof msg === 'object' && msg.type === 'PC_REQUEST_SYNC') {
        postDossierSyncToParent(appDataRef.current);
      }
    };
    window.addEventListener('message', onParentMessage);
    return () => window.removeEventListener('message', onParentMessage);
  }, [postDossierSyncToParent]);

  // Sauvegarde automatique périodique toutes les 7 minutes
  useEffect(() => {
    if (!autoSaveEnabled || !activeDossierId) return;
    const INTERVAL_MS = 7 * 60 * 1000;
    const timer = window.setInterval(async () => {
      const current = appDataRef.current;
      await upsertDossier(activeDossierId, current);
      const snap = await saveSnapshot(activeDossierId, current, 'auto');
      setLastAutoSaveAt(snap.savedAt);
      await savePrefs({
        id: 'prefs',
        activeDossierId,
        autoSaveEnabled: true,
        autoSaveIntervalMin: 7,
        lastAutoSaveAt: snap.savedAt,
      });

      if (linkedFileHandleRef.current) {
        try {
          const ok = await writeProjectToFileHandle(linkedFileHandleRef.current, current);
          if (ok) {
            await markDossierExported(activeDossierId);
            setIsDirtySinceJson(false);
          }
        } catch {
          // L'utilisateur a peut-être déplacé ou révoqué le fichier lié
        }
      }
      const list = await listDossiers();
      setDossiers(list);
    }, INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [autoSaveEnabled, activeDossierId]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(STORAGE_THEME_KEY, isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [isDark]);

  useEffect(() => {
    document.body.classList.toggle('hide-bordereau', hideBordereauPrint);
  }, [hideBordereauPrint]);

  useEffect(() => {
    document.body.classList.toggle('print-sans-cal', sansCalendrier);
  }, [sansCalendrier]);

  const handleUpdateData = useCallback(
    (updater: (prev: ProjectData) => ProjectData) => {
      setAppData((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        undoStackRef.current = [...undoStackRef.current.slice(-29), prev];
        redoStackRef.current = [];
        window.setTimeout(() => {
          syncHistoryCounts();
          setIsDirtySinceJson(true);
        }, 0);
        return next;
      });
    },
    [syncHistoryCounts]
  );

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    setAppData((curr) => {
      const stack = undoStackRef.current;
      if (stack.length === 0) return curr;
      const previous = stack[stack.length - 1];
      undoStackRef.current = stack.slice(0, -1);
      redoStackRef.current = [...redoStackRef.current.slice(-29), curr];
      window.setTimeout(syncHistoryCounts, 0);
      return previous;
    });
    notify('info', 'Dernière action annulée.');
  }, [notify, syncHistoryCounts]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    setAppData((curr) => {
      const stack = redoStackRef.current;
      if (stack.length === 0) return curr;
      const restored = stack[stack.length - 1];
      redoStackRef.current = stack.slice(0, -1);
      undoStackRef.current = [...undoStackRef.current.slice(-29), curr];
      window.setTimeout(syncHistoryCounts, 0);
      return restored;
    });
    notify('info', 'Action rétablie.');
  }, [notify, syncHistoryCounts]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (undoStackRef.current.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        if (redoStackRef.current.length > 0) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  const handleSaveJson = async () => {
    const json = JSON.stringify(appData, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (appData.nomProjet || 'Chantier').replace(/[^\w\-]+/g, '_');
    a.href = url;
    a.download = `${safeName}_sauvegarde.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (activeDossierId) {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      await upsertDossier(activeDossierId, appData);
      await markDossierExported(activeDossierId);
      setDossiers(await listDossiers());
    }
    postDossierSyncToParent(appData);
    setIsDirtySinceJson(false);
    notify('success', `Sauvegarde exportée : ${safeName}_sauvegarde.json`);
  };

  const activateDossierState = useCallback(
    async (
      id: string,
      data: ProjectData,
      opts: { dirtySinceJson: boolean; closeModal?: boolean; tab?: number }
    ) => {
      lastLoadedDataRef.current = data;
      dbReadyRef.current = true;
      setActiveDossierId(id);
      setAppData(data);
      clearHistory();
      linkedFileHandleRef.current = null;
      setLinkedFileName(null);
      setIsDirtySinceJson(opts.dirtySinceJson);
      try {
        localStorage.setItem(STORAGE_ACTIVE_DOSSIER_KEY, id);
        localStorage.removeItem(STORAGE_IDB_DIRTY_KEY);
      } catch {
        // Ignore
      }
      await savePrefs({
        id: 'prefs',
        activeDossierId: id,
        autoSaveEnabled,
        autoSaveIntervalMin: 7,
        lastAutoSaveAt: lastAutoSaveAt || undefined,
      });
      setDossiers(await listDossiers());
      if (opts.closeModal) setShowDossiersModal(false);
      if (opts.tab) setActiveTab(opts.tab);
    },
    [autoSaveEnabled, clearHistory, lastAutoSaveAt]
  );

  const openParsedJsonProject = async (norm: ProjectData, forceNewDossier: boolean) => {
    const cur = appDataRef.current;
    const curHasContent =
      cur.marche3P.length > 0 ||
      cur.tronconsEgout.length > 0 ||
      cur.historiqueEA.length > 0 ||
      Boolean(cur.infosAdministratives.marche);

    const isDifferentChantier =
      norm.nomProjet !== cur.nomProjet ||
      (norm.infosAdministratives.marche || '') !== (cur.infosAdministratives.marche || '');

    const now = new Date().toISOString();

    if (forceNewDossier || (curHasContent && isDifferentChantier)) {
      await flushActiveDossierPersist();
      const newId = generateDossierId();
      await upsertDossier(newId, norm, { lastJsonExportAt: now });
      await activateDossierState(newId, norm, {
        dirtySinceJson: false,
        closeModal: true,
        tab: 1,
      });
      notify(
        'success',
        `Nouveau chantier ajouté à « Mes chantiers » : ${norm.nomProjet} (${norm.marche3P.length} postes, ${norm.tronconsEgout.length} tronçons).`
      );
      return;
    }

    const targetId = activeDossierIdRef.current || generateDossierId();
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    await upsertDossier(targetId, norm, { lastJsonExportAt: now });
    await activateDossierState(targetId, norm, {
      dirtySinceJson: false,
      closeModal: forceNewDossier,
    });
    notify(
      'success',
      `Projet chargé : ${norm.nomProjet} (${norm.marche3P.length} postes, ${norm.tronconsEgout.length} tronçons, ${norm.historiqueEA.length} EA).`
    );
  };

  const handleLoadJsonFile = async (file: File, forceNewDossier = false) => {
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt);
      if (!parsed || !Array.isArray(parsed.marche3P)) {
        notify('error', 'Fichier JSON invalide : la structure marche3P est manquante.');
        return;
      }
      const norm = normalizeProjectData(parsed);
      await openParsedJsonProject(norm, forceNewDossier);
    } catch (err) {
      notify(
        'error',
        `Erreur lors de la lecture du fichier JSON : ${
          err instanceof Error ? err.message : 'format invalide'
        }`
      );
    }
  };

  const handleResetVierge = () => {
    openConfirm({
      title: 'Réinitialiser ce dossier sur un chantier vierge',
      message:
        'Le dossier actif sera remis à zéro (bordereau, tronçons, carnet, EA et délais). Pour conserver ce chantier et en ouvrir un autre à part, utilisez plutôt « Mes chantiers » → « Nouveau dossier vierge ».',
      confirmLabel: 'Réinitialiser',
      danger: true,
      onConfirm: () => {
        setAppData(genererStructureVierge());
        clearHistory();
        setIsDirtySinceJson(false);
        setActiveTab(1);
        notify('info', 'Dossier réinitialisé sur une structure vierge.');
      },
    });
  };

  const handleSwitchDossier = async (targetId: string) => {
    if (targetId === activeDossierIdRef.current) {
      setShowDossiersModal(false);
      return;
    }
    await flushActiveDossierPersist();
    const target = await getDossier(targetId);
    if (!target) {
      notify('error', 'Impossible de retrouver ce dossier local.');
      return;
    }
    const norm = normalizeProjectData(target.data);
    await activateDossierState(target.id, norm, {
      dirtySinceJson: !target.lastJsonExportAt || target.updatedAt > target.lastJsonExportAt,
      closeModal: true,
      tab: 1,
    });
    notify('info', `Dossier ouvert : ${norm.nomProjet}`);
  };

  const handleCreateNewDossier = async () => {
    await flushActiveDossierPersist();
    const newId = generateDossierId();
    const blank = genererStructureVierge();
    await upsertDossier(newId, blank);
    await activateDossierState(newId, blank, {
      dirtySinceJson: false,
      closeModal: true,
      tab: 1,
    });
    notify('success', 'Nouveau dossier local vierge créé.');
  };

  const handleDuplicateDossier = async (sourceId: string) => {
    if (sourceId === activeDossierIdRef.current) {
      await flushActiveDossierPersist();
    }
    const src = await getDossier(sourceId);
    if (!src) return;
    const cloned = normalizeProjectData(JSON.parse(JSON.stringify(src.data)));
    cloned.nomProjet = `${cloned.nomProjet || 'Chantier'}_copie`;
    const newId = generateDossierId();
    await upsertDossier(newId, cloned);
    await activateDossierState(newId, cloned, {
      dirtySinceJson: true,
    });
    notify('success', `Dossier dupliqué : ${cloned.nomProjet}`);
  };

  const handleDeleteDossier = (targetId: string) => {
    if (dossiers.length <= 1) return;
    const target = dossiers.find((d) => d.id === targetId);
    openConfirm({
      title: `Supprimer le dossier local « ${target?.nomProjet || targetId} » ?`,
      message: 'Cette suppression concerne uniquement la copie locale sur cet appareil.',
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: async () => {
        const deletingActive = targetId === activeDossierIdRef.current;
        if (deletingActive && persistTimerRef.current !== null) {
          window.clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        await deleteDossier(targetId);
        const remaining = await listDossiers();
        setDossiers(remaining);
        if (deletingActive && remaining.length > 0) {
          const next = remaining[0];
          const norm = normalizeProjectData(next.data);
          await activateDossierState(next.id, norm, {
            dirtySinceJson: !next.lastJsonExportAt || next.updatedAt > next.lastJsonExportAt,
          });
        }
        notify('info', 'Dossier local supprimé.');
      },
    });
  };

  const handleToggleAutoSave = async (enabled: boolean) => {
    setAutoSaveEnabled(enabled);
    if (activeDossierId) {
      await savePrefs({
        id: 'prefs',
        activeDossierId,
        autoSaveEnabled: enabled,
        autoSaveIntervalMin: 7,
        lastAutoSaveAt: lastAutoSaveAt || undefined,
      });
    }
    notify(
      'info',
      enabled
        ? 'Sauvegarde automatique activée (toutes les 7 minutes).'
        : 'Sauvegarde automatique périodique mise en pause.'
    );
  };

  const handleSaveSnapshotNow = async () => {
    const id = activeDossierIdRef.current;
    if (!id) return;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    await upsertDossier(id, appDataRef.current);
    const snap = await saveSnapshot(id, appDataRef.current, 'manual');
    setLastAutoSaveAt(snap.savedAt);
    await savePrefs({
      id: 'prefs',
      activeDossierId: id,
      autoSaveEnabled,
      autoSaveIntervalMin: 7,
      lastAutoSaveAt: snap.savedAt,
    });
    if (linkedFileHandleRef.current) {
      try {
        const ok = await writeProjectToFileHandle(linkedFileHandleRef.current, appDataRef.current);
        if (ok) {
          await markDossierExported(id);
          setIsDirtySinceJson(false);
        }
      } catch {
        // Ignore
      }
    }
    setDossiers(await listDossiers());
    notify('success', 'Instantané du dossier enregistré.');
  };

  const handleRestoreSnapshot = (snap: SnapshotRecord) => {
    openConfirm({
      title: 'Restaurer cet instantané ?',
      message: `Le dossier actif sera restauré tel qu'il était enregistré à ${new Date(snap.savedAt).toLocaleString('fr-FR')}.`,
      confirmLabel: 'Restaurer',
      danger: true,
      onConfirm: async () => {
        const norm = normalizeProjectData(snap.data);
        const id = activeDossierIdRef.current;
        if (persistTimerRef.current !== null) {
          window.clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        lastLoadedDataRef.current = norm;
        setAppData(norm);
        clearHistory();
        if (id) {
          await upsertDossier(id, norm);
          setDossiers(await listDossiers());
        }
        setShowDossiersModal(false);
        notify('success', 'Instantané restauré.');
      },
    });
  };

  const handleLinkLocalFile = async () => {
    try {
      const handle = await pickJsonBackupHandle(appData.nomProjet);
      if (!handle) return;
      const ok = await writeProjectToFileHandle(handle, appDataRef.current);
      if (!ok) {
        notify('warning', 'Permission d’écriture refusée sur le fichier.');
        return;
      }
      linkedFileHandleRef.current = handle;
      setLinkedFileName(handle.name);
      if (activeDossierId) {
        await markDossierExported(activeDossierId);
        setDossiers(await listDossiers());
      }
      setIsDirtySinceJson(false);
      notify(
        'success',
        `Fichier « ${handle.name} » lié : il sera mis à jour automatiquement toutes les 7 min.`
      );
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      notify(
        'warning',
        'Impossible de lier un fichier disque dans cet environnement (les instantanés automatiques locaux restent actifs).'
      );
    }
  };

  const handleUnlinkLocalFile = () => {
    linkedFileHandleRef.current = null;
    setLinkedFileName(null);
    notify('info', 'Fichier disque délié.');
  };

  const handlePrintActiveTab = (orient: 'portrait' | 'landscape') => {
    setPrintOrientationStyle(orient);
    setMultiPrintBatch(null);
    window.setTimeout(() => {
      window.print();
    }, 80);
  };

  const launchPrintBatch = useCallback(
    (
      batch: PrintTabSelection[],
      orient: 'portrait' | 'landscape',
      nextBatch?: { tabs: PrintTabSelection[]; orient: 'portrait' | 'landscape' }
    ) => {
      setPrintOrientationStyle(orient);
      setMultiPrintBatch(batch);

      const handleAfterPrint = () => {
        window.removeEventListener('afterprint', handleAfterPrint);
        setMultiPrintBatch(null);
        if (nextBatch && nextBatch.tabs.length > 0) {
          openConfirm({
            title: `Lot ${orient === 'portrait' ? 'Portrait' : 'Paysage'} terminé`,
            message: `Le premier lot (${orient}) a été envoyé à l'impression. Voulez-vous lancer le second lot (${
              nextBatch.orient === 'portrait' ? 'Portrait' : 'Paysage'
            } — ${nextBatch.tabs.length} onglet(s)) ?`,
            confirmLabel: `Imprimer lot ${
              nextBatch.orient === 'portrait' ? 'Portrait' : 'Paysage'
            }`,
            onConfirm: () => {
              launchPrintBatch(nextBatch.tabs, nextBatch.orient);
            },
          });
        }
      };

      window.addEventListener('afterprint', handleAfterPrint);
      window.setTimeout(() => {
        window.print();
      }, 120);
    },
    [openConfirm]
  );

  const handleMultiPrintTabs = (selections: PrintTabSelection[]) => {
    const portraits = selections.filter((s) => s.orientation === 'portrait');
    const landscapes = selections.filter((s) => s.orientation === 'landscape');

    if (portraits.length > 0 && landscapes.length > 0) {
      launchPrintBatch(portraits, 'portrait', { tabs: landscapes, orient: 'landscape' });
    } else if (portraits.length > 0) {
      launchPrintBatch(portraits, 'portrait');
    } else if (landscapes.length > 0) {
      launchPrintBatch(landscapes, 'landscape');
    }
  };

  const handlePrintInasepSheet = () => {
    printHtmlViaIframe(buildInasepDelaySheetHtml(appData));
  };

  const kpis = useMemo(() => {
    const postes = srcP(appData);
    const budget = postes.reduce((s, p) => s + mnt(p.qte, p.pu), 0);
    const cumulValide = (appData.historiqueEA || []).reduce((s, ea) => s + (ea.montant || 0), 0);
    const pctValide = budget > 0 ? (cumulValide / budget) * 100 : 0;
    const etat = calculerEtatDelai(appData);
    const nextEa = prochainNumeroEA(appData);
    return { budget, cumulValide, pctValide, etat, nextEa };
  }, [appData]);

  const navTabs = BASE_TABS;

  const renderTabContent = (tabId: number) => {
    switch (tabId) {
      case 1:
        return (
          <Tab1Global
            appData={appData}
            onUpdateData={handleUpdateData}
            onNotify={notify}
            onConfirm={openConfirm}
            hideBordereauPrint={hideBordereauPrint}
            onToggleHideBordereauPrint={setHideBordereauPrint}
            onOpenQualiroutes={openQualiroutes}
          />
        );
      case 2:
        return (
          <Tab2Encodage
            appData={appData}
            onUpdateData={handleUpdateData}
            onNotify={notify}
            onConfirm={openConfirm}
          />
        );
      case 3:
        return (
          <Tab3Carnet
            appData={appData}
            onUpdateData={handleUpdateData}
            onNotify={notify}
            onConfirm={openConfirm}
            onOpenQualiroutes={openQualiroutes}
          />
        );
      case 4:
        return (
          <Tab4EaEnCours
            appData={appData}
            onUpdateData={handleUpdateData}
            onNotify={notify}
            onConfirm={openConfirm}
            onAfterCloseEA={() => setActiveTab(5)}
            onOpenQualiroutes={openQualiroutes}
          />
        );
      case 5:
        return (
          <Tab5EaValides
            appData={appData}
            onUpdateData={handleUpdateData}
            onNotify={notify}
            onConfirm={openConfirm}
            onAfterDevalider={() => setActiveTab(4)}
          />
        );
      case 6:
        return (
          <Tab6Cumul
            appData={appData}
            onUpdateData={handleUpdateData}
            onNotify={notify}
            onOpenQualiroutes={openQualiroutes}
          />
        );
      case 7:
        return (
          <Tab7Delais
            appData={appData}
            onUpdateData={handleUpdateData}
            onNotify={notify}
            sansCalendrier={sansCalendrier}
            onToggleSansCalendrier={setSansCalendrier}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header
        className={`no-print bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 ${
          isFreeScrollHeaderTab ? '' : 'sticky top-0 z-30'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6">
          {/* Brand + Global KPI Strip + Actions */}
          <div className="py-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={INASEP_LOGO_BASE64}
                alt="INASEP"
                className="h-10 w-auto object-contain rounded bg-white p-0.5 border border-slate-200 dark:border-slate-700 shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
                    ProjectController V2.0
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Gestion Chantier &amp; Décomptes · F.Pirquin
                  </span>
                  {(!isOnline || session.offlineMode) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-semibold">
                      <WifiOff className="w-3 h-3" /> Hors-ligne
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[320px] sm:max-w-[460px]">
                  {appData.infosAdministratives.marche
                    ? `${appData.infosAdministratives.marche} — `
                    : ''}
                  {appData.infosAdministratives.intitule || appData.nomProjet || 'Chantier vierge'}
                </div>
              </div>
            </div>

            {/* Compact KPI Strip */}
            <div className="hidden xl:flex items-center border border-slate-200 dark:border-slate-800 rounded-lg divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
              <div className="px-3 py-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Budget marché
                </div>
                <div className="text-xs font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {fmt(kpis.budget)} €
                </div>
              </div>
              <div className="px-3 py-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Validé ({appData.historiqueEA.length} EA)
                </div>
                <div className="text-xs font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {fmt(kpis.cumulValide)} € ({fmt(kpis.pctValide, 1)}%)
                </div>
              </div>
              <div className="px-3 py-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Prochain EA
                </div>
                <div className="text-xs font-bold font-mono tabular-nums text-sky-700 dark:text-sky-400">
                  EA {String(kpis.nextEa).padStart(2, '0')}
                </div>
              </div>
              <div className="px-3 py-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Délai consommé
                </div>
                <div className="text-xs font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {kpis.etat.os ? `${kpis.etat.consumedExec} / ${kpis.etat.totalExec} j` : '—'}
                </div>
              </div>
            </div>

            {/* Utility Actions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowDossiersModal(true)}
                className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/50 text-sky-800 dark:text-sky-300 cursor-pointer whitespace-nowrap shrink-0"
                title={`Gérer mes chantiers locaux (${dossiers.length}) & sauvegarde auto 7 min`}
              >
                <FolderKanban className="w-3.5 h-3.5" />
                Mes chantiers ({dossiers.length || 1})
              </button>

              <button
                type="button"
                onClick={() => void handleSaveJson()}
                className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white cursor-pointer whitespace-nowrap shrink-0"
                title={
                  isDirtySinceJson
                    ? 'Des modifications n’ont pas encore été exportées en .json'
                    : 'Exporter le dossier complet au format JSON'
                }
              >
                <Save className="w-3.5 h-3.5" />
                Sauvegarder
                {isDirtySinceJson && (
                  <span
                    className="w-2 h-2 rounded-full bg-amber-300"
                    title="Modifications non exportées en .json"
                  />
                )}
              </button>

              <button
                type="button"
                onClick={() => jsonInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
                title="Charger une sauvegarde .json"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Charger (.json)
              </button>
              <input
                ref={jsonInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLoadJsonFile(file);
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                onClick={handleResetVierge}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
                title="Réinitialiser sur un chantier vierge"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                Nouveau
              </button>

              <PWAInstallButton />

              {canManageAccess && (
                <button
                  type="button"
                  onClick={() => setShowAccesModal(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 cursor-pointer whitespace-nowrap shrink-0"
                  title="Gestion des accès collègues (Administrateur uniquement)"
                >
                  <Shield className="w-3.5 h-3.5" />
                  Accès
                </button>
              )}

              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:block" />

              <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={historyCounts.undo === 0}
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none cursor-pointer whitespace-nowrap shrink-0"
                  title={`Annuler la dernière modification (Ctrl+Z) — ${historyCounts.undo} en mémoire`}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Annuler</span>
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={historyCounts.redo === 0}
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium border-l border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-35 disabled:pointer-events-none cursor-pointer whitespace-nowrap shrink-0"
                  title={`Rétablir (Ctrl+Y) — ${historyCounts.redo} disponible(s)`}
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => handlePrintActiveTab('portrait')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                  title="Imprimer l'onglet actif en A4 Portrait"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Portrait
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintActiveTab('landscape')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border-l border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                  title="Imprimer l'onglet actif en A4 Paysage"
                >
                  Paysage
                </button>
                <button
                  type="button"
                  onClick={() => setShowMultiPrintModal(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border-l border-slate-300 dark:border-slate-700 text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer whitespace-nowrap shrink-0"
                  title="Impression groupée multi-onglets et feuille INASEP"
                >
                  Lot…
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer shrink-0"
                title={isDark ? 'Passer au thème clair' : 'Passer au thème sombre'}
                aria-label="Changer de thème"
              >
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => void onSignOut()}
                className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300 cursor-pointer shrink-0"
                title={`Déconnexion (${session.user.email || ''})`}
                aria-label="Se déconnecter"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex items-center gap-1 overflow-x-auto pt-1.5" aria-label="Navigation principale">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-[#1e3a5f] dark:border-sky-400 text-[#1e3a5f] dark:text-sky-300 bg-sky-50/50 dark:bg-sky-950/25 rounded-t-md'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-t-md'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main
        className={`flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 ${
          multiPrintBatch ? 'hidden print:hidden' : ''
        }`}
      >
        {renderTabContent(activeTab)}
        <div
          className={`text-right text-[10px] text-slate-400 dark:text-slate-600 italic mt-4 ${
            activeTab === 7 ? 'no-print' : ''
          }`}
        >
          © ProjectController-F.Pirquin-INASEP
        </div>
      </main>

      {/* Multi-tab print container */}
      {multiPrintBatch && (
        <div className="hidden print:block w-full">
          {multiPrintBatch.map((item, idx) => (
            <div key={item.id} className={idx > 0 ? 'break-before-page pt-2' : ''}>
              {renderTabContent(item.id)}
              <div
                className={`text-right text-[9px] text-slate-600 italic mt-2 ${
                  item.id === 7 ? 'no-print' : ''
                }`}
              >
                © ProjectController-F.Pirquin-INASEP
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="no-print text-center text-[10px] text-slate-500 dark:text-slate-500 italic py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        ProjectController · F.Pirquin · INASEP — Outil interne de gestion de chantier ({session.user.email})
      </footer>

      {/* Modals & Toasts */}
      {showMultiPrintModal && (
        <MultiPrintModal
          onClose={() => setShowMultiPrintModal(false)}
          onPrintTabs={handleMultiPrintTabs}
          onPrintInasepSheet={handlePrintInasepSheet}
        />
      )}

      {qualiroutesCtx && (
        <React.Suspense fallback={null}>
          <QualiroutesModal
            initialRef={qualiroutesCtx.ref}
            initialDesc={qualiroutesCtx.desc}
            onClose={() => setQualiroutesCtx(null)}
          />
        </React.Suspense>
      )}

      {canManageAccess && showAccesModal && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
          onClick={() => setShowAccesModal(false)}
        >
          <div
            className="w-full max-w-5xl max-h-[90vh] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 bg-[#1e3a5f] text-white flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <Shield className="w-5 h-5 text-emerald-300" />
                <div>
                  <div className="text-sm font-bold">Gestion des accès — Administrateur</div>
                  <div className="text-[11px] text-sky-100/80">
                    Accès réservé exclusivement à {session.user.email}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAccesModal(false)}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
              >
                Fermer
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <React.Suspense fallback={<div className="py-8 text-center text-xs text-slate-500">Chargement…</div>}>
                <Tab8Acces
                  currentUser={session.user}
                  onNotify={notify}
                  onConfirm={openConfirm}
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}

      {showDossiersModal && (
        <DossiersModal
          dossiers={dossiers}
          activeDossierId={activeDossierId}
          autoSaveEnabled={autoSaveEnabled}
          lastAutoSaveAt={lastAutoSaveAt}
          isDirtySinceJson={isDirtySinceJson}
          linkedFileName={linkedFileName}
          onClose={() => setShowDossiersModal(false)}
          onSwitchDossier={(id) => void handleSwitchDossier(id)}
          onCreateNewDossier={() => void handleCreateNewDossier()}
          onImportJsonAsNewDossier={(file) => void handleLoadJsonFile(file, true)}
          onDuplicateDossier={(id) => void handleDuplicateDossier(id)}
          onDeleteDossier={handleDeleteDossier}
          onToggleAutoSave={(en) => void handleToggleAutoSave(en)}
          onSaveSnapshotNow={() => void handleSaveSnapshotNow()}
          onRestoreSnapshot={handleRestoreSnapshot}
          onExportJson={() => void handleSaveJson()}
          onLinkLocalFile={() => void handleLinkLocalFile()}
          onUnlinkLocalFile={handleUnlinkLocalFile}
        />
      )}

      {showScrollTop && isFreeScrollHeaderTab && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="no-print fixed bottom-4 left-4 z-40 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1e3a5f] hover:bg-[#162d4b] text-white text-xs font-semibold shadow-lg border border-sky-400/30 cursor-pointer"
          title="Revenir en haut de page et aux onglets"
        >
          <ArrowUp className="w-3.5 h-3.5" />
          <span>Haut</span>
        </button>
      )}

      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
