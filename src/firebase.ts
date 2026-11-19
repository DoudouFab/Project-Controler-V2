import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const ADMIN_EMAIL = 'pirquinfabien@gmail.com';
const ACCESS_CACHE_KEY = 'projectcontroller_access_cache_v1';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Persister la session localement pour le fonctionnement hors-ligne
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignorer si le navigateur restreint la persistance
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function normalizeEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

export function normalizeEmailId(email: string | null | undefined): string {
  return normalizeEmail(email).replace(/[^a-z0-9-]/g, '_');
}

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) return false;
  return normalizeEmail(user.email) === ADMIN_EMAIL && user.emailVerified === true;
}

export function isColleagueEmailVerified(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.emailVerified) return true;
  return (user.providerData || []).some((p) => p.providerId === 'google.com');
}

export function detectDeviceHint(): string {
  if (typeof navigator === 'undefined') return 'Navigateur';
  const ua = navigator.userAgent || '';
  let os = 'Appareil';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Navigateur';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  return `${os} · ${browser}`.slice(0, 120);
}

export interface AccessUserDoc {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'pending' | 'approved' | 'revoked';
  deviceHint: string;
  note: string;
  activationCode: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PreauthorizedEmailDoc {
  id: string;
  email: string;
  accessCode: string;
  note: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CachedAccessApproval {
  uid: string;
  email: string;
  role: 'admin' | 'user';
  status: 'approved';
  displayName: string;
  cachedAt: string;
}

export function readCachedApproval(uid: string, email: string): CachedAccessApproval | null {
  try {
    const raw = localStorage.getItem(ACCESS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAccessApproval;
    if (
      parsed &&
      parsed.uid === uid &&
      normalizeEmail(parsed.email) === normalizeEmail(email) &&
      parsed.status === 'approved'
    ) {
      return parsed;
    }
  } catch {
    // Ignorer stockage corrompu
  }
  return null;
}

export function saveCachedApproval(entry: CachedAccessApproval): void {
  try {
    localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignorer erreur quota localStorage
  }
}

export function clearCachedApproval(): void {
  try {
    localStorage.removeItem(ACCESS_CACHE_KEY);
  } catch {
    // Ignorer
  }
}

export function extractFirebaseErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message) as { error?: string };
      if (parsed && typeof parsed.error === 'string') return parsed.error;
    } catch {
      // Pas du JSON FirestoreErrorInfo
    }
    return err.message;
  }
  return String(err || '');
}

export function isQuotaExceededError(err: unknown): boolean {
  const msg = extractFirebaseErrorMessage(err).toLowerCase();
  const code = (err as { code?: string })?.code?.toLowerCase() || '';
  return (
    code.includes('resource-exhausted') ||
    msg.includes('resource-exhausted') ||
    msg.includes('quota')
  );
}

export function isOfflineFirebaseError(err: unknown): boolean {
  const msg = extractFirebaseErrorMessage(err).toLowerCase();
  const code = (err as { code?: string })?.code?.toLowerCase() || '';
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    code.includes('unavailable') ||
    code.includes('failed-precondition') ||
    msg.includes('client is offline') ||
    msg.includes('network-request-failed') ||
    msg.includes('failed to get document because the client is offline') ||
    msg.includes('unavailable')
  );
}

export function translateFirebaseErrorFr(err: unknown): string {
  const raw = extractFirebaseErrorMessage(err);
  const low = raw.toLowerCase();
  const code = ((err as { code?: string })?.code || '').toLowerCase();

  if (isQuotaExceededError(err)) {
    return 'Le quota gratuit quotidien de la base Firestore est temporairement dépassé. Il se réinitialise automatiquement demain. Si cet appareil a déjà été activé, l’application reste utilisable hors-ligne.';
  }
  if (isOfflineFirebaseError(err)) {
    return 'Connexion Internet indisponible ou serveur inaccessible. Vérifiez votre réseau puis réessayez.';
  }
  if (code.includes('permission-denied') || low.includes('missing or insufficient permissions')) {
    return 'Accès refusé par les règles de sécurité. Vérifiez que votre adresse e-mail est confirmée et que le code personnel saisi est exact.';
  }
  if (code.includes('auth/email-already-in-use') || low.includes('email-already-in-use')) {
    return 'Cette adresse e-mail est déjà inscrite. Basculez sur « Déjà inscrit » pour vous connecter.';
  }
  if (
    code.includes('auth/invalid-credential') ||
    code.includes('auth/wrong-password') ||
    code.includes('auth/user-not-found') ||
    low.includes('invalid-credential')
  ) {
    return 'Adresse e-mail ou mot de passe incorrect.';
  }
  if (code.includes('auth/weak-password')) {
    return 'Le mot de passe doit contenir au moins 6 caractères.';
  }
  if (code.includes('auth/invalid-email')) {
    return 'Adresse e-mail invalide.';
  }
  if (code.includes('auth/popup-closed-by-user')) {
    return 'La fenêtre de connexion Google a été fermée avant la fin.';
  }
  if (code.includes('auth/popup-blocked')) {
    return 'La fenêtre pop-up a été bloquée par le navigateur. Autorisez les pop-ups pour ce site et réessayez.';
  }
  if (code.includes('auth/unauthorized-domain')) {
    return 'Ce domaine n’est pas encore autorisé dans Firebase Authentication (Settings -> Authorized domains).';
  }
  if (code.includes('auth/too-many-requests')) {
    return 'Trop de tentatives rapprochées. Patientez quelques instants avant de réessayer.';
  }
  return raw || 'Une erreur inattendue est survenue.';
}
