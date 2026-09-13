/**
 * Optional sign-in, loaded on demand.
 *
 * The core loop — open a folder, drag it into shape, export — works entirely
 * signed out. Signing in only adds one thing: your planned layout follows you
 * to another machine. Nothing gates on it.
 *
 * So the Firebase SDK is dynamically imported rather than bundled into the
 * entry chunk: a user who never signs in never pays for it. Everything here is
 * async for that reason.
 *
 * No Drive scope is requested. The previous version asked for full Drive access
 * and never used the token for anything.
 */

import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

export interface SessionUser {
  uid: string;
  email: string | null;
}

interface FirebaseBundle {
  auth: Auth;
  db: Firestore;
}

let bundle: Promise<FirebaseBundle> | null = null;

/** Initialises Firebase once, on first use. */
export function getFirebase(): Promise<FirebaseBundle> {
  if (!bundle) {
    bundle = (async () => {
      const [{ initializeApp }, authModule, firestoreModule, { default: config }] =
        await Promise.all([
          import('firebase/app'),
          import('firebase/auth'),
          import('firebase/firestore'),
          import('../../firebase-applet-config.json'),
        ]);

      const app = initializeApp(config);
      return {
        auth: authModule.getAuth(app),
        db: firestoreModule.getFirestore(app, config.firestoreDatabaseId),
      };
    })();
  }
  return bundle;
}

const toSessionUser = (user: User): SessionUser => ({ uid: user.uid, email: user.email });

/**
 * Subscribes to auth state. Returns a synchronous unsubscribe, so callers can
 * use it directly as an effect cleanup even though setup is async.
 */
export function watchAuth(onChange: (user: SessionUser | null) => void): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;

  void (async () => {
    try {
      const [{ auth }, { onAuthStateChanged }] = await Promise.all([
        getFirebase(),
        import('firebase/auth'),
      ]);
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (user) => {
        onChange(user ? toSessionUser(user) : null);
      });
    } catch (err) {
      console.error('Auth unavailable:', err);
    }
  })();

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

export async function googleSignIn(): Promise<SessionUser> {
  const [{ auth }, { GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    getFirebase(),
    import('firebase/auth'),
  ]);
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  return toSessionUser(result.user);
}

export async function logout(): Promise<void> {
  const [{ auth }, { signOut }] = await Promise.all([getFirebase(), import('firebase/auth')]);
  await signOut(auth);
}

/** Turns Firebase's error codes into something worth showing a person. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'auth/popup-closed-by-user') return 'Sign-in was cancelled.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in popup.';
  if (code === 'auth/network-request-failed') return 'Network error during sign-in.';
  return 'Could not sign in. Your work is still saved in this tab.';
}
