import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, Search } from 'lucide-react';
import { ProjectData } from '../types/project';
import { extraireQtesCochees, extraireQtesTotales, fmt, mnt, NRM, srcP } from '../utils/calculations';
import { exportCumulExcel } from '../utils/excelExports';
import { PrintHeader } from './PrintHeader';
import { StickyTable } from './StickyTable';

interface Tab6CumulProps {
  appData: ProjectData;
  onUpdateData?: (updater: (prev: ProjectData) => ProjectData) => void;
  onNotify?: (type: 'success' | 'warning' | 'error' | 'info', text: string) => void;
  onOpenQualiroutes?: (ref?: string, desc?: string) => void;
}

type FilterMode = 'tous' | 'depassement' | 'dep10' | 'dep10_1000' | 'dep10_ou_1000' | 'masquer0';

export const Tab6Cumul: React.FC<Tab6CumulProps> = ({
  appData,
  onUpdateData,
  onNotify,
  onOpenQualiroutes,
}) => {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('tous');
  const [pctSort, setPctSort] = useState<'none' | 'desc' | 'asc'>('none');
  const [justifDrafts, setJustifDrafts] = useState<Record<string, string>>({});

  const [cols, setCols] = useState({
    qteM: true,
    budget: true,
    qteAvant: true,
    qteEA: true,
    sommeEA: true,
    qteCumul: true,
    reel: true,
    solde: true,
    pct: true,
    ecart: true,
    justification: true,
  });

  const allPostes = useMemo(() => srcP(appData), [appData]);
  const qTot = useMemo(() => extraireQtesTotales(appData), [appData]);
  const qCoch = useMemo(() => extraireQtesCochees(appData), [appData]);

  const rows = useMemo(() => {
    return allPostes.map((p) => {
      const qCumul = qTot.get(p.id) || 0;
      const qEA = qCoch.get(p.id) || 0;
      const qAvant = qCumul - qEA;
      const solde = p.qte - qCumul;
      const mBudget = mnt(p.qte, p.pu);
      const mReel = mnt(qCumul, p.pu);
      const mEA = mnt(qEA, p.pu);
      const ecart = mReel - mBudget;
      const pct = p.qte > 0 ? (qCumul / p.qte) * 100 : qCumul > 0 ? 999 : 0;
      return {
        p,
        qAvant,
        qEA,
        qCumul,
        solde,
        mBudget,
        mReel,
        mEA,
        ecart,
        pct,
      };
    });
  }, [allPostes, qTot, qCoch]);

  const filteredRows = useMemo(() => {
    const q = NRM(search);
    const filtered = rows.filter((r) => {
      const matchSearch =
        !q ||
        NRM(r.p.id).includes(q) ||
        NRM(r.p.code || '').includes(q) ||
        NRM(r.p.desc).includes(q) ||
        NRM(r.p.remarques || '').includes(q);
      if (!matchSearch) return false;
      if (filterMode === 'depassement') return r.pct > 100;
      if (filterMode === 'dep10') return r.pct > 110;
      if (filterMode === 'dep10_1000') return r.pct > 110 && r.ecart > 1000;
      if (filterMode === 'dep10_ou_1000') return r.pct > 110 || r.ecart > 1000;
      if (filterMode === 'masquer0') return r.qCumul !== 0;
      return true;
    });
    if (pctSort === 'desc') {
      return [...filtered].sort((a, b) => b.pct - a.pct);
    }
    if (pctSort === 'asc') {
      return [...filtered].sort((a, b) => a.pct - b.pct);
    }
    return filtered;
  }, [rows, search, filterMode, pctSort]);

  const totals = useMemo(() => {
    let tBudget = 0;
    let tReel = 0;
    let tEA = 0;
    rows.forEach((r) => {
      tBudget += r.mBudget;
      tReel += r.mReel;
      tEA += r.mEA;
    });
    const tEcart = tReel - tBudget;
    const tPct = tBudget > 0 ? Math.round((tReel / tBudget) * 10000) / 100 : 0;
    return { tBudget, tReel, tEA, tEcart, tPct };
  }, [rows]);

  const toggleCol = (key: keyof typeof cols) =>
    setCols((prev) => ({ ...prev, [key]: !prev[key] }));

  const commitJustification = (posteId: string, rawVal: string) => {
    const clean = rawVal.trim();
    setJustifDrafts((prev) => {
      const n = { ...prev };
      delete n[posteId];
      return n;
    });
    const current = appData.justificationsCumul?.[posteId] || '';
    if (clean === current || !onUpdateData) return;
    onUpdateData((prev) => {
      const next = { ...(prev.justificationsCumul || {}) };
      if (clean) next[posteId] = clean;
      else delete next[posteId];
      return {
        ...prev,
        justificationsCumul: next,
      };
    });
  };

  return (
    <div className="space-y-4">
      <PrintHeader infos={appData.infosAdministratives} />

      {/* Filtres & colonnes */}
      <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher N° poste ou libellé..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {filteredRows.length} ligne(s) affichée(s) sur {rows.length}
            </span>
            <button
              type="button"
              disabled={filteredRows.length === 0}
              onClick={() => {
                exportCumulExcel(appData, filteredRows, cols.justification);
                onNotify?.('success', `Export Excel Cumul généré (${filteredRows.length} postes).`);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-40 text-emerald-800 dark:text-emerald-300 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
            </button>
          </div>
        </div>

        {/* Radio filtres */}
        <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-200 dark:border-slate-800">
          {(
            [
              ['tous', 'Tous les postes'],
              ['depassement', 'Dépassement (> 100%)'],
              ['dep10', 'Dépassement > 110%'],
              ['dep10_1000', '> 110% ET écart > 1 000 €'],
              ['dep10_ou_1000', '> 110% OU écart > 1 000 €'],
              ['masquer0', 'Masquer qté = 0'],
            ] as const
          ).map(([val, lbl]) => (
            <label key={val} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="t6-filter"
                checked={filterMode === val}
                onChange={() => setFilterMode(val)}
              />
              <span>{lbl}</span>
            </label>
          ))}
        </div>

        {/* Colonnes visibles */}
        <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Colonnes :</span>
          {(
            [
              ['qteM', 'Q. Prév.'],
              ['budget', 'Budget (€)'],
              ['qteAvant', 'Q. Avant EA'],
              ['qteEA', 'Q. EA en cours'],
              ['sommeEA', 'Montant EA (€)'],
              ['qteCumul', 'Q. Cumulée'],
              ['reel', 'Montant Réel (€)'],
              ['solde', 'Solde Qté'],
              ['pct', '% Utilisation'],
              ['ecart', 'Écart (€)'],
              ['justification', 'Justification'],
            ] as const
          ).map(([k, lbl]) => (
            <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={cols[k]}
                onChange={() => toggleCol(k)}
              />
              <span>{lbl}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Tableau concordance */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
            Aucun poste dans le marché. Importez un bordereau 3P dans l'onglet 1.
          </div>
        ) : (
          <StickyTable>
            <table className="w-full text-xs border-collapse">
              <thead className="[&_th]:bg-slate-100 dark:[&_th]:bg-slate-800 [&_th]:border-b [&_th]:border-slate-300 dark:[&_th]:border-slate-700">
                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 px-2.5 text-left w-20">N°</th>
                  <th className="py-2 px-2.5 text-left">Description</th>
                  <th className="py-2 px-2.5 text-center w-14">U.</th>
                  {cols.qteM && <th className="py-2 px-2.5 text-right">Q. Prév.</th>}
                  {cols.budget && <th className="py-2 px-2.5 text-right">Budget (€)</th>}
                  {cols.qteAvant && <th className="py-2 px-2.5 text-right">Avant EA</th>}
                  {cols.qteEA && <th className="py-2 px-2.5 text-right">EA cours</th>}
                  {cols.sommeEA && <th className="py-2 px-2.5 text-right">Montant EA (€)</th>}
                  {cols.qteCumul && <th className="py-2 px-2.5 text-right">Cumul Qté</th>}
                  {cols.reel && <th className="py-2 px-2.5 text-right">Cumul (€)</th>}
                  {cols.solde && <th className="py-2 px-2.5 text-right">Solde Qté</th>}
                  {cols.pct && (
                    <th className="py-2 px-2.5 text-center min-w-[112px] whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          setPctSort((s) =>
                            s === 'none' ? 'desc' : s === 'desc' ? 'asc' : 'none'
                          )
                        }
                        title="Trier par pourcentage d'utilisation du poste (Q. Cumulée / Q. Prév.)"
                        className="inline-flex items-center justify-center gap-1 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
                      >
                        <span>% Utilisation</span>
                        <span className="text-[10px] opacity-75">
                          {pctSort === 'desc' ? '▼' : pctSort === 'asc' ? '▲' : '⇅'}
                        </span>
                      </button>
                    </th>
                  )}
                  {cols.ecart && <th className="py-2 px-2.5 text-right">Écart (€)</th>}
                  {cols.justification && (
                    <th className="py-2 px-2.5 text-left min-w-[180px]">Justification</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRows.map((r) => {
                  const dep10 = r.pct > 110;
                  const dep = r.pct > 100 && !dep10;
                  const rowCls = dep10
                    ? 'bg-rose-50/75 dark:bg-rose-950/30'
                    : dep
                    ? 'bg-amber-50/75 dark:bg-amber-950/25'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40';
                  return (
                    <tr key={r.p.id} className={rowCls}>
                      <td className="py-1.5 px-2.5 font-mono font-bold text-sky-700 dark:text-sky-400">
                        {r.p.id}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-800 dark:text-slate-100">
                        <div>
                          {r.p.desc}
                          {r.p.ref && onOpenQualiroutes && (
                            <button
                              type="button"
                              onClick={() => onOpenQualiroutes(r.p.ref, r.p.desc)}
                              className="no-print ml-2 inline-flex items-center px-1.5 py-0.5 rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-mono text-[10px] font-semibold cursor-pointer"
                            >
                              Réf. {r.p.ref}
                            </button>
                          )}
                        </div>
                        {r.p.remarques && (
                          <div className="no-print mt-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-950/60 text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line">
                            {r.p.remarques}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 px-2.5 text-center">{r.p.u}</td>
                      {cols.qteM && (
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                          {fmt(r.p.qte, 3)}
                        </td>
                      )}
                      {cols.budget && (
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                          {fmt(r.mBudget)} €
                        </td>
                      )}
                      {cols.qteAvant && (
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {fmt(r.qAvant, 3)}
                        </td>
                      )}
                      {cols.qteEA && (
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmt(r.qEA, 3)}
                        </td>
                      )}
                      {cols.sommeEA && (
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                          {fmt(r.mEA)} €
                        </td>
                      )}
                      {cols.qteCumul && (
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-sky-700 dark:text-sky-400 font-semibold">
                          {fmt(r.qCumul, 3)}
                        </td>
                      )}
                      {cols.reel && (
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-sky-700 dark:text-sky-400 font-bold">
                          {fmt(r.mReel)} €
                        </td>
                      )}
                      {cols.solde && (
                        <td
                          className={`py-1.5 px-2.5 text-right font-mono tabular-nums ${
                            r.solde < 0
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {fmt(r.solde, 3)}
                        </td>
                      )}
                      {cols.pct && (
                        <td
                          className="py-1.5 px-2.5 text-center font-mono tabular-nums"
                          title={
                            r.p.qte > 0
                              ? `${fmt(r.qCumul, 3)} / ${fmt(r.p.qte, 3)} ${r.p.u} (${fmt(r.pct, 1)} %)`
                              : 'Quantité prévue à 0'
                          }
                        >
                          {r.p.qte <= 0 && r.qCumul > 0 ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold whitespace-nowrap">
                              Hors prévu ⚠
                            </span>
                          ) : (
                            <div className="flex flex-col items-center gap-1 min-w-[84px]">
                              <span
                                className={
                                  dep10
                                    ? 'font-bold text-rose-700 dark:text-rose-400'
                                    : dep
                                    ? 'font-bold text-amber-700 dark:text-amber-400'
                                    : r.pct >= 90
                                    ? 'font-semibold text-amber-700 dark:text-amber-400'
                                    : r.pct > 0
                                    ? 'font-semibold text-sky-700 dark:text-sky-300'
                                    : 'text-slate-400 dark:text-slate-500'
                                }
                              >
                                {fmt(r.pct, 1)}%
                                {dep10 ? ' ⚠' : dep ? ' !' : ''}
                              </span>
                              <div className="no-print w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    dep10
                                      ? 'bg-rose-600'
                                      : dep
                                      ? 'bg-amber-500'
                                      : r.pct >= 90
                                      ? 'bg-amber-400'
                                      : 'bg-sky-600 dark:bg-sky-500'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, r.pct))}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>
                      )}
                      {cols.ecart && (
                        <td
                          className={`py-1.5 px-2.5 text-right font-mono tabular-nums font-semibold ${
                            r.ecart > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : r.ecart < 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {fmt(r.ecart)} €
                        </td>
                      )}
                      {cols.justification && (
                        <td className="py-1.5 px-2.5 align-top">
                          {(() => {
                            const savedVal = appData.justificationsCumul?.[r.p.id] || '';
                            const draftVal = justifDrafts[r.p.id] ?? savedVal;
                            const needsJustif = r.pct > 100 && !draftVal.trim();
                            return (
                              <>
                                <input
                                  type="text"
                                  value={draftVal}
                                  onChange={(e) =>
                                    setJustifDrafts((prev) => ({
                                      ...prev,
                                      [r.p.id]: e.target.value,
                                    }))
                                  }
                                  onBlur={(e) => commitJustification(r.p.id, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      commitJustification(
                                        r.p.id,
                                        (e.target as HTMLInputElement).value
                                      );
                                    }
                                  }}
                                  placeholder={needsJustif ? 'Justifier dépassement...' : 'Note...'}
                                  className={`no-print w-full min-w-[160px] px-2 py-1 text-[11px] rounded border bg-white/80 dark:bg-slate-950/70 outline-none focus:border-sky-500 ${
                                    needsJustif
                                      ? 'border-amber-300 dark:border-amber-800 placeholder:text-amber-600/70'
                                      : 'border-slate-200 dark:border-slate-700'
                                  }`}
                                />
                                <span className="hidden print:block text-[11px] whitespace-pre-wrap">
                                  {savedVal || '—'}
                                </span>
                              </>
                            );
                          })()}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold border-t border-slate-300 dark:border-slate-700">
                <tr>
                  <td colSpan={3} className="py-2.5 px-2.5 text-right">
                    TOTAL GÉNÉRAL MARCHÉ :
                  </td>
                  {cols.qteM && <td />}
                  {cols.budget && (
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                      {fmt(totals.tBudget)} €
                    </td>
                  )}
                  {cols.qteAvant && <td />}
                  {cols.qteEA && <td />}
                  {cols.sommeEA && (
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {fmt(totals.tEA)} €
                    </td>
                  )}
                  {cols.qteCumul && <td />}
                  {cols.reel && (
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-sky-700 dark:text-sky-400">
                      {fmt(totals.tReel)} €
                    </td>
                  )}
                  {cols.solde && <td />}
                  {cols.pct && (
                    <td
                      className={`py-2.5 px-2.5 text-center font-mono tabular-nums ${
                        totals.tPct > 100
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-sky-700 dark:text-sky-400'
                      }`}
                    >
                      {fmt(totals.tPct, 1)}%
                    </td>
                  )}
                  {cols.ecart && (
                    <td
                      className={`py-2.5 px-2.5 text-right font-mono tabular-nums ${
                        totals.tEcart > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {fmt(totals.tEcart)} €
                    </td>
                  )}
                  {cols.justification && <td />}
                </tr>
              </tfoot>
            </table>
          </StickyTable>
        )}
      </div>
    </div>
  );
};
