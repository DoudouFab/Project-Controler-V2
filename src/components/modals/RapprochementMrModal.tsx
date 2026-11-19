import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileWarning, Scale, X } from 'lucide-react';
import { PosteMarche, MetreRecapPoste } from '../../types/project';
import { fmt } from '../../utils/calculations';
import { analyserRapprochement3PMR } from '../../utils/metreRecapParser';

interface RapprochementMrModalProps {
  marche3P: PosteMarche[];
  mrPostes: MetreRecapPoste[];
  mrFileName?: string;
  onClose: () => void;
}

type SectionTab = 'diffs' | 'unmatched3p' | 'unmatchedmr';

export const RapprochementMrModal: React.FC<RapprochementMrModalProps> = ({
  marche3P,
  mrPostes,
  mrFileName,
  onClose,
}) => {
  const report = useMemo(
    () => analyserRapprochement3PMR(marche3P, mrPostes),
    [marche3P, mrPostes]
  );

  const [tab, setTab] = useState<SectionTab>(() => {
    if (report.diffs.length > 0) return 'diffs';
    if (report.unmatched3P.length > 0) return 'unmatched3p';
    return 'unmatchedmr';
  });

  const allOk =
    report.diffs.length === 0 &&
    report.unmatched3P.length === 0 &&
    report.unmatchedMR.length === 0;

  return (
    <div
      className="no-print fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[88vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 bg-[#1e3a5f] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 text-sky-300" />
            <div>
              <div className="text-sm font-bold">Rapport de rapprochement 3P ↔ Métré Récapitulatif PDF</div>
              <div className="text-[11px] text-sky-100/80">
                {mrFileName || 'Métré Récapitulatif'} · {report.matchedCount} poste(s) apparié(s) sur {marche3P.length} postes 3P / {mrPostes.length} postes MR
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

        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab('diffs')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                tab === 'diffs'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Écarts Qté / Unité ({report.diffs.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('unmatched3p')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                tab === 'unmatched3p'
                  ? 'bg-rose-600 text-white'
                  : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <FileWarning className="w-3.5 h-3.5" />
              3P non trouvés dans MR ({report.unmatched3P.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('unmatchedmr')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                tab === 'unmatchedmr'
                  ? 'bg-sky-700 text-white'
                  : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              MR non appariés au 3P ({report.unmatchedMR.length})
            </button>
          </div>

          {allOk && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Concordance parfaite entre 3P et Métré Récapitulatif
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-xs">
          {tab === 'diffs' && (
            report.diffs.length === 0 ? (
              <div className="py-10 text-center text-slate-500">
                Aucun écart de quantité ou d’unité détecté sur les {report.matchedCount} postes rapprochés.
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                    <th className="py-2 px-2.5 text-left w-20">N°</th>
                    <th className="py-2 px-2.5 text-left">Libellé 3P</th>
                    <th className="py-2 px-2.5 text-center w-20">U. 3P</th>
                    <th className="py-2 px-2.5 text-center w-20">U. MR</th>
                    <th className="py-2 px-2.5 text-right w-24">Qté 3P</th>
                    <th className="py-2 px-2.5 text-right w-24">Qté MR</th>
                    <th className="py-2 px-2.5 text-right w-24">Diff.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {report.diffs.map((d) => (
                    <tr key={d.poste3P.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-2.5 font-mono font-bold text-sky-700 dark:text-sky-400">
                        {d.poste3P.id}
                      </td>
                      <td className="py-2 px-2.5">{d.poste3P.desc}</td>
                      <td className={`py-2 px-2.5 text-center ${d.unitDiffers ? 'font-bold text-rose-600' : ''}`}>
                        {d.poste3P.u || '—'}
                      </td>
                      <td className={`py-2 px-2.5 text-center ${d.unitDiffers ? 'font-bold text-rose-600' : ''}`}>
                        {d.mrPoste.unite || '—'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums">
                        {fmt(d.poste3P.qte, 3)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold">
                        {fmt(d.mrPoste.quantite, 3)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums font-bold text-amber-700 dark:text-amber-400">
                        {fmt(d.poste3P.qte - d.mrPoste.quantite, 3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'unmatched3p' && (
            report.unmatched3P.length === 0 ? (
              <div className="py-10 text-center text-slate-500">
                Tous les postes du bordereau 3P ont été retrouvés dans le Métré Récapitulatif.
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2 px-2.5 text-left w-20">N°</th>
                    <th className="py-2 px-2.5 text-left">Description 3P</th>
                    <th className="py-2 px-2.5 text-center w-16">Unité</th>
                    <th className="py-2 px-2.5 text-right w-24">Q. Prév.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {report.unmatched3P.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 px-2.5 font-mono font-bold">{p.id}</td>
                      <td className="py-2 px-2.5">{p.desc}</td>
                      <td className="py-2 px-2.5 text-center">{p.u}</td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums">{fmt(p.qte, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'unmatchedmr' && (
            report.unmatchedMR.length === 0 ? (
              <div className="py-10 text-center text-slate-500">
                Tous les postes du Métré Récapitulatif ont été associés au bordereau 3P.
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2 px-2.5 text-left w-20">N° MR</th>
                    <th className="py-2 px-2.5 text-left w-28">Code</th>
                    <th className="py-2 px-2.5 text-left">Libellé &amp; remarques</th>
                    <th className="py-2 px-2.5 text-center w-16">Unité</th>
                    <th className="py-2 px-2.5 text-right w-24">Quantité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {report.unmatchedMR.map((mr) => (
                    <tr key={`${mr.numero}-${mr.code}`} className="align-top">
                      <td className="py-2 px-2.5 font-mono font-bold">{mr.numero}</td>
                      <td className="py-2 px-2.5 font-mono text-[11px] text-slate-500">{mr.code || '—'}</td>
                      <td className="py-2 px-2.5">
                        <div>{mr.libelle}</div>
                        {mr.remarques && (
                          <div className="mt-1 px-2 py-1 rounded bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-line">
                            {mr.remarques}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-center">{mr.unite || '—'}</td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums">{fmt(mr.quantite, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
};
