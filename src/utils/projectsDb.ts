import { ProjectData } from '../types/project';
import { mnt, srcP } from './calculations';

const DB_NAME = 'projectcontroller_chantiers_db';
const DB_VERSION = 1;
const STORE_CHANTIERS = 'chantiers';
const STORE_SNAPSHOTS = 'snapshots';
const STORE_PREFS = 'prefs';

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Délai dépassé ouverture IndexedDB'));
      }
    }, 3000);

    const req = indexedDB.open(DB_NAME, DB_VERSION);
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
      if (!settled) {
        settled = true;
        resolve(req.result);
      }
    };
    req.onerror = () => {
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(req.error || new Error('Erreur ouverture IndexedDB'));
      }
    };
    req.onblocked = () => {
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error('IndexedDB bloquée par un autre onglet'));
      }
    };
  });
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
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PREFS, 'readonly');
      const req = tx.objectStore(STORE_PREFS).get('prefs');
      req.onsuccess = () => resolve((req.result as DossiersPrefs) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function savePrefs(prefs: DossiersPrefs): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PREFS, 'readwrite');
      tx.objectStore(STORE_PREFS).put(prefs);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignorer si stockage indisponible
  }
}

export async function listDossiers(): Promise<ChantierRecord[]> {
  try {
    const db = await openDb();
    const list = await new Promise<ChantierRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CHANTIERS, 'readonly');
      const req = tx.objectStore(STORE_CHANTIERS).getAll();
      req.onsuccess = () => resolve((req.result as ChantierRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    return list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } catch {
    return [];
  }
}

export async function getDossier(id: string): Promise<ChantierRecord | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHANTIERS, 'readonly');
      const req = tx.objectStore(STORE_CHANTIERS).get(id);
      req.onsuccess = () => resolve((req.result as ChantierRecord) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
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

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHANTIERS, 'readwrite');
      tx.objectStore(STORE_CHANTIERS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback géré par localStorage
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
    // Ignore
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
    return list.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  } catch {
    return [];
  }
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
    // Ignore
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
