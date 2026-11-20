import { ProjectData } from '../types/project';
import { mnt, srcP } from './calculations';

const DB_NAME = 'projectcontroller_chantiers_db';
const DB_VERSION = 1;
const STORE_CHANTIERS = 'chantiers';
const STORE_SNAPSHOTS = 'snapshots';
const STORE_PREFS = 'prefs';
const FALLBACK_STORAGE_KEY = 'projectcontroller_chantiers_fallback_v1';

export interface ChantierRecord {
  id: string;
  nomProjet: string;
  marche: string;
  intitule: string;
  budget: number;
  nbTroncons: number;
  nbEA: number;
  updatedAt: string;
  lastJsonExportAt?: string;
  data: ProjectData;
}

export interface SnapshotRecord {
  id: string;
  dossierId: string;
  savedAt: string;
  reason: 'auto' | 'manual';
  nomProjet: string;
  data: ProjectData;
}

export interface DossiersPrefs {
  id: 'prefs';
  activeDossierId: string;
  autoSaveEnabled: boolean;
  autoSaveIntervalMin: number;
  lastAutoSaveAt?: string;
}

interface FallbackStore {
  chantiers: Record<string, ChantierRecord>;
  snapshots: SnapshotRecord[];
  prefs: DossiersPrefs | null;
}

function readFallbackStore(): FallbackStore {
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FallbackStore>;
      return {
        chantiers: parsed.chantiers && typeof parsed.chantiers === 'object' ? parsed.chantiers : {},
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
        prefs: parsed.prefs || null,
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return { chantiers: {}, snapshots: [], prefs: null };
}

function writeFallbackStore(store: FallbackStore): void {
  try {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Si quota atteint, ne garder que les 2 derniers snapshots en fallback
    try {
      const trimmed: FallbackStore = {
        ...store,
        snapshots: store.snapshots.slice(0, 2),
      };
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Ignore si localStorage saturé
    }
  }
}

let cachedDbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (cachedDbPromise) return cachedDbPromise;

  cachedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cachedDbPromise = null;
        reject(new Error('Délai dépassé ouverture IndexedDB'));
      }
    }, 3000);

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      window.clearTimeout(timer);
      cachedDbPromise = null;
      reject(err instanceof Error ? err : new Error('Erreur ouverture IndexedDB'));
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHANTIERS)) {
        db.createObjectStore(STORE_CHANTIERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snapStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        snapStore.createIndex('by_dossier', 'dossierId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      window.clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        cachedDbPromise = null;
      };
      db.onclose = () => {
        cachedDbPromise = null;
      };
      if (!settled) {
        settled = true;
        resolve(db);
      }
    };
    req.onerror = () => {
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        cachedDbPromise = null;
        reject(req.error || new Error('Erreur ouverture IndexedDB'));
      }
    };
    req.onblocked = () => {
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        cachedDbPromise = null;
        reject(new Error('IndexedDB bloquée par un autre onglet'));
      }
    };
  });

  return cachedDbPromise;
}

