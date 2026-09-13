/**
 * Optional sign-in.
 *
 * The core loop — open a folder, drag it into shape, export — works entirely
 * signed out. Signing in only adds one thing: your planned layout follows you
 * to another machine. Nothing gates on it.
 *
 * No Drive scope is requested. The previous version asked for full Drive access
 * and never used the token for anything.
 */

import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const provider = new GoogleAuthProvider();

export interface SessionUser {
  uid: string;
  email: string | null;
}

const toSessionUser = (user: User): SessionUser => ({
  uid: user.uid,
  email: user.email,
});

export function watchAuth(onChange: (user: SessionUser | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => {
    onChange(user ? toSessionUser(user) : null);
  });
}

export async function googleSignIn(): Promise<SessionUser> {
  const result = await signInWithPopup(auth, provider);
  return toSessionUser(result.user);
}

export async function logout(): Promise<void> {
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
