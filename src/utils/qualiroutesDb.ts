import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { normalizeQualiroutesRef } from './calculations';

const DB_NAME = 'projectcontroller_qualiroutes_db';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_SECTIONS = 'sections';
const STORE_PAGES = 'pages';

export interface QualiroutesMeta {
  id: 'current';
  fileName: string;
  numPages: number;
  indexedAt: string;
  sectionCount: number;
}

export interface QualiroutesSection {
  code: string; // Normalisé sans espaces, ex. "F.2.3.1"
  title: string;
  pageNum: number; // 1-indexed
}

export interface QualiroutesPage {
  pageNum: number;
  text: string;
}

export interface QualiroutesSearchHit {
  code: string;
  title: string;
  pageNum: number;
  excerpt: string;
  exactMatch: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SECTIONS)) {
        db.createObjectStore(STORE_SECTIONS, { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        db.createObjectStore(STORE_PAGES, { keyPath: 'pageNum' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erreur IndexedDB Qualiroutes'));
  });
}

export async function getQualiroutesMeta(): Promise<QualiroutesMeta | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get('current');
      req.onsuccess = () => resolve((req.result as QualiroutesMeta) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getQualiroutesPage(pageNum: number): Promise<QualiroutesPage | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const req = tx.objectStore(STORE_PAGES).get(pageNum);
    req.onsuccess = () => resolve((req.result as QualiroutesPage) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllQualiroutesSections(): Promise<QualiroutesSection[]> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SECTIONS, 'readonly');
    const req = tx.objectStore(STORE_SECTIONS).getAll();
    req.onsuccess = () => resolve((req.result as QualiroutesSection[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearQualiroutesIndex(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_SECTIONS, STORE_PAGES], 'readwrite');
    tx.objectStore(STORE_META).clear();
    tx.objectStore(STORE_SECTIONS).clear();
    tx.objectStore(STORE_PAGES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function extractArticleCodeFromText(raw: string): string | null {
  const m = raw.trim().match(/^([A-Q])\s*\.\s*(\d+(?:\s*\.\s*\d+)*)/i);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const nums = m[2].replace(/\s+/g, '');
  return `${letter}.${nums}`;
}

function buildExcerpt(text: string, query: string): string {
  if (!text) return '';
  const normQ = normalizeQualiroutesRef(query).toLowerCase();
  const spacedRegex = normQ
    ? new RegExp(normQ.replace(/\./g, '\\s*\\.\\s*'), 'i')
    : null;
  const idx = spacedRegex ? text.search(spacedRegex) : -1;
  if (idx < 0) {
    return text.slice(0, 1200);
  }
  const start = Math.max(0, idx - 200);
  const end = Math.min(text.length, idx + 1200);
  return `${start > 0 ? '… ' : ''}${text.slice(start, end)}${end < text.length ? ' …' : ''}`;
}

export async function indexQualiroutesPdfBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  onProgress?: (pct: number, detail: string) => void
): Promise<QualiroutesMeta> {
  onProgress?.(2, 'Ouverture du document PDF…');
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const sectionsMap = new Map<string, QualiroutesSection>();

  // 1. Extraction rapide de la table des matières (signets PDF)
  try {
    onProgress?.(5, 'Lecture des chapitres et signets…');
    const outline = await pdf.getOutline();
    const walkOutline = async (
      items: NonNullable<typeof outline>
    ): Promise<void> => {
      for (const item of items) {
        try {
          let destPageNum: number | null = null;
          if (typeof item.dest === 'string') {
            const dest = await pdf.getDestination(item.dest);
            if (Array.isArray(dest) && dest[0]) {
              destPageNum = (await pdf.getPageIndex(dest[0])) + 1;
            }
          } else if (Array.isArray(item.dest) && item.dest[0]) {
            destPageNum = (await pdf.getPageIndex(item.dest[0])) + 1;
          }
          const code = extractArticleCodeFromText(item.title || '');
          if (code && destPageNum && !sectionsMap.has(code)) {
            sectionsMap.set(code, {
              code,
              title: (item.title || code).trim(),
              pageNum: destPageNum,
            });
          }
        } catch {
          // Ignorer signet invalide
        }
        if (item.items && item.items.length > 0) {
          await walkOutline(item.items);
        }
      }
    };
    if (outline && outline.length > 0) {
      await walkOutline(outline);
    }
  } catch {
    // Certains PDF n'ont pas de signets
  }

  // 2. Extraction du texte page par page + détection des articles internes
  const db = await openDb();
  await clearQualiroutesIndex();

  const BATCH_SIZE = 40;
  let pageBatch: QualiroutesPage[] = [];

  const flushPages = async (batch: QualiroutesPage[]) => {
    if (!batch.length) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PAGES, 'readwrite');
      const store = tx.objectStore(STORE_PAGES);
      for (const p of batch) {
        store.put(p);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  };

  const articleHeadingRegex =
    /(?:^|\n)\s*([A-Q]\s*\.\s*\d+(?:\s*\.\s*\d+){1,5})\.?\s+([^\n]{3,140})/g;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = '';
    for (const rawItem of tc.items) {
      const item = rawItem as { str?: string; hasEOL?: boolean };
      if (typeof item.str === 'string') {
        currentLine += (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + item.str;
      }
      if (item.hasEOL) {
        const trimmed = currentLine.replace(/\s+/g, ' ').trim();
        if (trimmed) lines.push(trimmed);
        currentLine = '';
      }
    }
    if (currentLine.trim()) {
      lines.push(currentLine.replace(/\s+/g, ' ').trim());
    }

    const pageText = lines.join('\n');
    pageBatch.push({ pageNum, text: pageText });

    // Indexer les sous-articles détectés dans le corps du texte
    let match: RegExpExecArray | null;
    articleHeadingRegex.lastIndex = 0;
    while ((match = articleHeadingRegex.exec(pageText)) !== null) {
      const code = normalizeQualiroutesRef(match[1]).toUpperCase();
      if (code && !sectionsMap.has(code)) {
        sectionsMap.set(code, {
          code,
          title: `${code} — ${match[2].trim()}`,
          pageNum,
        });
      }
    }

    if (pageBatch.length >= BATCH_SIZE || pageNum === numPages) {
      await flushPages(pageBatch);
      pageBatch = [];
      const pct = Math.min(96, Math.round(5 + (pageNum / numPages) * 90));
      onProgress?.(pct, `Indexation page ${pageNum} / ${numPages}…`);
    }
  }

  onProgress?.(98, 'Enregistrement de l’index local…');
  const sections = Array.from(sectionsMap.values());
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SECTIONS, STORE_META], 'readwrite');
    const secStore = tx.objectStore(STORE_SECTIONS);
    for (const sec of sections) {
      secStore.put(sec);
    }
    const meta: QualiroutesMeta = {
      id: 'current',
      fileName,
      numPages,
      indexedAt: new Date().toISOString(),
      sectionCount: sections.length,
    };
    tx.objectStore(STORE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  onProgress?.(100, 'Indexation terminée.');
  return {
    id: 'current',
    fileName,
    numPages,
    indexedAt: new Date().toISOString(),
    sectionCount: sections.length,
  };
}

export async function lookupQualiroutesReference(
  rawQuery: string
): Promise<QualiroutesSearchHit[]> {
  const query = rawQuery.trim();
  if (!query) return [];

  const normRef = normalizeQualiroutesRef(query).toUpperCase();
  const sections = await getAllQualiroutesSections();
  const hits: QualiroutesSearchHit[] = [];
  const seenPages = new Set<number>();

  // 1. Correspondance exacte ou parent le plus proche dans les sections indexées
  const exactSec = sections.find((s) => s.code.toUpperCase() === normRef);
  if (exactSec) {
    const page = await getQualiroutesPage(exactSec.pageNum);
    seenPages.add(exactSec.pageNum);
    hits.push({
      code: exactSec.code,
      title: exactSec.title,
      pageNum: exactSec.pageNum,
      excerpt: buildExcerpt(page?.text || '', query),
      exactMatch: true,
    });
  }

  // Correspondances par préfixe d'article (ex. F.2.3.1.2 -> F.2.3.1 ou F.2.3)
  if (hits.length === 0 && /^[A-Q]\.\d+/.test(normRef)) {
    const parts = normRef.split('.');
    for (let len = parts.length - 1; len >= 2; len--) {
      const prefix = parts.slice(0, len).join('.');
      const parentSec = sections.find((s) => s.code.toUpperCase() === prefix);
      if (parentSec && !seenPages.has(parentSec.pageNum)) {
        const page = await getQualiroutesPage(parentSec.pageNum);
        seenPages.add(parentSec.pageNum);
        hits.push({
          code: parentSec.code,
          title: `${parentSec.title} (section parente de ${normRef})`,
          pageNum: parentSec.pageNum,
          excerpt: buildExcerpt(page?.text || '', normRef),
          exactMatch: false,
        });
        break;
      }
    }
  }

  // 2. Recherche texte intégral sur toutes les pages IndexedDB (max 15 résultats)
  const db = await openDb();
  const spacedPattern = normRef.replace(/\./g, '\\s*\\.\\s*');
  const refRegex = /^[A-Q]\.\d+/.test(normRef) ? new RegExp(spacedPattern, 'i') : null;
  const lowQuery = query.toLowerCase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const req = tx.objectStore(STORE_PAGES).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || hits.length >= 15) {
        resolve();
        return;
      }
      const p = cursor.value as QualiroutesPage;
      if (!seenPages.has(p.pageNum)) {
        const matched = refRegex
          ? refRegex.test(p.text)
          : p.text.toLowerCase().includes(lowQuery);
        if (matched) {
          seenPages.add(p.pageNum);
          hits.push({
            code: normRef || query,
            title: `Occurrence à la page ${p.pageNum}`,
            pageNum: p.pageNum,
            excerpt: buildExcerpt(p.text, query),
            exactMatch: Boolean(refRegex),
          });
        }
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  return hits;
}
