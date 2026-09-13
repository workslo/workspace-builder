import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRepoStore } from './useRepoStore';
import { contentStore } from './contentStore';
import { allPaths } from './treeOps';

vi.mock('../lib/auth', () => ({
  db: {},
  auth: {},
  watchAuth: () => () => {},
  googleSignIn: vi.fn(),
  logout: vi.fn(),
  describeAuthError: () => 'error',
}));

const reset = () => {
  contentStore.clear();
  useRepoStore.setState({
    tree: [],
    index: new Map(),
    paths: [],
    baseline: null,
    expanded: new Set(),
    selectedPath: null,
    contentVersion: 0,
    user: null,
    undoStack: [],
    redoStack: [],
    pendingChatPrompt: null,
  });
};

const paths = () => allPaths(useRepoStore.getState().tree);

describe('useRepoStore', () => {
  beforeEach(reset);

  it('starts empty', () => {
    expect(useRepoStore.getState().tree).toEqual([]);
    expect(useRepoStore.getState().paths).toEqual([]);
  });

  it('loads sample data with contents held outside the tree', () => {
    useRepoStore.getState().loadMockData();
    expect(paths()).toContain('/src/components/Button.tsx');

    const node = useRepoStore.getState().index.get('/src/components/Button.tsx')!;
    expect(node).toBeDefined();
    expect('content' in node).toBe(false);
    expect(contentStore.get('/src/components/Button.tsx')).toContain('Button');
  });

  it('keeps the index and path list in step with the tree', () => {
    const { addNode } = useRepoStore.getState();
    addNode('/src/lib/api.ts', 'file');

    const state = useRepoStore.getState();
    expect(state.index.get('/src/lib/api.ts')).toBeDefined();
    expect(state.paths).toEqual(['/src', '/src/lib', '/src/lib/api.ts']);
    expect(state.index.size).toBe(state.paths.length);
  });

  it('expands ancestors of an added path so it is visible', () => {
    useRepoStore.getState().addNode('/a/b/c.ts', 'file');
    expect(useRepoStore.getState().expanded).toEqual(new Set(['/a', '/a/b']));
  });

  it('clears the selection when the selected file is removed', () => {
    const store = useRepoStore.getState();
    store.addNode('/src/a.ts', 'file');
    store.setSelectedPath('/src/a.ts');
    useRepoStore.getState().removeNode('/src/a.ts');
    expect(useRepoStore.getState().selectedPath).toBeNull();
  });

  it('clears the selection when an ancestor of the selection is removed', () => {
    const store = useRepoStore.getState();
    store.addNode('/src/deep/a.ts', 'file');
    store.setSelectedPath('/src/deep/a.ts');
    useRepoStore.getState().removeNode('/src/deep');
    expect(useRepoStore.getState().selectedPath).toBeNull();
  });

  it('drops content for a removed subtree', () => {
    const store = useRepoStore.getState();
    store.addNode('/src/a.ts', 'file', 'hello');
    expect(contentStore.get('/src/a.ts')).toBe('hello');
    useRepoStore.getState().removeNode('/src');
    expect(contentStore.get('/src/a.ts')).toBeUndefined();
  });

  it('follows content and selection through a move', () => {
    const store = useRepoStore.getState();
    store.addNode('/src/a.ts', 'file', 'body');
    store.addNode('/lib/.keep', 'file');
    useRepoStore.getState().setSelectedPath('/src/a.ts');

    useRepoStore.getState().moveNode('/src/a.ts', '/lib');

    expect(paths()).toContain('/lib/a.ts');
    expect(contentStore.get('/lib/a.ts')).toBe('body');
    expect(contentStore.get('/src/a.ts')).toBeUndefined();
    expect(useRepoStore.getState().selectedPath).toBe('/lib/a.ts');
  });

  it('follows content through a rename', () => {
    const store = useRepoStore.getState();
    store.addNode('/src/a.ts', 'file', 'body');
    useRepoStore.getState().renameNode('/src/a.ts', 'b.ts');
    expect(contentStore.get('/src/b.ts')).toBe('body');
  });

  describe('writeFileContent', () => {
    it('does not touch the tree', () => {
      useRepoStore.getState().addNode('/a.ts', 'file', 'one');
      const before = useRepoStore.getState().tree;

      useRepoStore.getState().writeFileContent('/a.ts', 'two');

      // Same array identity: no clone, no re-render of anything reading `tree`.
      expect(useRepoStore.getState().tree).toBe(before);
      expect(contentStore.get('/a.ts')).toBe('two');
    });

    it('does not bump contentVersion, so the editor is never remounted', () => {
      useRepoStore.getState().addNode('/a.ts', 'file', 'one');
      const version = useRepoStore.getState().contentVersion;
      useRepoStore.getState().writeFileContent('/a.ts', 'two');
      expect(useRepoStore.getState().contentVersion).toBe(version);
    });

    it('does not push an undo entry for a keystroke', () => {
      useRepoStore.getState().addNode('/a.ts', 'file', 'one');
      const depth = useRepoStore.getState().undoStack.length;
      useRepoStore.getState().writeFileContent('/a.ts', 'two');
      expect(useRepoStore.getState().undoStack.length).toBe(depth);
    });
  });

  describe('applyDiffs', () => {
    it('applies a batch of adds', () => {
      useRepoStore.getState().applyDiffs([
        { action: 'add', path: '/src/hooks/useAuth.ts', type: 'file', content: 'export {}' },
        { action: 'add', path: '/src/hooks/useUser.ts', type: 'file' },
      ]);

      expect(paths()).toContain('/src/hooks/useAuth.ts');
      expect(paths()).toContain('/src/hooks/useUser.ts');
      expect(contentStore.get('/src/hooks/useAuth.ts')).toBe('export {}');
    });

    it('records the whole batch as one undo step', () => {
      useRepoStore.getState().applyDiffs([
        { action: 'add', path: '/a.ts', type: 'file' },
        { action: 'add', path: '/b.ts', type: 'file' },
        { action: 'add', path: '/c.ts', type: 'file' },
      ]);

      expect(useRepoStore.getState().undoStack.length).toBe(1);
      useRepoStore.getState().undo();
      expect(paths()).toEqual([]);
    });

    it('handles a remove paired with an add, which is how a move arrives', () => {
      useRepoStore.getState().addNode('/old/a.ts', 'file', 'body');
      useRepoStore.getState().applyDiffs([
        { action: 'remove', path: '/old/a.ts', type: 'file' },
        { action: 'add', path: '/new/a.ts', type: 'file', content: 'body' },
      ]);

      expect(paths()).not.toContain('/old/a.ts');
      expect(paths()).toContain('/new/a.ts');
    });

    it('updates content for a path that already exists', () => {
      useRepoStore.getState().addNode('/a.ts', 'file', 'before');
      useRepoStore.getState().applyDiffs([
        { action: 'update', path: '/a.ts', type: 'file', content: 'after' },
      ]);
      expect(contentStore.get('/a.ts')).toBe('after');
    });

    it('ignores a remove of a path that is not there', () => {
      useRepoStore.getState().addNode('/a.ts', 'file');
      const before = useRepoStore.getState().tree;
      useRepoStore.getState().applyDiffs([
        { action: 'remove', path: '/nope.ts', type: 'file' },
      ]);
      expect(useRepoStore.getState().tree).toBe(before);
    });
  });

  describe('undo and redo', () => {
    it('reverses an add', () => {
      useRepoStore.getState().addNode('/a.ts', 'file');
      expect(paths()).toEqual(['/a.ts']);
      useRepoStore.getState().undo();
      expect(paths()).toEqual([]);
    });

    it('reverses a move, restoring the original path', () => {
      const store = useRepoStore.getState();
      store.addNode('/src/a.ts', 'file');
      store.addNode('/lib/.keep', 'file');
      useRepoStore.getState().moveNode('/src/a.ts', '/lib');
      expect(paths()).toContain('/lib/a.ts');

      useRepoStore.getState().undo();
      expect(paths()).toContain('/src/a.ts');
      expect(paths()).not.toContain('/lib/a.ts');
    });

    it('redoes what was undone', () => {
      useRepoStore.getState().addNode('/a.ts', 'file');
      useRepoStore.getState().undo();
      useRepoStore.getState().redo();
      expect(paths()).toEqual(['/a.ts']);
    });

    it('clears the redo stack once a new change lands', () => {
      useRepoStore.getState().addNode('/a.ts', 'file');
      useRepoStore.getState().undo();
      expect(useRepoStore.getState().redoStack.length).toBe(1);

      useRepoStore.getState().addNode('/b.ts', 'file');
      expect(useRepoStore.getState().redoStack.length).toBe(0);
    });

    it('does nothing when there is nothing to undo', () => {
      const before = useRepoStore.getState().tree;
      useRepoStore.getState().undo();
      expect(useRepoStore.getState().tree).toBe(before);
    });

    it('starts a freshly opened folder with no history', () => {
      useRepoStore.getState().addNode('/a.ts', 'file');
      useRepoStore.getState().loadMockData();
      expect(useRepoStore.getState().undoStack).toEqual([]);
      expect(useRepoStore.getState().redoStack).toEqual([]);
    });
  });

  it('restores the baseline layout', () => {
    useRepoStore.getState().loadMockData();
    const original = useRepoStore.getState().paths;

    useRepoStore.getState().moveNode('/README.md', '/src');
    expect(useRepoStore.getState().paths).not.toEqual(original);

    useRepoStore.getState().resetToBaseline();
    expect(useRepoStore.getState().paths).toEqual(original);
  });
});