export function generateDossierId(): string {
  return `dos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function computeSummary(data: ProjectData): Pick<
  ChantierRecord,
  'nomProjet' | 'marche' | 'intitule' | 'budget' | 'nbTroncons' | 'nbEA'
> {
  const postes = srcP(data);
  const budget = Math.round(postes.reduce((s, p) => s + mnt(p.qte, p.pu), 0) * 100) / 100;
  return {
    nomProjet: data.nomProjet || 'Chantier_sans_nom',
    marche: data.infosAdministratives?.marche || '',
    intitule: data.infosAdministratives?.intitule || '',
    budget,
    nbTroncons: (data.tronconsEgout || []).length,
    nbEA: (data.historiqueEA || []).length,
  };
}

export async function getPrefs(): Promise<DossiersPrefs | null> {
  try {
    const db = await openDb();
    const res = await new Promise<DossiersPrefs | null>((resolve, reject) => {
      const tx = db.transaction(STORE_PREFS, 'readonly');
      const req = tx.objectStore(STORE_PREFS).get('prefs');
      req.onsuccess = () => resolve((req.result as DossiersPrefs) || null);
      req.onerror = () => reject(req.error);
    });
    if (res) return res;
  } catch {
    // Fallback localStorage ci-dessous
  }
  return readFallbackStore().prefs;
}

export async function savePrefs(prefs: DossiersPrefs): Promise<void> {
  const fb = readFallbackStore();
  fb.prefs = prefs;
  writeFallbackStore(fb);

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PREFS, 'readwrite');
      tx.objectStore(STORE_PREFS).put(prefs);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback déjà écrit
  }
}

export async function listDossiers(): Promise<ChantierRecord[]> {
  let idbList: ChantierRecord[] = [];
  try {
    const db = await openDb();
    idbList = await new Promise<ChantierRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CHANTIERS, 'readonly');
      const req = tx.objectStore(STORE_CHANTIERS).getAll();
      req.onsuccess = () => resolve((req.result as ChantierRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Utiliser fallback
  }

  const fbMap = readFallbackStore().chantiers;
  const merged = new Map<string, ChantierRecord>();
  for (const r of Object.values(fbMap)) {
    merged.set(r.id, r);
  }
  for (const r of idbList) {
    const existing = merged.get(r.id);
    if (!existing || (r.updatedAt || '') >= (existing.updatedAt || '')) {
      merged.set(r.id, r);
    }
  }
  return Array.from(merged.values()).sort((a, b) =>
    (b.updatedAt || '').localeCompare(a.updatedAt || '')
  );
}

export async function getDossier(id: string): Promise<ChantierRecord | null> {
  let idbRec: ChantierRecord | null = null;
  try {
    const db = await openDb();
    idbRec = await new Promise<ChantierRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_CHANTIERS, 'readonly');
      const req = tx.objectStore(STORE_CHANTIERS).get(id);
      req.onsuccess = () => resolve((req.result as ChantierRecord) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback
  }
  const fbRec = readFallbackStore().chantiers[id] || null;
  if (idbRec && fbRec) {
    return (idbRec.updatedAt || '') >= (fbRec.updatedAt || '') ? idbRec : fbRec;
  }
  return idbRec || fbRec;
}

export async function upsertDossier(
  id: string,
  data: ProjectData,
  opts?: { lastJsonExportAt?: string; preserveUpdatedAt?: string }
): Promise<ChantierRecord> {
  const existing = await getDossier(id);
  const record: ChantierRecord = {
    id,
    ...computeSummary(data),
    updatedAt: opts?.preserveUpdatedAt || new Date().toISOString(),
    lastJsonExportAt:
      opts?.lastJsonExportAt !== undefined
        ? opts.lastJsonExportAt
        : existing?.lastJsonExportAt,
    data,
  };

  const fb = readFallbackStore();
  fb.chantiers[id] = record;
  writeFallbackStore(fb);

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHANTIERS, 'readwrite');
      tx.objectStore(STORE_CHANTIERS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback déjà écrit
  }
  return record;
}

export async function markDossierExported(id: string): Promise<string | null> {
  const existing = await getDossier(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  await upsertDossier(id, existing.data, {
    lastJsonExportAt: now,
    preserveUpdatedAt: existing.updatedAt,
  });
  return now;
}

export async function deleteDossier(id: string): Promise<void> {
  const fb = readFallbackStore();
  delete fb.chantiers[id];
  fb.snapshots = fb.snapshots.filter((s) => s.dossierId !== id);
  writeFallbackStore(fb);

  try {
    const db = await openDb();
    const snaps = await listSnapshots(id);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_CHANTIERS, STORE_SNAPSHOTS], 'readwrite');
      tx.objectStore(STORE_CHANTIERS).delete(id);
      const snapStore = tx.objectStore(STORE_SNAPSHOTS);
      snaps.forEach((s) => snapStore.delete(s.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback déjà supprimé
  }
}

export async function listSnapshots(dossierId: string): Promise<SnapshotRecord[]> {
  try {
    const db = await openDb();
    const list = await new Promise<SnapshotRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
      const idx = tx.objectStore(STORE_SNAPSHOTS).index('by_dossier');
      const req = idx.getAll(dossierId);
      req.onsuccess = () => resolve((req.result as SnapshotRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    if (list.length > 0) {
      return list.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    }
  } catch {
    // Utiliser fallback
  }
  return readFallbackStore()
    .snapshots.filter((s) => s.dossierId === dossierId)
    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

export async function saveSnapshot(
  dossierId: string,
  data: ProjectData,
  reason: 'auto' | 'manual' = 'auto',
  maxKeep = 10
): Promise<SnapshotRecord> {
  const now = new Date().toISOString();
  const snap: SnapshotRecord = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    dossierId,
    savedAt: now,
    reason,
    nomProjet: data.nomProjet || 'Chantier',
    data,
  };

  const fb = readFallbackStore();
  const fbForDossier = [snap, ...fb.snapshots.filter((s) => s.dossierId === dossierId)].slice(
    0,
    Math.min(maxKeep, 4)
  );
  fb.snapshots = [...fbForDossier, ...fb.snapshots.filter((s) => s.dossierId !== dossierId)];
  writeFallbackStore(fb);

  try {
    const existing = await listSnapshots(dossierId);
    const toDelete = existing.slice(Math.max(0, maxKeep - 1));
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      store.put(snap);
      toDelete.forEach((old) => store.delete(old.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback déjà écrit
  }
  return snap;
}

export async function initDossiersWorkspace(
  initialData: ProjectData,
  normalizeFn: (raw: unknown) => ProjectData
): Promise<{
  activeId: string;
  activeData: ProjectData;
  prefs: DossiersPrefs;
  dossiers: ChantierRecord[];
}> {
  const existingDossiers = await listDossiers();
  const savedPrefs = await getPrefs();

  if (existingDossiers.length === 0) {
    const firstId = generateDossierId();
    const firstRecord = await upsertDossier(firstId, initialData);
    const prefs: DossiersPrefs = {
      id: 'prefs',
      activeDossierId: firstId,
      autoSaveEnabled: savedPrefs?.autoSaveEnabled ?? true,
      autoSaveIntervalMin: savedPrefs?.autoSaveIntervalMin ?? 7,
      lastAutoSaveAt: savedPrefs?.lastAutoSaveAt,
    };
    await savePrefs(prefs);
    return {
      activeId: firstId,
      activeData: initialData,
      prefs,
      dossiers: [firstRecord],
    };
  }

  const activeRecord =
    (savedPrefs?.activeDossierId
      ? existingDossiers.find((d) => d.id === savedPrefs.activeDossierId)
      : undefined) || existingDossiers[0];

  const prefs: DossiersPrefs = {
    id: 'prefs',
    activeDossierId: activeRecord.id,
    autoSaveEnabled: savedPrefs?.autoSaveEnabled ?? true,
    autoSaveIntervalMin: savedPrefs?.autoSaveIntervalMin ?? 7,
    lastAutoSaveAt: savedPrefs?.lastAutoSaveAt,
  };
  await savePrefs(prefs);

  return {
    activeId: activeRecord.id,
    activeData: normalizeFn(activeRecord.data),
    prefs,
    dossiers: existingDossiers,
  };
}

// ─── File System Access API (optionnel : écriture directe sur un fichier .json local) ───

export interface LocalFileHandleLike {
  name: string;
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
  queryPermission?: (opts: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (opts: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

export function supportsLocalFileHandle(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  );
}

export async function pickJsonBackupHandle(
  suggestedName: string
): Promise<LocalFileHandleLike | null> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<LocalFileHandleLike>;
    }
  ).showSaveFilePicker;
  if (!picker) return null;

  const safeName = (suggestedName || 'Chantier').replace(/[^\w\-]+/g, '_');
  const handle = await picker({
    suggestedName: `${safeName}_sauvegarde.json`,
    types: [
      {
        description: 'Sauvegarde ProjectController (JSON)',
        accept: { 'application/json': ['.json'] },
      },
    ],
  });
  return handle;
}

export async function writeProjectToFileHandle(
  handle: LocalFileHandleLike,
  data: ProjectData
): Promise<boolean> {
  if (handle.queryPermission) {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      if (handle.requestPermission) {
        const req = await handle.requestPermission({ mode: 'readwrite' });
        if (req !== 'granted') return false;
      } else {
        return false;
      }
    }
  }
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
  return true;
}
