import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  AccessUserDoc,
  ADMIN_EMAIL,
  getDb,
  handleFirestoreError,
  normalizeEmail,
  normalizeEmailId,
  OperationType,
  PreauthorizedEmailDoc,
  translateFirebaseErrorFr,
} from '../firebase';

interface Tab8AccesProps {
  currentUser: User;
  onNotify: (type: 'success' | 'warning' | 'error' | 'info', text: string) => void;
  onConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
}

function generateRandom6Digits(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const Tab8Acces: React.FC<Tab8AccesProps> = ({
  currentUser,
  onNotify,
  onConfirm,
}) => {
  const [preauthorized, setPreauthorized] = useState<PreauthorizedEmailDoc[]>([]);
  const [accessUsers, setAccessUsers] = useState<AccessUserDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Formulaire ajout / mise à jour préautorisation
  const [formEmail, setFormEmail] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formNote, setFormNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Édition rapide code/note
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editNote, setEditNote] = useState('');

  const loadAllLists = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const db = await getDb();
      let preSnap;
      try {
        preSnap = await getDocsFromServer(collection(db, 'preauthorized_emails'));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'preauthorized_emails');
      }

      let usersSnap;
      try {
        usersSnap = await getDocsFromServer(collection(db, 'access_users'));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'access_users');
      }

      const preList = preSnap.docs
        .map((d) => d.data() as PreauthorizedEmailDoc)
        .sort((a, b) => a.email.localeCompare(b.email, 'fr'));
      const usersList = usersSnap.docs
        .map((d) => d.data() as AccessUserDoc)
        .sort((a, b) => a.email.localeCompare(b.email, 'fr'));

      setPreauthorized(preList);
      setAccessUsers(usersList);
      setHasLoaded(true);
    } catch (err) {
      setLoadError(translateFirebaseErrorFr(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Chargement à la demande uniquement à l'ouverture de l'onglet Accès
  useEffect(() => {
    if (!hasLoaded && !loading) {
      void loadAllLists();
    }
  }, [hasLoaded, loading, loadAllLists]);

  const handleSavePreauthorized = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = normalizeEmail(formEmail);
    const cleanCode = formCode.trim();
    const cleanNote = formNote.trim().slice(0, 200);

    if (!cleanEmail || !cleanEmail.includes('@')) {
      onNotify('warning', 'Veuillez saisir une adresse e-mail valide.');
      return;
    }
    if (cleanCode.length < 3 || cleanCode.length > 32) {
      onNotify('warning', 'Le code personnel doit contenir entre 3 et 32 caractères.');
      return;
    }

    setSaving(true);
    const emailId = normalizeEmailId(cleanEmail);
    const existingPre = preauthorized.find((p) => p.id === emailId);

    try {
      const db = await getDb();
      if (existingPre) {
        try {
          await updateDoc(doc(db, 'preauthorized_emails', emailId), {
            accessCode: cleanCode,
            note: cleanNote,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `preauthorized_emails/${emailId}`);
        }
      } else {
        try {
          await setDoc(doc(db, 'preauthorized_emails', emailId), {
            id: emailId,
            email: cleanEmail,
            accessCode: cleanCode,
            note: cleanNote,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `preauthorized_emails/${emailId}`);
        }
      }

      // Si un collègue avait déjà une demande pending ou revoked avec cet e-mail -> passage direct en approved
      const matchingUsers = accessUsers.filter(
        (u) => normalizeEmail(u.email) === cleanEmail && u.role !== 'admin'
      );
      for (const u of matchingUsers) {
        if (u.status === 'pending' || u.status === 'revoked' || u.note !== cleanNote) {
          try {
            await updateDoc(doc(db, 'access_users', u.uid), {
              status: 'approved',
              note: cleanNote,
              activationCode: cleanCode,
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `access_users/${u.uid}`);
          }
        }
      }

      setFormEmail('');
      setFormCode('');
      setFormNote('');
      onNotify('success', `Accès enregistré pour ${cleanEmail} (code : ${cleanCode}).`);
      await loadAllLists();
    } catch (err) {
      onNotify('error', translateFirebaseErrorFr(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCopyInvite = async (entry: PreauthorizedEmailDoc) => {
    const appUrl = `${window.location.origin}${window.location.pathname}`;
    const txt = [
      `Accès ProjectController — INASEP`,
      `Lien : ${appUrl}`,
      `E-mail autorisé : ${entry.email}`,
      `Code personnel : ${entry.accessCode}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      onNotify('success', `Coordonnées copiées pour ${entry.email}.`);
    } catch {
      onNotify('warning', 'Impossible d’accéder au presse-papiers du navigateur.');
    }
  };

  const handleSaveInlineCode = async (entry: PreauthorizedEmailDoc) => {
    const cleanCode = editCode.trim();
    const cleanNote = editNote.trim().slice(0, 200);
    if (cleanCode.length < 3 || cleanCode.length > 32) {
      onNotify('warning', 'Le code personnel doit contenir entre 3 et 32 caractères.');
      return;
    }
    try {
      const db = await getDb();
      await updateDoc(doc(db, 'preauthorized_emails', entry.id), {
        accessCode: cleanCode,
        note: cleanNote,
        updatedAt: serverTimestamp(),
      });
      setEditingEmailId(null);
      onNotify('success', `Code mis à jour pour ${entry.email}.`);
      await loadAllLists();
    } catch (err) {
      onNotify('error', translateFirebaseErrorFr(err));
    }
  };

  const handleDeletePreauthorized = (entry: PreauthorizedEmailDoc) => {
    const linkedUsers = accessUsers.filter(
      (u) => normalizeEmail(u.email) === normalizeEmail(entry.email) && u.role !== 'admin'
    );
    onConfirm({
      title: `Supprimer l’accès de ${entry.email} ?`,
      message:
        `Cette action supprime l’e-mail préautorisé ainsi que ${linkedUsers.length} fiche(s) appareil associée(s) pour couper l’accès immédiatement.`,
      confirmLabel: 'Supprimer immédiatement',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            const db = await getDb();
            try {
              await deleteDoc(doc(db, 'preauthorized_emails', entry.id));
            } catch (err) {
              handleFirestoreError(err, OperationType.DELETE, `preauthorized_emails/${entry.id}`);
            }
            for (const u of linkedUsers) {
              try {
                await deleteDoc(doc(db, 'access_users', u.uid));
              } catch (err) {
                handleFirestoreError(err, OperationType.DELETE, `access_users/${u.uid}`);
              }
            }
            onNotify('success', `Accès supprimé pour ${entry.email}.`);
            await loadAllLists();
          } catch (err) {
            onNotify('error', translateFirebaseErrorFr(err));
          }
        })();
      },
    });
  };

  const handleSetUserStatus = async (u: AccessUserDoc, status: 'approved' | 'revoked') => {
    try {
      const db = await getDb();
      await updateDoc(doc(db, 'access_users', u.uid), {
        status,
        updatedAt: serverTimestamp(),
      });
      onNotify(
        'success',
        status === 'approved'
          ? `Appareil autorisé pour ${u.email}.`
          : `Accès révoqué pour ${u.email}.`
      );
      await loadAllLists();
    } catch (err) {
      onNotify('error', translateFirebaseErrorFr(err));
    }
  };

  const handleDeleteUserDoc = (u: AccessUserDoc) => {
    onConfirm({
      title: `Supprimer la fiche appareil de ${u.email} ?`,
      message: `Appareil : ${u.deviceHint || 'Inconnu'}. L’utilisateur devra se reconnecter et réactiver son appareil.`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            const db = await getDb();
            await deleteDoc(doc(db, 'access_users', u.uid));
            onNotify('success', `Fiche appareil supprimée pour ${u.email}.`);
            await loadAllLists();
          } catch (err) {
            onNotify('error', translateFirebaseErrorFr(err));
          }
        })();
      },
    });
  };

  const preEmailsSet = useMemo(
    () => new Set(preauthorized.map((p) => normalizeEmail(p.email))),
    [preauthorized]
  );

  const pendingRequests = useMemo(
    () =>
      accessUsers.filter(
        (u) => normalizeEmail(u.email) !== ADMIN_EMAIL && u.status === 'pending'
      ),
    [accessUsers]
  );

  const otherDevices = useMemo(
    () =>
      accessUsers.filter(
        (u) =>
          normalizeEmail(u.email) !== ADMIN_EMAIL &&
          u.status !== 'pending' &&
          (u.status === 'revoked' || !preEmailsSet.has(normalizeEmail(u.email)))
      ),
    [accessUsers, preEmailsSet]
  );

  return (
    <div className="space-y-5">
      {/* En-tête + bouton actualiser */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <h2 className="text-sm font-bold">Gestion des accès collègues (Admin)</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Administrateur unique : <span className="font-mono">{ADMIN_EMAIL}</span> · Lecture Firestore à la demande uniquement (0 lecture au démarrage).
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadAllLists()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {loadError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
          {loadError}
        </div>
      )}

      {/* Formulaire encodage manuel */}
      <form
        onSubmit={handleSavePreauthorized}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
      >
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Autoriser un collègue (e-mail + code personnel)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs">
          <div className="md:col-span-4">
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Adresse e-mail (Google ou pro @inasep.be)
            </label>
            <input
              type="email"
              required
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              placeholder="collegue@inasep.be"
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Code personnel (3 à 32 car.)
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                required
                minLength={3}
                maxLength={32}
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="ex. 482910"
                className="w-full px-2.5 py-1.5 font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={() => setFormCode(generateRandom6Digits())}
                title="Générer un code aléatoire à 6 chiffres"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold whitespace-nowrap cursor-pointer inline-flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-amber-600" /> Générer
              </button>
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Note / Nom / Équipe (optionnel)
            </label>
            <input
              type="text"
              maxLength={200}
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="ex. Marc D. — Travaux Namur"
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full py-1.5 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </form>

      {/* Liste « Accès configurés » */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Accès configurés ({preauthorized.length})
          </h3>
        </div>

        {preauthorized.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 italic">
            Aucun e-mail préautorisé enregistré pour le moment.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 px-3 text-left">E-mail</th>
                  <th className="py-2 px-3 text-left">Statut appareil</th>
                  <th className="py-2 px-3 text-left">Code personnel</th>
                  <th className="py-2 px-3 text-left">Note</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {preauthorized.map((entry) => {
                  const connectedDevices = accessUsers.filter(
                    (u) =>
                      normalizeEmail(u.email) === normalizeEmail(entry.email) &&
                      u.status === 'approved'
                  );
                  const isEditing = editingEmailId === entry.id;

                  return (
                    <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                        {entry.email}
                      </td>
                      <td className="py-2 px-3">
                        {connectedDevices.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {connectedDevices.map((dev) => (
                              <span
                                key={dev.uid}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-semibold w-fit"
                              >
                                <Check className="w-3 h-3" />
                                Connecté ({dev.deviceHint || 'Appareil'})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 font-medium">
                            En attente de 1re connexion
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-sky-700 dark:text-sky-400">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editCode}
                              onChange={(e) => setEditCode(e.target.value)}
                              maxLength={32}
                              className="w-28 px-2 py-1 text-xs font-mono rounded border border-sky-400 bg-white dark:bg-slate-950"
                            />
                            <button
                              type="button"
                              onClick={() => setEditCode(generateRandom6Digits())}
                              className="px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-[10px] cursor-pointer"
                            >
                              6c
                            </button>
                          </div>
                        ) : (
                          entry.accessCode
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            maxLength={200}
                            className="w-full px-2 py-1 text-xs rounded border border-sky-400 bg-white dark:bg-slate-950"
                          />
                        ) : (
                          entry.note || '—'
                        )}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleSaveInlineCode(entry)}
                                className="px-2 py-1 rounded bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Sauver
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingEmailId(null)}
                                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] cursor-pointer"
                              >
                                Annuler
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleCopyInvite(entry)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium cursor-pointer"
                                title="Copier l'e-mail, le code et le lien"
                              >
                                <Copy className="w-3 h-3" /> Copier
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingEmailId(entry.id);
                                  setEditCode(entry.accessCode);
                                  setEditNote(entry.note || '');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium cursor-pointer"
                                title="Modifier le code personnel ou la note"
                              >
                                <KeyRound className="w-3 h-3" /> Code
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePreauthorized(entry)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[11px] font-medium cursor-pointer"
                                title="Supprimer l'accès et déconnecter tous ses appareils"
                              >
                                <Trash2 className="w-3 h-3" /> Supprimer
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section conditionnelle : Demandes en attente sans code */}
      {pendingRequests.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Demandes en attente sans code ({pendingRequests.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {pendingRequests.map((u) => (
              <div
                key={u.uid}
                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {u.email}
                  </span>
                  {u.displayName && (
                    <span className="ml-2 text-slate-500">({u.displayName})</span>
                  )}
                  <span className="ml-2 text-[11px] text-slate-500 font-mono">
                    · {u.deviceHint || 'Appareil'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSetUserStatus(u, 'approved')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Autoriser
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSetUserStatus(u, 'revoked')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold cursor-pointer"
                  >
                    <UserX className="w-3.5 h-3.5" /> Refuser
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section conditionnelle : Autres appareils enregistrés */}
      {otherDevices.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Autres appareils enregistrés ({otherDevices.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {otherDevices.map((u) => (
              <div
                key={u.uid}
                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {u.email}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {u.deviceHint || 'Appareil'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      u.status === 'approved'
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                        : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {u.status === 'approved' ? 'Approuvé' : 'Révoqué'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {u.status === 'approved' ? (
                    <button
                      type="button"
                      onClick={() => void handleSetUserStatus(u, 'revoked')}
                      className="px-2.5 py-1 rounded border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 font-semibold cursor-pointer"
                    >
                      Révoquer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSetUserStatus(u, 'approved')}
                      className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold cursor-pointer"
                    >
                      Réactiver
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteUserDoc(u)}
                    className="px-2.5 py-1 rounded border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold cursor-pointer"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rappel configuration Firebase Console */}
      <div className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs text-slate-600 dark:text-slate-400 space-y-1">
        <div className="font-bold text-slate-800 dark:text-slate-200">
          Rappel Firebase Console (Authentication)
        </div>
        <p>
          Pensez à activer les fournisseurs <strong>Google</strong> et <strong>Adresse e-mail / Mot de passe</strong> dans{' '}
          <em>Firebase Console → Authentication → Sign-in method</em>, et à ajouter vos domaines de déploiement (ex. GitHub Pages) dans{' '}
          <em>Authentication → Settings → Authorized domains</em>.
        </p>
      </div>
    </div>
  );
};
