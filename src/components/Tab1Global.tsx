import React, { useMemo, useRef, useState } from 'react';
import { BookOpen, FileSpreadsheet, FileText, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { Avenant, PosteMarche, ProjectData } from '../types/project';
import {
  deriveProchainAvenantId,
  extraireQtesCochees,
  fmt,
  mnt,
  NRM,
  parserExcel3P,
} from '../utils/calculations';
import {
  analyserRapprochement3PMR,
  lierMetreRecapAuMarche3P,
  parseMetreRecapPdf,
} from '../utils/metreRecapParser';
import { RapprochementMrModal } from './modals/RapprochementMrModal';
import { PrintHeader } from './PrintHeader';

interface Tab1GlobalProps {
  appData: ProjectData;
  onUpdateData: (updater: (prev: ProjectData) => ProjectData) => void;
  onNotify: (type: 'success' | 'warning' | 'error' | 'info', text: string) => void;
  onConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
  hideBordereauPrint: boolean;
  onToggleHideBordereauPrint: (val: boolean) => void;
  onOpenQualiroutes: (ref?: string, desc?: string) => void;
}

export const Tab1Global: React.FC<Tab1GlobalProps> = ({
  appData,
  onUpdateData,
  onNotify,
  onConfirm,
  hideBordereauPrint,
  onToggleHideBordereauPrint,
  onOpenQualiroutes,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mrInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragOverMr, setDragOverMr] = useState(false);
  const [mrBusy, setMrBusy] = useState(false);
  const [mrProgress, setMrProgress] = useState(0);
  const [searchBordereau, setSearchBordereau] = useState('');
  const [onlyWithRemarks, setOnlyWithRemarks] = useState(false);
  const [showRapprochementModal, setShowRapprochementModal] = useState(false);

  // Formulaire ajout avenant / PC
  const [showAvForm, setShowAvForm] = useState<string | null>(null);
  const [avDesc, setAvDesc] = useState('');
  const [avUnite, setAvUnite] = useState('m³');
  const [avQte, setAvQte] = useState('1');
  const [avPu, setAvPu] = useState('0');

  const handleExcelFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parserExcel3P(buf, file.name);
      const currentMr = appData.mrPostes || [];
      const linkedInfo =
        currentMr.length > 0
          ? lierMetreRecapAuMarche3P(parsed.marche3P, currentMr)
          : { marche3P: parsed.marche3P, linkedCount: 0, enrichedRemarksCount: 0, enrichedRefCount: 0 };

      onUpdateData((prev) => {
        const mrPostes = prev.mrPostes || [];
        let nextMarche = parsed.marche3P;
        let nextMeta = prev.metreRecapMeta;
        if (mrPostes.length > 0) {
          const res = lierMetreRecapAuMarche3P(parsed.marche3P, mrPostes);
          nextMarche = res.marche3P;
          if (nextMeta) {
            nextMeta = {
              ...nextMeta,
              postesLies: res.linkedCount,
              postesEnrichis: res.enrichedRemarksCount,
            };
          }
        }
        return {
          ...prev,
          nomProjet: parsed.nomProjet,
          infosAdministratives: {
            ...prev.infosAdministratives,
            ...parsed.infos,
          },
          marche3P: nextMarche,
          ...(nextMeta ? { metreRecapMeta: nextMeta } : {}),
        };
      });

      const mrMsg =
        linkedInfo.linkedCount > 0
          ? ` · ${linkedInfo.enrichedRemarksCount} remarque(s) MR reliée(s)`
          : '';
      onNotify(
        'success',
        `Bordereau 3P importé : ${parsed.marche3P.length} postes chargés (${parsed.nomProjet})${mrMsg}.`
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Erreur lors de la lecture du fichier Excel 3P.'
      );
    }
  };

  const handleMetreRecapFile = async (file: File) => {
    setMrBusy(true);
    setMrProgress(2);
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseMetreRecapPdf(buf, file.name, (pct) => setMrProgress(pct));
      const postesAvecRem = parsed.postes.filter((p) => Boolean(p.remarques)).length;
      const res = lierMetreRecapAuMarche3P(appData.marche3P || [], parsed.postes);

      onUpdateData((prev) => {
        const reLinked = lierMetreRecapAuMarche3P(prev.marche3P || [], parsed.postes);
        return {
          ...prev,
          marche3P: reLinked.marche3P,
          mrPostes: parsed.postes,
          metreRecapMeta: {
            fileName: file.name,
            importedAt: new Date().toISOString(),
            totalPostes: parsed.postes.length,
            postesAvecRemarques: postesAvecRem,
            postesLies: reLinked.linkedCount,
            postesEnrichis: reLinked.enrichedRemarksCount,
          },
        };
      });

      if ((appData.marche3P || []).length === 0) {
        onNotify(
          'info',
          `Métré Récapitulatif lu (${parsed.postes.length} postes, ${postesAvecRem} avec précisions). Importez maintenant le fichier Excel 3P pour les associer automatiquement.`
        );
      } else {
        onNotify(
          'success',
          `Métré Récapitulatif lié : ${res.linkedCount}/${(appData.marche3P || []).length} postes rapprochés (${res.enrichedRemarksCount} avec remarques/détails, ${res.enrichedRefCount} réf. Qualiroutes ajoutée(s)).`
        );
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Erreur lors de l’analyse du Métré Récapitulatif PDF.'
      );
    } finally {
      setMrBusy(false);
      setMrProgress(0);
    }
  };

  const handleClearMetreRecap = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateData((prev) => ({
      ...prev,
      marche3P: (prev.marche3P || []).map(({ remarques: _r, code: _c, ...rest }) => rest),
      mrPostes: undefined,
      metreRecapMeta: undefined,
    }));
    setOnlyWithRemarks(false);
    onNotify('info', 'Remarques du Métré Récapitulatif retirées de ce dossier.');
  };

  const kpis = useMemo(() => {
    const mInitial = (appData.marche3P || []).reduce((s, p) => s + mnt(p.qte, p.pu), 0);
    const avs = (appData.avenants || []).filter((a) => a.type !== 'PC');
    const pcs = (appData.avenants || []).filter((a) => a.type === 'PC');
    const mAvenants = avs.reduce((s, a) => s + mnt(a.qte, a.pu), 0);
    const mPC = pcs.reduce((s, a) => s + mnt(a.qte, a.pu), 0);
    const mTotalRevise = mInitial + mAvenants + mPC;
    const cumulValide = (appData.historiqueEA || []).reduce((s, ea) => s + (ea.montant || 0), 0);

    const allPostes = [...(appData.marche3P || []), ...(appData.avenants || [])];
    const qtesEnCours = extraireQtesCochees(appData);
    let eaEnCours = 0;
    qtesEnCours.forEach((q, id) => {
      const p = allPostes.find((pp) => pp.id === id);
      if (p) eaEnCours += mnt(q, p.pu);
    });
    eaEnCours = Math.round(eaEnCours * 100) / 100;

    const cumulTotal = cumulValide + eaEnCours;
    const reste = mTotalRevise - cumulTotal;
    const pct = mTotalRevise > 0 ? (cumulTotal / mTotalRevise) * 100 : 0;

    return {
      mInitial,
      mAvenants,
      mPC,
      mTotalRevise,
      cumulValide,
      eaEnCours,
      reste,
      pct,
    };
  }, [appData]);

  const remarksCount3P = useMemo(
    () => (appData.marche3P || []).filter((p) => Boolean(p.remarques)).length,
    [appData.marche3P]
  );

  const mrControlCounts = useMemo(() => {
    const mr = appData.mrPostes || [];
    const p3 = appData.marche3P || [];
    if (mr.length === 0 || p3.length === 0) return null;
    const rep = analyserRapprochement3PMR(p3, mr);
    return {
      totalAlerts: rep.diffs.length + rep.unmatched3P.length + rep.unmatchedMR.length,
    };
  }, [appData.marche3P, appData.mrPostes]);

  const filtered3P = useMemo(() => {
    const q = NRM(searchBordereau);
    return (appData.marche3P || []).filter((p) => {
      if (onlyWithRemarks && !p.remarques) return false;
      if (!q) return true;
      return (
        NRM(p.id).includes(q) ||
        NRM(p.ref || '').includes(q) ||
        NRM(p.code || '').includes(q) ||
        NRM(p.desc).includes(q) ||
        NRM(p.remarques || '').includes(q) ||
        NRM(p.u).includes(q)
      );
    });
  }, [appData.marche3P, searchBordereau, onlyWithRemarks]);

  const avenantGroups = useMemo(() => {
    const types = ['AV1', 'AV2', 'AV3', 'PC'] as const;
    return types.map((t) => {
      const items = (appData.avenants || []).filter((a) => a.type === t);
      const sub = items.reduce((s, a) => s + mnt(a.qte, a.pu), 0);
      return { type: t, items, sub };
    });
  }, [appData.avenants]);

  const handleAddAvenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAvForm) return;
    if (!avDesc.trim()) {
      onNotify('warning', 'Veuillez saisir une description pour le poste.');
      return;
    }
    const q = parseFloat(avQte.replace(',', '.')) || 0;
    const pu = parseFloat(avPu.replace(',', '.')) || 0;
    const newId = deriveProchainAvenantId(appData.avenants || [], showAvForm);
    const newItem: Avenant = {
      type: showAvForm,
      id: newId,
      desc: avDesc.trim(),
      u: avUnite.trim() || 'p',
      qte: q,
      pu,
    };
    onUpdateData((prev) => ({
      ...prev,
      avenants: [...(prev.avenants || []), newItem],
    }));
    setAvDesc('');
    setAvQte('1');
    setAvPu('0');
    setShowAvForm(null);
    onNotify('success', `${newId} ajouté au bordereau.`);
  };

  const updateAdmin = (field: keyof ProjectData['infosAdministratives'], val: string) => {
    onUpdateData((prev) => ({
      ...prev,
      infosAdministratives: {
        ...prev.infosAdministratives,
        [field]: val,
      },
    }));
  };

  return (
    <div className="space-y-5">
      <PrintHeader infos={appData.infosAdministratives} />

      {/* Import Excel 3P + Métré Récapitulatif PDF + Nom projet */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleExcelFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`lg:col-span-5 border border-dashed rounded-xl p-4 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
            dragOver
              ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30'
              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-sky-400 dark:hover:border-sky-600'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Bordereau Excel 3P (.xlsx / .xls)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                Déposez le 3P pour extraire les infos administratives, prix et quantités.
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium shrink-0">
            <Upload className="w-3.5 h-3.5" /> Parcourir
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleExcelFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* Zone dépôt Métré Récapitulatif PDF */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverMr(true);
          }}
          onDragLeave={() => setDragOverMr(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverMr(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleMetreRecapFile(f);
          }}
          onClick={() => !mrBusy && mrInputRef.current?.click()}
          className={`lg:col-span-4 border border-dashed rounded-xl p-4 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
            dragOverMr
              ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30'
              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-sky-400 dark:hover:border-sky-600'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-sky-700 dark:text-sky-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Métré Récapitulatif (.pdf)
              </div>
              {mrBusy ? (
                <div className="text-[11px] text-sky-700 dark:text-sky-400 font-medium">
                  Analyse des remarques… {mrProgress}%
                </div>
              ) : appData.metreRecapMeta ? (
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400 truncate font-medium">
                  {appData.metreRecapMeta.fileName} · {appData.metreRecapMeta.postesEnrichis} remarque(s) liée(s)
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                  Lie automatiquement les cases remarques &amp; précisions aux postes 3P.
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {appData.metreRecapMeta && !mrBusy && (
              <button
                type="button"
                onClick={handleClearMetreRecap}
                title="Retirer le Métré Récapitulatif lié"
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium">
              <Upload className="w-3.5 h-3.5" /> PDF
            </span>
          </div>
          <input
            ref={mrInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleMetreRecapFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Nom du fichier / Projet
            </label>
          </div>
          <input
            type="text"
            value={appData.nomProjet}
            onChange={(e) =>
              onUpdateData((prev) => ({ ...prev, nomProjet: e.target.value }))
            }
            placeholder="Référence_Lieu"
            className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Caractéristiques générales */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Caractéristiques générales du marché
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Intitulé / Objet des travaux
            </label>
            <input
              type="text"
              value={appData.infosAdministratives.intitule}
              onChange={(e) => updateAdmin('intitule', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Référence marché
            </label>
            <input
              type="text"
              value={appData.infosAdministratives.marche}
              onChange={(e) => updateAdmin('marche', e.target.value)}
              className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Lieu des travaux
            </label>
            <input
              type="text"
              value={appData.infosAdministratives.lieu}
              onChange={(e) => updateAdmin('lieu', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Maître d'ouvrage
            </label>
            <input
              type="text"
              value={appData.infosAdministratives.mo}
              onChange={(e) => updateAdmin('mo', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Auteur de projet / Fonctionnaire dir.
            </label>
            <input
              type="text"
              value={appData.infosAdministratives.auteur}
              onChange={(e) => updateAdmin('auteur', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Adjudicataire / Entrepreneur
            </label>
            <input
              type="text"
              value={appData.infosAdministratives.entrepreneur}
              onChange={(e) => updateAdmin('entrepreneur', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Contrôleur responsable
            </label>
            <input
              type="text"
              value={appData.infosAdministratives.controleur}
              onChange={(e) => updateAdmin('controleur', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      {/* Synthèse financière */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Synthèse financière du marché
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {(appData.marche3P || []).length} postes 3P · {(appData.avenants || []).length} avenant(s)/PC · {(appData.tronconsEgout || []).length} tronçon(s)
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Marché initial 3P', val: `${fmt(kpis.mInitial)} €`, cls: 'text-slate-900 dark:text-slate-100' },
            { label: 'Avenants (AV1/2/3)', val: `${fmt(kpis.mAvenants)} €`, cls: 'text-amber-700 dark:text-amber-400' },
            { label: 'Postes Compl. (PC)', val: `${fmt(kpis.mPC)} €`, cls: 'text-amber-700 dark:text-amber-400' },
            { label: 'Marché total révisé', val: `${fmt(kpis.mTotalRevise)} €`, cls: 'text-sky-700 dark:text-sky-400' },
            { label: 'Cumul EA validés', val: `${fmt(kpis.cumulValide)} €`, cls: 'text-emerald-700 dark:text-emerald-400' },
            { label: 'EA en cours (coché)', val: `${fmt(kpis.eaEnCours)} €`, cls: 'text-sky-700 dark:text-sky-400' },
            { label: 'Reste à exécuter', val: `${fmt(kpis.reste)} €`, cls: kpis.reste < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200' },
            { label: 'Avancement global', val: `${fmt(kpis.pct, 1)} %`, cls: 'text-emerald-700 dark:text-emerald-400' },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3 py-2.5"
            >
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{k.label}</div>
              <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${k.cls}`}>
                {k.val}
              </div>
            </div>
          ))}
        </div>

        <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-600 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, kpis.pct))}%` }}
          />
        </div>
      </div>

      {/* Contrôle impression bordereau */}
      <div className="no-print flex items-center justify-between gap-3 px-1">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={!hideBordereauPrint}
            onChange={(e) => onToggleHideBordereauPrint(!e.target.checked)}
          />
          <span>Imprimer le bordereau 3P et les avenants lors de l'impression de cet onglet</span>
        </label>
      </div>

      {/* Section Avenants & PC */}
      <div
        id="section-avenants"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Avenants & Postes Complémentaires (PC)
          </h2>
          <div className="no-print flex flex-wrap gap-1.5">
            {(['AV1', 'AV2', 'AV3', 'PC'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setShowAvForm(showAvForm === t ? null : t)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3 h-3" /> {t}
              </button>
            ))}
          </div>
        </div>

        {showAvForm && (
          <form
            onSubmit={handleAddAvenant}
            className="no-print p-3 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/30 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end text-xs"
          >
            <div className="sm:col-span-6">
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                Nouveau poste {showAvForm} — Description
              </label>
              <input
                type="text"
                required
                value={avDesc}
                onChange={(e) => setAvDesc(e.target.value)}
                placeholder="Intitulé du poste complémentaire..."
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                Unité
              </label>
              <input
                type="text"
                value={avUnite}
                onChange={(e) => setAvUnite(e.target.value)}
                className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                Qté prévue
              </label>
              <input
                type="text"
                value={avQte}
                onChange={(e) => setAvQte(e.target.value)}
                className="w-full px-2 py-1.5 font-mono text-right rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                P.U. (€)
              </label>
              <input
                type="text"
                value={avPu}
                onChange={(e) => setAvPu(e.target.value)}
                className="w-full px-2 py-1.5 font-mono text-right rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="sm:col-span-1 flex gap-1">
              <button
                type="submit"
                className="w-full px-2.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold cursor-pointer"
              >
                OK
              </button>
            </div>
          </form>
        )}

        {(appData.avenants || []).length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 italic py-2">
            Aucun avenant ou poste complémentaire encodé.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 px-2.5 text-left w-24">N°</th>
                  <th className="py-2 px-2.5 text-left">Description</th>
                  <th className="py-2 px-2.5 text-center w-16">Unité</th>
                  <th className="py-2 px-2.5 text-right w-24">Q. Prév.</th>
                  <th className="py-2 px-2.5 text-right w-24">P.U. (€)</th>
                  <th className="py-2 px-2.5 text-right w-28">Montant (€)</th>
                  <th className="no-print py-2 px-2 text-center w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {avenantGroups.map((grp) =>
                  grp.items.length === 0 ? null : (
                    <React.Fragment key={grp.type}>
                      {grp.items.map((a) => (
                        <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-1.5 px-2.5 font-mono font-semibold text-amber-700 dark:text-amber-400">
                            {a.id}
                          </td>
                          <td className="py-1.5 px-2.5 text-slate-800 dark:text-slate-100">
                            {a.desc}
                          </td>
                          <td className="py-1.5 px-2.5 text-center">{a.u}</td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                            {fmt(a.qte, 3)}
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                            {fmt(a.pu)}
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-semibold">
                            {fmt(mnt(a.qte, a.pu))}
                          </td>
                          <td className="no-print py-1.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                onConfirm({
                                  title: 'Supprimer ce poste complémentaire ?',
                                  message: `Voulez-vous supprimer ${a.id} (${a.desc}) ?`,
                                  danger: true,
                                  confirmLabel: 'Supprimer',
                                  onConfirm: () =>
                                    onUpdateData((prev) => ({
                                      ...prev,
                                      avenants: (prev.avenants || []).filter((x) => x.id !== a.id),
                                    })),
                                })
                              }
                              className="p-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold">
                        <td colSpan={5} className="py-1.5 px-2.5 text-right text-slate-600 dark:text-slate-300">
                          Sous-total {grp.type} :
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                          {fmt(grp.sub)} €
                        </td>
                        <td className="no-print" />
                      </tr>
                    </React.Fragment>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section Bordereau 3P */}
      <div
        id="section-bordereau"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Bordereau initial du marché 3P ({filtered3P.length} postes)
            </h2>
            {remarksCount3P > 0 && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                · {remarksCount3P} avec précisions MR
              </span>
            )}
          </div>
          <div className="no-print flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {remarksCount3P > 0 && (
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={onlyWithRemarks}
                  onChange={(e) => setOnlyWithRemarks(e.target.checked)}
                />
                <span>Avec remarques MR</span>
              </label>
            )}
            {mrControlCounts !== null && (
              <button
                type="button"
                onClick={() => setShowRapprochementModal(true)}
                title="Comparer les quantités, unités et postes entre le 3P Excel et le Métré Récapitulatif PDF"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  mrControlCounts.totalAlerts > 0
                    ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 text-amber-800 dark:text-amber-300'
                    : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-300'
                }`}
              >
                Contrôle 3P ↔ MR ({mrControlCounts.totalAlerts > 0 ? `${mrControlCounts.totalAlerts} écart(s)` : 'OK'})
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenQualiroutes('', '')}
              title="Référentiel global de l'application (enregistré une seule fois pour tous les dossiers)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/50 text-sky-800 dark:text-sky-300 text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5" /> Qualiroutes
            </button>
            <div className="relative flex-1 sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchBordereau}
                onChange={(e) => setSearchBordereau(e.target.value)}
                placeholder="Rechercher un poste (N°, Réf., remarque)..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>
        </div>

        {(appData.marche3P || []).length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
            Importez un fichier Excel 3P ci-dessus ou chargez un projet (.json) pour afficher le bordereau.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[540px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-2.5 text-left w-20">N°</th>
                  <th className="py-2 px-2.5 text-left w-28">Réf.</th>
                  <th className="py-2 px-2.5 text-left">Description &amp; Précisions MR</th>
                  <th className="py-2 px-2.5 text-center w-16">Unité</th>
                  <th className="py-2 px-2.5 text-right w-24">Q. Prév.</th>
                  <th className="py-2 px-2.5 text-right w-24">P.U. (€)</th>
                  <th className="py-2 px-2.5 text-right w-28">Montant (€)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filtered3P.map((p: PosteMarche) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top"
                  >
                    <td className="py-1.5 px-2.5 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {p.id}
                    </td>
                    <td className="py-1.5 px-2.5 font-mono text-[11px]">
                      <div className="flex flex-col items-start gap-0.5">
                        {p.ref ? (
                          <button
                            type="button"
                            onClick={() => onOpenQualiroutes(p.ref, p.desc)}
                            title={`Consulter l'article ${p.ref} dans Qualiroutes`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/50 font-semibold cursor-pointer"
                          >
                            {p.ref}
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {p.code && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            {p.code}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2.5 text-slate-700 dark:text-slate-200">
                      <div>{p.desc}</div>
                      {p.remarques && (
                        <div className="mt-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-950/60 text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                          {p.remarques}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2.5 text-center text-slate-600 dark:text-slate-300">
                      {p.u}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                      {fmt(p.qte, 3)}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">
                      {fmt(p.pu)}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-semibold">
                      {fmt(mnt(p.qte, p.pu))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 dark:bg-slate-800 font-bold border-t border-slate-300 dark:border-slate-700">
                <tr>
                  <td colSpan={6} className="py-2 px-2.5 text-right">
                    TOTAL BORDEREAU 3P INITIAL :
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono tabular-nums">
                    {fmt(kpis.mInitial)} €
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {showRapprochementModal && appData.mrPostes && appData.mrPostes.length > 0 && (
        <RapprochementMrModal
          marche3P={appData.marche3P || []}
          mrPostes={appData.mrPostes}
          mrFileName={appData.metreRecapMeta?.fileName}
          onClose={() => setShowRapprochementModal(false)}
        />
      )}
    </div>
  );
};
