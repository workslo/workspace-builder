/**
 * Firestore sync for the tree *structure*.
 *
 * Three rules, all learned from the version this replaces:
 *  1. Debounced. A drag is one write, not one write per intermediate state.
 *  2. Structure only. File contents never leave the browser, which also keeps
 *     the document far below the 1 MiB ceiling in firestore.rules.
 *  3. Failures are surfaced. A write that fails silently is worse than no
 *     persistence at all, because the user believes their work is saved.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './auth';
import type { FileNode } from '../store/treeOps';

export const SAVE_DEBOUNCE_MS = 1200;

/** Matches `data.tree.size() <= 1048576` in firestore.rules, with headroom. */
export const MAX_TREE_BYTES = 1_000_000;

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string };

/** Wire shape. Ids are regenerated on load, so they are not persisted. */
interface WireNode {
  p: string;
  t: 'file' | 'folder';
  c?: WireNode[];
}

function toWire(nodes: readonly FileNode[]): WireNode[] {
  return nodes.map((node) => {
    const out: WireNode = { p: node.path, t: node.type };
    if (node.children?.length) out.c = toWire(node.children);
    return out;
  });
}

function fromWire(nodes: readonly WireNode[], makeId: () => string): FileNode[] {
  return nodes.map((node) => {
    const name = node.p.split('/').filter(Boolean).pop() ?? '';
    const out: FileNode = { id: makeId(), path: node.p, name, type: node.t };
    if (node.t === 'folder') out.children = node.c ? fromWire(node.c, makeId) : [];
    return out;
  });
}

export function serializeTree(tree: readonly FileNode[]): string {
  return JSON.stringify(toWire(tree));
}

export function deserializeTree(raw: string, makeId: () => string): FileNode[] {
  const parsed = JSON.parse(raw) as WireNode[];
  if (!Array.isArray(parsed)) return [];
  return fromWire(parsed, makeId);
}

export interface Persistence {
  /** Queues a save. Repeated calls inside the debounce window coalesce. */
  save(uid: string, tree: readonly FileNode[]): void;
  /** Writes any queued save immediately. */
  flush(): Promise<void>;
  load(uid: string, makeId: () => string): Promise<FileNode[] | null>;
  onStatus(listener: (status: SaveStatus) => void): () => void;
  cancel(): void;
}

type WriteFn = (uid: string, payload: string) => Promise<void>;
type ReadFn = (uid: string) => Promise<string | null>;

const firestoreWrite: WriteFn = async (uid, payload) => {
  await setDoc(doc(db, 'repos', uid), { tree: payload, ownerId: uid }, { merge: true });
};

const firestoreRead: ReadFn = async (uid) => {
  const snapshot = await getDoc(doc(db, 'repos', uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as { tree?: string };
  return data.tree ?? null;
};

export function createPersistence(
  write: WriteFn = firestoreWrite,
  read: ReadFn = firestoreRead,
  debounceMs: number = SAVE_DEBOUNCE_MS,
): Persistence {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { uid: string; payload: string } | null = null;
  let inflight: Promise<void> = Promise.resolve();
  const listeners = new Set<(status: SaveStatus) => void>();

  const emit = (status: SaveStatus) => {
    for (const listener of listeners) listener(status);
  };

  const commit = async () => {
    const job = pending;
    pending = null;
    if (!job) return;

    emit({ state: 'saving' });
    try {
      await write(job.uid, job.payload);
      emit({ state: 'saved', at: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      emit({ state: 'error', message });
    }
  };

  return {
    save(uid, tree) {
      const payload = serializeTree(tree);

      if (payload.length > MAX_TREE_BYTES) {
        pending = null;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        emit({
          state: 'error',
          message:
            'This repository is too large to sync. Your changes stay in this tab, ' +
            'and export still works.',
        });
        return;
      }

      pending = { uid, payload };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        inflight = inflight.then(commit);
      }, debounceMs);
    },

    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        inflight = inflight.then(commit);
      }
      await inflight;
    },

    async load(uid, makeId) {
      const raw = await read(uid);
      if (!raw) return null;
      try {
        return deserializeTree(raw, makeId);
      } catch {
        return null;
      }
    },

    onStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

export const persistence = createPersistence();
