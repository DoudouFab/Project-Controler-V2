import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MetreRecapPoste, PosteMarche } from '../types/project';
import { NRM } from './calculations';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface MetreRecapParseResult {
  fileName: string;
  totalPages: number;
  postes: MetreRecapPoste[];
}

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  h: number;
}

interface PdfRow {
  y: number;
  items: PdfTextItem[];
}

interface RawPosteBuilder {
  numero: string;
  code: string;
  libLines: string[];
  chapitre: string;
  typePrix: string;
  unite: string;
  quantite: number;
  section: string;
  remLines: string[];
}

const REMARK_PREFIX_RE =
  /^(Remarque\(?s?\)?|Localisation\(?s?\)?|Type|Information\(?s?\)?|Caract[ée]ristiques?|Dimensions?|Diam[èe]tre|Destination|Concerne|Appui|Remblai(?:\s+lat[ée]ral(?:\s+et\s+initial)?)?|Mat[ée]riau(?:x)?|Mati[èe]re|Hauteur|Larg(?:u)?eur|[EÉ]paisseur|Voici\s+quelques\s+donn[ée]es|Plan(?:\s+terrier)?)\s*:/i;

/**
 * Extrait un code article Qualiroutes normalisé (ex. "G.2.2.8.2") depuis une chaîne Chapitre
 * (ex. "G. 2.2.8.2." -> "G.2.2.8.2", "A.R. 14/01/2013 art 36" -> "").
 */
export function extractQualiroutesRefFromChapitre(chapitre: string): string {
  const clean = String(chapitre || '').trim();
  if (!clean) return '';
  const m = clean.match(/\b([A-Q])\s*\.\s*(\d+(?:\s*\.\s*\d+)*)/i);
  if (!m) return '';
  const letter = m[1].toUpperCase();
  const nums = m[2].replace(/\s+/g, '').replace(/\.+$/, '');
  return nums ? `${letter}.${nums}` : '';
}

