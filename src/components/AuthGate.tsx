import React, { useCallback, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import {
  AccessUserDoc,
  auth,
  clearCachedApproval,
  db,
  detectDeviceHint,
  handleFirestoreError,
  isAdminUser,
  isColleagueEmailVerified,
  isOfflineFirebaseError,
  isQuotaExceededError,
  normalizeEmail,
  normalizeEmailId,
  OperationType,
  PreauthorizedEmailDoc,
  readCachedApproval,
  saveCachedApproval,
  translateFirebaseErrorFr,
} from '../firebase';

export interface AuthSession {
  user: User;
  isAdmin: boolean;
  offlineMode: boolean;
  status: 'approved';
}

interface AuthGateProps {
  children: (session: AuthSession, onSignOut: () => Promise<void>) => React.ReactNode;
}

type GateStage =
  | { kind: 'booting' }
  | { kind: 'login' }
  | { kind: 'verify_email'; user: User }
  | { kind: 'checking_access'; user: User }
  | { kind: 'enter_code'; user: User; accessDoc: AccessUserDoc | null }
  | { kind: 'pending'; user: User; accessDoc: AccessUserDoc }
  | { kind: 'revoked'; user: User }
  | { kind: 'offline_blocked'; user: User; reason: string }
  | { kind: 'quota_blocked'; user: User; reason: string }
  | { kind: 'ready'; session: AuthSession };

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [stage, setStage] = useState<GateStage>({ kind: 'booting' });

  // Login tabs & forms
  const [loginTab, setLoginTab] = useState<'google' | 'email'>('google');
  const [emailMode, setEmailMode] = useState<'signup' | 'signin'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);

  // Code activation state
  const [personalCode, setPersonalCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const checkUserAccess = useCallback(async (user: User, isManualRefresh = false) => {
    const emailLower = normalizeEmail(user.email);

    // 1. Administrateur unique : accès direct immédiat avec 0 lecture Firestore
    if (isAdminUser(user)) {
      saveCachedApproval({
        uid: user.uid,
        email: emailLower,
        role: 'admin',
        status: 'approved',
        displayName: user.displayName || 'F. Pirquin',
        cachedAt: new Date().toISOString(),
      });
      setStage({
        kind: 'ready',
        session: { user, isAdmin: true, offlineMode: !navigator.onLine, status: 'approved' },
      });
      return;
    }

    // 2. E-mail pro non vérifié : bloquer avant toute lecture Firestore
    if (!isColleagueEmailVerified(user)) {
      setStage({ kind: 'verify_email', user });
      return;
    }

    // 3. Si déjà approuvé dans le cache local et hors-ligne au démarrage (pas de refresh manuel)
    const cached = readCachedApproval(user.uid, emailLower);
    if (cached && typeof navigator !== 'undefined' && navigator.onLine === false && !isManualRefresh) {
      setStage({
        kind: 'ready',
        session: { user, isAdmin: false, offlineMode: true, status: 'approved' },
      });
      return;
    }

    setStage({ kind: 'checking_access', user });
    const path = `access_users/${user.uid}`;

    try {
      const snap = await new Promise<Awaited<ReturnType<typeof getDocFromServer>>>(
        (resolve, reject) => {
          const timer = window.setTimeout(() => {
            reject(new Error('unavailable: délai de connexion dépassé'));
          }, 6000);
          getDocFromServer(doc(db, 'access_users', user.uid))
            .then((res) => {
              window.clearTimeout(timer);
              resolve(res);
            })
            .catch((e) => {
              window.clearTimeout(timer);
              reject(e);
            });
        }
      );
      if (!snap.exists()) {
        clearCachedApproval();
        setStage({ kind: 'enter_code', user, accessDoc: null });
        return;
      }

      const data = snap.data() as AccessUserDoc;

      if (data.status === 'revoked') {
        clearCachedApproval();
        setStage({ kind: 'revoked', user });
        return;
      }

      if (data.status === 'approved') {
        const curName = (user.displayName || data.displayName || '').slice(0, 120);
        const curDevice = detectDeviceHint();
        // Écrire uniquement si displayName ou deviceHint a réellement changé
        if (data.displayName !== curName || data.deviceHint !== curDevice) {
          try {
            await updateDoc(doc(db, 'access_users', user.uid), {
              displayName: curName,
              deviceHint: curDevice,
              updatedAt: serverTimestamp(),
            });
          } catch {
            // Ne pas bloquer l'accès si cette synchronisation mineure échoue
          }
        }
        saveCachedApproval({
          uid: user.uid,
          email: emailLower,
          role: 'user',
          status: 'approved',
          displayName: curName,
          cachedAt: new Date().toISOString(),
        });
        setStage({
          kind: 'ready',
          session: { user, isAdmin: false, offlineMode: false, status: 'approved' },
        });
        return;
      }

      // Statut 'pending'
      clearCachedApproval();
      setStage({ kind: 'pending', user, accessDoc: data });
    } catch (err) {
      if (isOfflineFirebaseError(err)) {
        if (cached) {
          setStage({
            kind: 'ready',
            session: { user, isAdmin: false, offlineMode: true, status: 'approved' },
          });
          return;
        }
        setStage({
          kind: 'offline_blocked',
          user,
          reason:
            'Première connexion impossible sans accès Internet. Connectez-vous au réseau pour activer cet appareil, puis cliquez sur « Réessayer ».',
        });
        return;
      }

      if (isQuotaExceededError(err)) {
        if (cached) {
          setStage({
            kind: 'ready',
            session: { user, isAdmin: false, offlineMode: true, status: 'approved' },
          });
          return;
        }
        setStage({
          kind: 'quota_blocked',
          user,
          reason: translateFirebaseErrorFr(err),
        });
        return;
      }

      // Journaliser selon le format FirestoreErrorInfo puis afficher message clair
      try {
        handleFirestoreError(err, OperationType.GET, path);
      } catch {
        setStage({
          kind: 'offline_blocked',
          user,
          reason: translateFirebaseErrorFr(err),
        });
      }
    }
  }, []);

  useEffect(() => {
    let settled = false;
    const bootTimer = window.setTimeout(() => {
      if (settled) return;
      if (auth.currentUser) {
        settled = true;
        void checkUserAccess(auth.currentUser, false);
      } else {
        settled = true;
        setStage({ kind: 'login' });
      }
    }, 4000);

    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        settled = true;
        window.clearTimeout(bootTimer);
        setAuthError(null);
        setAuthInfo(null);
        setCodeError(null);
        if (!user) {
          setStage({ kind: 'login' });
          return;
        }
        void checkUserAccess(user, false);
      },
      () => {
        settled = true;
        window.clearTimeout(bootTimer);
        setStage({ kind: 'login' });
      }
    );
    return () => {
      window.clearTimeout(bootTimer);
      unsub();
    };
  }, [checkUserAccess]);

  const handleSignOut = async () => {
    clearCachedApproval();
    await signOut(auth);
    setPersonalCode('');
    setPassword('');
    setAuthError(null);
    setAuthInfo(null);
    setCodeError(null);
    setStage({ kind: 'login' });
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      setAuthError(translateFirebaseErrorFr(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setAuthError('Veuillez saisir votre adresse e-mail professionnelle.');
      return;
    }
    if (password.length < 6) {
      setAuthError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      if (emailMode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await sendEmailVerification(cred.user);
        setAuthInfo('Compte créé. Un e-mail de confirmation vient de vous être envoyé.');
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      }
    } catch (err) {
      setAuthError(translateFirebaseErrorFr(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setAuthError('Saisissez d’abord votre adresse e-mail ci-dessus pour réinitialiser le mot de passe.');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setAuthInfo(`Un lien de réinitialisation a été envoyé à ${cleanEmail}.`);
    } catch (err) {
      setAuthError(translateFirebaseErrorFr(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCheckEmailVerified = async (user: User) => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      await user.reload();
      const reloaded = auth.currentUser || user;
      if (isColleagueEmailVerified(reloaded)) {
        await checkUserAccess(reloaded, true);
      } else {
        setAuthError(
          'Votre adresse e-mail n’apparaît pas encore comme confirmée. Cliquez sur le lien reçu par e-mail (pensez aux courriers indésirables), puis réessayez.'
        );
      }
    } catch (err) {
      setAuthError(translateFirebaseErrorFr(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleResendVerification = async (user: User) => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthInfo(null);
    try {
      await sendEmailVerification(user);
      setAuthInfo(`E-mail de confirmation renvoyé à ${user.email}.`);
    } catch (err) {
      setAuthError(translateFirebaseErrorFr(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleActivateWithCode = async (user: User, existingDoc: AccessUserDoc | null) => {
    const codeClean = personalCode.trim();
    if (codeClean.length < 3 || codeClean.length > 32) {
      setCodeError('Saisissez votre code personnel (entre 3 et 32 caractères).');
      return;
    }

    setCodeBusy(true);
    setCodeError(null);

    const emailLower = normalizeEmail(user.email);
    const emailId = normalizeEmailId(emailLower);

    try {
      const preSnap = await getDocFromServer(doc(db, 'preauthorized_emails', emailId));
      if (!preSnap.exists()) {
        setCodeError(
          'Aucun code personnel n’est configuré pour cette adresse e-mail. Contactez l’administrateur ou utilisez « Demander l’accès » ci-dessous.'
        );
        return;
      }

      const preData = preSnap.data() as PreauthorizedEmailDoc;
      if (preData.accessCode.trim().toLowerCase() !== codeClean.toLowerCase()) {
        setCodeError('Code personnel incorrect. Vérifiez la saisie et réessayez.');
        return;
      }

      const curName = (user.displayName || existingDoc?.displayName || '').slice(0, 120);
      const curDevice = detectDeviceHint();
      const curNote = (preData.note || existingDoc?.note || '').slice(0, 200);

      if (existingDoc) {
        try {
          await updateDoc(doc(db, 'access_users', user.uid), {
            status: 'approved',
            activationCode: codeClean,
            displayName: curName,
            deviceHint: curDevice,
            note: curNote,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `access_users/${user.uid}`);
        }
      } else {
        try {
          await setDoc(doc(db, 'access_users', user.uid), {
            uid: user.uid,
            email: emailLower,
            displayName: curName,
            role: 'user',
            status: 'approved',
            deviceHint: curDevice,
            note: curNote,
            activationCode: codeClean,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `access_users/${user.uid}`);
        }
      }

      saveCachedApproval({
        uid: user.uid,
        email: emailLower,
        role: 'user',
        status: 'approved',
        displayName: curName,
        cachedAt: new Date().toISOString(),
      });

      setStage({
        kind: 'ready',
        session: { user, isAdmin: false, offlineMode: false, status: 'approved' },
      });
    } catch (err) {
      setCodeError(translateFirebaseErrorFr(err));
    } finally {
      setCodeBusy(false);
    }
  };

  const handleRequestAccessPending = async (user: User) => {
    setCodeBusy(true);
    setCodeError(null);
    const emailLower = normalizeEmail(user.email);
    const newDoc: AccessUserDoc = {
      uid: user.uid,
      email: emailLower,
      displayName: (user.displayName || '').slice(0, 120),
      role: 'user',
      status: 'pending',
      deviceHint: detectDeviceHint(),
      note: '',
      activationCode: '',
    };

    try {
      await setDoc(doc(db, 'access_users', user.uid), {
        ...newDoc,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setStage({ kind: 'pending', user, accessDoc: newDoc });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `access_users/${user.uid}`);
      } catch (wrapped) {
        setCodeError(translateFirebaseErrorFr(wrapped));
      }
    } finally {
      setCodeBusy(false);
    }
  };

  if (stage.kind === 'ready') {
    return <>{children(stage.session, handleSignOut)}</>;
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden">
        {/* En-tête application */}
        <div className="px-6 py-5 bg-[#1e3a5f] text-white flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-sky-200" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight">ProjectController</h1>
            <p className="text-xs text-sky-100/90">
              Gestion de chantier, mesurage &amp; suivi des délais
            </p>
          </div>
        </div>

        <div className="p-6">
          {(stage.kind === 'booting' || stage.kind === 'checking_access') && (
            <div className="py-6 flex flex-col items-center text-center gap-3">
              <div className="w-8 h-8 border-2 border-[#1e3a5f] dark:border-sky-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-sm font-semibold">
                {stage.kind === 'booting'
                  ? 'Initialisation de la session…'
                  : 'Vérification de votre accès…'}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lecture sécurisée de votre autorisation appareil.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (stage.kind === 'checking_access') {
                    void handleSignOut();
                  } else {
                    setStage({ kind: 'login' });
                  }
                }}
                className="mt-1 text-xs text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                {stage.kind === 'checking_access'
                  ? 'Annuler / Changer de compte'
                  : 'Afficher l’écran de connexion'}
              </button>
            </div>
          )}

          {stage.kind === 'login' && (
            <div className="space-y-4">
              {/* 2 Onglets : Compte Google / E-mail pro */}
              <div className="grid grid-cols-2 rounded-lg border border-slate-200 dark:border-slate-700 p-1 bg-slate-100 dark:bg-slate-950 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setLoginTab('google');
                    setAuthError(null);
                    setAuthInfo(null);
                  }}
                  className={`py-2 rounded-md cursor-pointer transition-colors ${
                    loginTab === 'google'
                      ? 'bg-white dark:bg-slate-800 text-[#1e3a5f] dark:text-sky-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Compte Google
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginTab('email');
                    setAuthError(null);
                    setAuthInfo(null);
                  }}
                  className={`py-2 rounded-md cursor-pointer transition-colors ${
                    loginTab === 'email'
                      ? 'bg-white dark:bg-slate-800 text-[#1e3a5f] dark:text-sky-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  E-mail pro
                </button>
              </div>

              {loginTab === 'google' ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Connectez-vous avec votre compte Google. Une seule activation par code personnel est demandée lors de la première connexion sur cet appareil.
                  </p>
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                      />
                    </svg>
                    {authBusy ? 'Connexion en cours…' : 'Continuer avec Google'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleEmailAuth} className="space-y-3">
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setEmailMode('signin');
                        setAuthError(null);
                      }}
                      className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                        emailMode === 'signin'
                          ? 'bg-[#1e3a5f] text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Déjà inscrit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEmailMode('signup');
                        setAuthError(null);
                      }}
                      className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                        emailMode === 'signup'
                          ? 'bg-[#1e3a5f] text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      1re connexion
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Adresse e-mail professionnelle
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="prenom.nom@entreprise.be"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        Mot de passe (min. 6 caractères)
                      </label>
                      {emailMode === 'signin' && (
                        <button
                          type="button"
                          onClick={handleForgotPassword}
                          className="text-[11px] text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                        >
                          Mot de passe oublié ?
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#1e3a5f] hover:bg-[#162d4b] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Mail className="w-4 h-4" />
                    {authBusy
                      ? 'Traitement…'
                      : emailMode === 'signup'
                      ? 'Créer mon accès & confirmer par e-mail'
                      : 'Se connecter'}
                  </button>
                </form>
              )}

              {authError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {authInfo && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authInfo}</span>
                </div>
              )}
            </div>
          )}

          {stage.kind === 'verify_email' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Confirmez votre e-mail pro</h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                    Un lien de validation a été envoyé à{' '}
                    <strong className="text-slate-900 dark:text-slate-100">{stage.user.email}</strong>.
                    Ouvrez ce lien dans votre messagerie puis cliquez ci-dessous.
                  </p>
                </div>
              </div>

              {authError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
                  {authError}
                </div>
              )}
              {authInfo && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
                  {authInfo}
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void handleCheckEmailVerified(stage.user)}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {authBusy ? 'Vérification…' : 'J’ai cliqué sur le lien — Continuer'}
                </button>
                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void handleResendVerification(stage.user)}
                    className="text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                  >
                    Renvoyer l’e-mail
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  >
                    Autre compte
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage.kind === 'enter_code' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Activation de cet appareil</h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Connecté en tant que <strong>{stage.user.email}</strong>. Saisissez le code personnel fourni par l’administrateur (1 seule fois par appareil).
                  </p>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleActivateWithCode(stage.user, stage.accessDoc);
                }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={personalCode}
                  onChange={(e) => setPersonalCode(e.target.value)}
                  placeholder="Code personnel (ex. 482910)"
                  maxLength={32}
                  autoFocus
                  className="w-full px-3 py-2 text-sm font-mono tracking-wider rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />

                {codeError && (
                  <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
                    {codeError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={codeBusy}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#1e3a5f] hover:bg-[#162d4b] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {codeBusy ? 'Validation…' : 'Valider mon code personnel'}
                </button>
              </form>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <button
                  type="button"
                  disabled={codeBusy}
                  onClick={() => void handleRequestAccessPending(stage.user)}
                  className="text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                >
                  Pas encore de code ? Demander l’accès
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                >
                  Changer de compte
                </button>
              </div>
            </div>
          )}

          {stage.kind === 'pending' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Demande d’accès en attente</h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                    Votre demande pour <strong>{stage.user.email}</strong> a bien été transmise. L’administrateur doit l’approuver ou vous communiquer un code personnel.
                  </p>
                </div>
              </div>

              {/* Possibilité d'entrer un code reçu entre-temps */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleActivateWithCode(stage.user, stage.accessDoc);
                }}
                className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800"
              >
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Vous avez reçu votre code entre-temps ?
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={personalCode}
                    onChange={(e) => setPersonalCode(e.target.value)}
                    placeholder="Code personnel"
                    maxLength={32}
                    className="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                  />
                  <button
                    type="submit"
                    disabled={codeBusy}
                    className="px-3 py-1.5 rounded-lg bg-[#1e3a5f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    Activer
                  </button>
                </div>
                {codeError && <p className="text-xs text-rose-600 dark:text-rose-400">{codeError}</p>}
              </form>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => void checkUserAccess(stage.user, true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Actualiser
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" /> Changer de compte
                </button>
              </div>
            </div>
          )}

          {stage.kind === 'revoked' && (
            <div className="space-y-4 text-center py-2">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-rose-700 dark:text-rose-400">
                  Accès non autorisé
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  L’accès de cet appareil ({stage.user.email}) a été révoqué ou refusé par l’administrateur.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Changer de compte
              </button>
            </div>
          )}

          {(stage.kind === 'offline_blocked' || stage.kind === 'quota_blocked') && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
                  <WifiOff className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">
                    {stage.kind === 'quota_blocked'
                      ? 'Quota Firestore temporairement atteint'
                      : 'Connexion réseau requise'}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                    {stage.reason}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void checkUserAccess(stage.user, true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-[#1e3a5f] hover:bg-[#162d4b] text-white text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Réessayer
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium cursor-pointer"
                >
                  Changer de compte
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
