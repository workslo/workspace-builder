import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TREE_BYTES,
  createPersistence,
  deserializeTree,
  serializeTree,
  type SaveStatus,
} from './persistence';
import { addPath, allPaths, buildTreeFromPaths, makeId, type FileNode } from '../store/treeOps';

// The module pulls in Firebase at import time purely for the default writer.
vi.mock('./auth', () => ({ db: {}, auth: {} }));

function build(paths: Array<[string, 'file' | 'folder']>): FileNode[] {
  let tree: FileNode[] = [];
  for (const [path, type] of paths) tree = addPath(tree, path, type).tree;
  return tree;
}

const sample = () =>
  build([
    ['/src/components/Button.tsx', 'file'],
    ['/src/App.tsx', 'file'],
    ['/README.md', 'file'],
    ['/empty', 'folder'],
  ]);

describe('serialization', () => {
  it('round-trips the tree structure', () => {
    const tree = sample();
    const restored = deserializeTree(serializeTree(tree), makeId);
    expect(allPaths(restored)).toEqual(allPaths(tree));
  });

  it('preserves node types, including an empty folder', () => {
    const restored = deserializeTree(serializeTree(sample()), makeId);
    const empty = restored.find((n) => n.path === '/empty')!;
    expect(empty.type).toBe('folder');
    expect(empty.children).toEqual([]);
  });

  it('never carries file contents onto the wire', () => {
    const payload = serializeTree(sample());
    expect(payload).not.toContain('content');
    expect(payload).not.toContain('Button = ()');
  });

  it('stays compact — the wire format is what the 1 MiB rule limit applies to', () => {
    // A realistically large repo must still fit under the Firestore rule cap.
    const tree = buildTreeFromPaths(
      Array.from({ length: 5000 }, (_, i) => ({
        path: `/src/module${i % 50}/file${i}.ts`,
        type: 'file' as const,
      })),
    );
    expect(serializeTree(tree).length).toBeLessThan(MAX_TREE_BYTES);
  });

  it('gives every restored node a fresh unique id', () => {
    const restored = deserializeTree(serializeTree(sample()), makeId);
    const ids: string[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        ids.push(n.id);
        if (n.children) walk(n.children);
      }
    };
    walk(restored);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('debounced saving', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of changes into one write', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const store = createPersistence(write, async () => null, 100);

    // Stands in for a drag: many intermediate states in quick succession.
    for (let i = 0; i < 20; i += 1) {
      store.save('user-1', build([[`/file${i}.ts`, 'file']]));
    }
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('writes the most recent state, not the first', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const store = createPersistence(write, async () => null, 100);

    store.save('user-1', build([['/first.ts', 'file']]));
    store.save('user-1', build([['/last.ts', 'file']]));

    await vi.advanceTimersByTimeAsync(150);
    expect(write.mock.calls[0][1]).toContain('/last.ts');
    expect(write.mock.calls[0][1]).not.toContain('/first.ts');
  });

  it('reports saving and then saved', async () => {
    const seen: SaveStatus['state'][] = [];
    const store = createPersistence(vi.fn().mockResolvedValue(undefined), async () => null, 100);
    store.onStatus((status) => seen.push(status.state));

    store.save('user-1', sample());
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual(['saving', 'saved']);
  });

  it('surfaces a write failure instead of swallowing it', async () => {
    const seen: SaveStatus[] = [];
    const store = createPersistence(
      vi.fn().mockRejectedValue(new Error('permission-denied')),
      async () => null,
      100,
    );
    store.onStatus((status) => seen.push(status));

    store.save('user-1', sample());
    await vi.advanceTimersByTimeAsync(150);

    const last = seen[seen.length - 1];
    expect(last.state).toBe('error');
    expect(last.state === 'error' && last.message).toContain('permission-denied');
  });

  it('refuses an oversized tree and says why, rather than failing at the server', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const seen: SaveStatus[] = [];
    const store = createPersistence(write, async () => null, 100);
    store.onStatus((status) => seen.push(status));

    const huge = buildTreeFromPaths(
      Array.from({ length: 12000 }, (_, i) => ({
        path: `/deeply/nested/path/number/${i}/file-with-a-long-name-${i}.ts`,
        type: 'file' as const,
      })),
    );

    store.save('user-1', huge);
    await vi.advanceTimersByTimeAsync(200);

    expect(write).not.toHaveBeenCalled();
    const last = seen[seen.length - 1];
    expect(last.state).toBe('error');
    expect(last.state === 'error' && last.message).toMatch(/too large/i);
  });

  it('flush writes immediately without waiting out the debounce', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const store = createPersistence(write, async () => null, 5000);

    store.save('user-1', sample());
    await store.flush();

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('cancel drops a queued write', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const store = createPersistence(write, async () => null, 100);

    store.save('user-1', sample());
    store.cancel();
    await vi.advanceTimersByTimeAsync(200);

    expect(write).not.toHaveBeenCalled();
  });
});

describe('loading', () => {
  it('returns null when the user has nothing saved', async () => {
    const store = createPersistence(vi.fn(), async () => null);
    await expect(store.load('user-1', makeId)).resolves.toBeNull();
  });

  it('returns null rather than throwing on a corrupt document', async () => {
    const store = createPersistence(vi.fn(), async () => 'not json at all');
    await expect(store.load('user-1', makeId)).resolves.toBeNull();
  });

  it('restores a saved tree', async () => {
    const payload = serializeTree(sample());
    const store = createPersistence(vi.fn(), async () => payload);
    const restored = await store.load('user-1', makeId);
    expect(allPaths(restored!)).toEqual(allPaths(sample()));
  });
});