function parseFrenchDecimal(raw: string): number {
  const cleaned = raw.replace(/\u00A0/g, '').replace(/\s+/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isFinite(val) ? val : 0;
}

export async function parseMetreRecapPdf(
  buffer: ArrayBuffer,
  fileName: string,
  onProgress?: (pct: number) => void
): Promise<MetreRecapParseResult> {
  onProgress?.(2);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  const totalPages = doc.numPages;

  const postes: MetreRecapPoste[] = [];
  let currentSection = '';
  let current: RawPosteBuilder | null = null;

  const flush = () => {
    if (!current) return;
    const libelle = current.libLines.join(' ').replace(/\s+/g, ' ').trim();
    const remarques = current.remLines
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
      .trim();

    if (current.numero && (libelle || current.code || remarques)) {
      postes.push({
        numero: current.numero,
        code: current.code,
        chapitre: current.chapitre.replace(/\s+/g, ' ').trim(),
        typePrix: current.typePrix,
        libelle,
        unite: current.unite,
        quantite: current.quantite,
        ...(current.section ? { section: current.section } : {}),
        remarques,
      });
    }
    current = null;
  };

  for (let p = 1; p <= totalPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();

    const rawItems: PdfTextItem[] = [];
    for (const raw of tc.items) {
      const it = raw as { str?: string; transform?: number[]; height?: number };
      if (typeof it.str !== 'string' || !it.str.trim() || !Array.isArray(it.transform)) continue;
      rawItems.push({
        str: it.str.trim(),
        x: it.transform[4] ?? 0,
        y: it.transform[5] ?? 0,
        h: it.height ?? 0,
      });
    }
    rawItems.sort((a, b) => b.y - a.y || a.x - b.x);

    // Repérer la ligne d'en-tête de colonnes ("Quantité" / "Chapitre" / "Prix Unitaire")
    const headerAnchor = rawItems.find(
      (it) => it.y > 550 && /^(Quantit[ée]|Prix Unitaire|Chapitre)$/i.test(it.str)
    );
    const maxBodyY = headerAnchor ? headerAnchor.y - 4 : 735;

    // Repérer la borne basse du pied de page ("Service d'étude" / "Imprimé le")
    const footerItems = rawItems.filter(
      (it) =>
        it.y < 80 &&
        /^(Service d['’]étude|Imprimé le)/i.test(it.str)
    );
    const minBodyY =
      footerItems.length > 0 ? Math.max(...footerItems.map((it) => it.y)) + 4 : 42;

    const rows: PdfRow[] = [];
    for (const it of rawItems) {
      if (it.y >= maxBodyY || it.y <= minBodyY) continue;
      let row = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
      if (!row) {
        row = { y: it.y, items: [] };
        rows.push(row);
      }
      row.items.push(it);
    }

    rows.sort((a, b) => b.y - a.y);

    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      const first = row.items[0];
      if (!first) continue;

      // Bannière de section (police >= 11.2pt alignée à gauche)
      if (first.h >= 11.2 && first.x < 65 && row.items.length <= 2) {
        flush();
        const bannerTxt = row.items.map((i) => i.str).join(' ').trim();
        if (bannerTxt && !/^Collecteur$/i.test(bannerTxt)) {
          currentSection = bannerTxt;
        }
        continue;
      }

      // Ligne de précision / remarque (police ~9pt à gauche, ou préfixe Remarque/Localisation/...)
      const joinedRow = row.items.map((i) => i.str).join(' ');
      const isRemark =
        (first.h > 0 && first.h <= 9.4 && first.x < 65) ||
        (first.x < 65 && REMARK_PREFIX_RE.test(joinedRow));

      if (isRemark) {
        if (current) {
          current.remLines.push(joinedRow);
        }
        continue;
      }

      // Début d'un poste : N° entier à gauche (x < 85) + Code ou Libellé sur la même ligne
      const hasCodeOrLib = row.items.some((i) => i.x >= 95);
      if (/^\d{1,5}$/.test(first.str) && first.x < 85 && hasCodeOrLib) {
        flush();
        const codeItem = row.items.find((i) => i.x >= 90 && i.x < 170);
        const libItems = row.items.filter((i) => i.x >= 170);
        current = {
          numero: first.str.replace(/^0+(?=\d)/, ''),
          code: codeItem ? codeItem.str : '',
          libLines: libItems.length ? [libItems.map((i) => i.str).join(' ')] : [],
          chapitre: '',
          typePrix: '',
          unite: '',
          quantite: 0,
          section: currentSection,
          remLines: [],
        };
        continue;
      }

      if (!current) continue;

      // Ligne métadonnées (Chapitre | Type de prix | Unité | Quantité)
      const metaType = row.items.find(
        (i) => i.x >= 95 && i.x < 165 && /^(QP|PG|SR|F|TP)$/i.test(i.str)
      );
      const metaQty = row.items.find(
        (i) => i.x >= 225 && i.x < 355 && /^\d[\d\s]*[.,]\d+$/.test(i.str)
      );
      if (metaType || metaQty) {
        const chapItem = row.items.find((i) => i.x < 95);
        const unitItem = row.items.find((i) => i.x >= 170 && i.x < 235);
        if (chapItem) {
          current.chapitre = current.chapitre
            ? `${current.chapitre} ${chapItem.str}`
            : chapItem.str;
        }
        if (metaType) current.typePrix = metaType.str.toUpperCase();
        if (unitItem) current.unite = unitItem.str;
        if (metaQty) current.quantite = parseFrenchDecimal(metaQty.str);
        continue;
      }

      // Suite multi-ligne du Chapitre à gauche (ex. "A.R." -> "14/01/2013" -> "art 36")
      if (first.x < 95 && current.chapitre && current.remLines.length === 0) {
        const chapParts = row.items.filter((i) => i.x < 95).map((i) => i.str);
        if (chapParts.length > 0) {
          current.chapitre = `${current.chapitre} ${chapParts.join(' ')}`.trim();
        }
        const extraLib = row.items.filter((i) => i.x >= 165);
        if (extraLib.length > 0) {
          current.libLines.push(extraLib.map((i) => i.str).join(' '));
        }
        continue;
      }

      // Suite multi-ligne du Libellé (x >= 165)
      const libCont = row.items.filter((i) => i.x >= 165);
      if (libCont.length > 0 && current.remLines.length === 0) {
        current.libLines.push(libCont.map((i) => i.str).join(' '));
      }
    }

    onProgress?.(Math.min(98, Math.round(5 + (p / totalPages) * 93)));
  }

  flush();
  onProgress?.(100);

  if (postes.length === 0) {
    throw new Error(
      "Aucun poste structuré détecté dans ce PDF. Vérifiez qu'il s'agit bien d'un Métré Récapitulatif INASEP."
    );
  }

  return { fileName, totalPages, postes };
}

function tokenOverlapScore(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      NRM(s)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3)
    );
  const sa = tok(a);
  const sb = tok(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  sa.forEach((w) => {
    if (sb.has(w)) common++;
  });
  return common / Math.max(sa.size, sb.size);
}

/**
 * Lie les remarques/précisions, codes et chapitres Qualiroutes extraits d'un Métré Récapitulatif
 * aux postes du bordereau 3P.
 */
export function lierMetreRecapAuMarche3P(
  marche3P: PosteMarche[],
  mrPostes: MetreRecapPoste[]
): {
  marche3P: PosteMarche[];
  linkedCount: number;
  enrichedRemarksCount: number;
  enrichedRefCount: number;
} {
  if (!mrPostes.length || !marche3P.length) {
    return {
      marche3P,
      linkedCount: 0,
      enrichedRemarksCount: 0,
      enrichedRefCount: 0,
    };
  }

  const byNumero = new Map<string, MetreRecapPoste>();
  const byCode = new Map<string, MetreRecapPoste[]>();

  for (const mr of mrPostes) {
    const numKey = mr.numero.trim().replace(/^0+(?=\d)/, '');
    if (numKey && !byNumero.has(numKey)) {
      byNumero.set(numKey, mr);
    }
    const codeKey = mr.code.trim().toUpperCase();
    if (codeKey) {
      const list = byCode.get(codeKey) || [];
      list.push(mr);
      byCode.set(codeKey, list);
    }
  }

  const usedMrNums = new Set<string>();
  let linkedCount = 0;
  let enrichedRemarksCount = 0;
  let enrichedRefCount = 0;

  const updated = marche3P.map((p) => {
    const cleanId = p.id.trim();
    const numId = cleanId.replace(/^0+(?=\d)/, '');
    let matched: MetreRecapPoste | undefined = byNumero.get(numId);

    // Fallback par Code si le N° du 3P est un code ou décalé
    if (!matched) {
      const candidates =
        byCode.get(cleanId.toUpperCase()) ||
        (p.code ? byCode.get(p.code.trim().toUpperCase()) : undefined);

      if (candidates && candidates.length > 0) {
        const available = candidates.filter((c) => !usedMrNums.has(c.numero));
        const pool = available.length > 0 ? available : candidates;
        if (pool.length === 1) {
          matched = pool[0];
        } else {
          // Choisir celui dont libellé + quantité concordent le mieux
          matched = [...pool].sort((a, b) => {
            const sa =
              tokenOverlapScore(p.desc, a.libelle) +
              (Math.abs(p.qte - a.quantite) < 0.01 ? 0.5 : 0);
            const sb =
              tokenOverlapScore(p.desc, b.libelle) +
              (Math.abs(p.qte - b.quantite) < 0.01 ? 0.5 : 0);
            return sb - sa;
          })[0];
        }
      }
    }

    if (!matched) {
      // Nettoyer d'éventuelles anciennes liaisons si l'on réimporte un MR différent
      const { remarques: _oldRem, code: _oldCode, ...rest } = p;
      return rest as PosteMarche;
    }

    usedMrNums.add(matched.numero);
    linkedCount++;

    const qualiRef = extractQualiroutesRefFromChapitre(matched.chapitre);
    const nextRef = p.ref || qualiRef || undefined;
    if (!p.ref && qualiRef) {
      enrichedRefCount++;
    }
    if (matched.remarques) {
      enrichedRemarksCount++;
    }

    return {
      ...p,
      ...(nextRef ? { ref: nextRef } : {}),
      ...(matched.code ? { code: matched.code } : {}),
      ...(matched.remarques ? { remarques: matched.remarques } : {}),
    };
  });

  return {
    marche3P: updated,
    linkedCount,
    enrichedRemarksCount,
    enrichedRefCount,
  };
}

export interface RapprochementDiffItem {
  poste3P: PosteMarche;
  mrPoste: MetreRecapPoste;
  qtyDiffers: boolean;
  unitDiffers: boolean;
}

export interface Rapprochement3PMRReport {
  matchedCount: number;
  unmatched3P: PosteMarche[];
  unmatchedMR: MetreRecapPoste[];
  diffs: RapprochementDiffItem[];
}

function normUnit(u: string): string {
  const s = NRM(u)
    .replace(/³/g, '3')
    .replace(/²/g, '2')
    .replace(/\./g, '')
    .replace(/\s+/g, '');
  if (s === 'pce' || s === 'pces' || s === 'piece' || s === 'pieces' || s === 'u' || s === 'pc') {
    return 'p';
  }
  if (s === 'ff' || s === 'forf' || s === 'forfait' || s === 'ft') return 'f';
  if (s === 'mct' || s === 'ml') return 'm';
  return s;
}

/**
 * Compare le bordereau 3P et les postes extraits du Métré Récapitulatif PDF
 * pour repérer les postes non rapprochés et les écarts de quantité ou d'unité.
 */
export function analyserRapprochement3PMR(
  marche3P: PosteMarche[],
  mrPostes: MetreRecapPoste[]
): Rapprochement3PMRReport {
  if (!marche3P.length && !mrPostes.length) {
    return { matchedCount: 0, unmatched3P: [], unmatchedMR: [], diffs: [] };
  }

  const byNumero = new Map<string, MetreRecapPoste>();
  const byCode = new Map<string, MetreRecapPoste[]>();

  for (const mr of mrPostes) {
    const numKey = mr.numero.trim().replace(/^0+(?=\d)/, '');
    if (numKey && !byNumero.has(numKey)) {
      byNumero.set(numKey, mr);
    }
    const codeKey = mr.code.trim().toUpperCase();
    if (codeKey) {
      const list = byCode.get(codeKey) || [];
      list.push(mr);
      byCode.set(codeKey, list);
    }
  }

  const usedMrNums = new Set<string>();
  const unmatched3P: PosteMarche[] = [];
  const diffs: RapprochementDiffItem[] = [];
  let matchedCount = 0;

  for (const p of marche3P) {
    const cleanId = p.id.trim();
    const numId = cleanId.replace(/^0+(?=\d)/, '');
    let matched: MetreRecapPoste | undefined = byNumero.get(numId);

    if (!matched) {
      const candidates =
        byCode.get(cleanId.toUpperCase()) ||
        (p.code ? byCode.get(p.code.trim().toUpperCase()) : undefined);

      if (candidates && candidates.length > 0) {
        const available = candidates.filter((c) => !usedMrNums.has(c.numero));
        const pool = available.length > 0 ? available : candidates;
        if (pool.length === 1) {
          matched = pool[0];
        } else {
          matched = [...pool].sort((a, b) => {
            const sa =
              tokenOverlapScore(p.desc, a.libelle) +
              (Math.abs(p.qte - a.quantite) < 0.01 ? 0.5 : 0);
            const sb =
              tokenOverlapScore(p.desc, b.libelle) +
              (Math.abs(p.qte - b.quantite) < 0.01 ? 0.5 : 0);
            return sb - sa;
          })[0];
        }
      }
    }

    if (!matched) {
      unmatched3P.push(p);
      continue;
    }

    usedMrNums.add(matched.numero);
    matchedCount++;

    const qtyDiffers = Math.abs((p.qte || 0) - (matched.quantite || 0)) > 0.005;
    const unitDiffers =
      Boolean(p.u && matched.unite) && normUnit(p.u) !== normUnit(matched.unite);

    if (qtyDiffers || unitDiffers) {
      diffs.push({
        poste3P: p,
        mrPoste: matched,
        qtyDiffers,
        unitDiffers,
      });
    }
  }

  const unmatchedMR = mrPostes.filter((mr) => !usedMrNums.has(mr.numero));

  return {
    matchedCount,
    unmatched3P,
    unmatchedMR,
    diffs,
  };
}
