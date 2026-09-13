import { create } from 'zustand';
import {
  addPath,
  allPaths,
  buildTreeFromPaths,
  ancestorPaths,
  basename,
  buildIndex,
  isWithin,
  makeId,
  movePath,
  normalizePath,
  removePath,
  renamePath,
  type FileNode,
  type NodeType,
  type TreeIndex,
} from './treeOps';
import { contentStore, type FileSource } from './contentStore';
import { persistence, type SaveStatus } from '../lib/persistence';

export type { FileNode, NodeType } from './treeOps';

/** One structural change proposed by the copilot. */
export interface FileDiff {
  action: 'add' | 'remove' | 'update';
  path: string;
  type: NodeType;
  content?: string;
}

interface Snapshot {
  tree: FileNode[];
  selectedPath: string | null;
}

const UNDO_LIMIT = 100;

export interface RepoState {
  tree: FileNode[];
  /** path -> node. Rebuilt only on structural change. */
  index: TreeIndex;
  /** Flat path list, kept alongside the index for cheap search. */
  paths: string[];
  /** The tree as it was when loaded. `computeRepoDiff` diffs against this. */
  baseline: FileNode[] | null;
  expanded: Set<string>;
  selectedPath: string | null;
  /** Bumped when content changes from off-screen, so the editor re-reads. */
  contentVersion: number;

  user: { uid: string; email: string | null } | null;
  saveStatus: SaveStatus;

  undoStack: Snapshot[];
  redoStack: Snapshot[];

  pendingChatPrompt: string | null;

  setSelectedPath: (path: string | null) => void;
  toggleExpanded: (path: string) => void;
  setExpanded: (paths: Iterable<string>) => void;
  expandAll: () => void;
  collapseAll: () => void;
  revealPath: (path: string) => void;

  addNode: (path: string, type: NodeType, content?: string) => void;
  removeNode: (path: string) => void;
  moveNode: (sourcePath: string, targetFolderPath: string) => void;
  renameNode: (path: string, newName: string) => void;
  applyDiffs: (diffs: FileDiff[]) => void;

  /** Editor write-through. Does not touch the tree and does not re-render it. */
  writeFileContent: (path: string, content: string) => void;
  readFileContent: (path: string) => string | undefined;
  loadFileContent: (path: string) => Promise<string | undefined>;
  isFileReadable: (path: string) => boolean;

  loadMockData: () => void;
  setLocalFolder: (tree: FileNode[], sources: Map<string, FileSource>) => void;
  resetToBaseline: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setUser: (user: { uid: string; email: string | null } | null) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setPendingChatPrompt: (prompt: string | null) => void;
}

function derive(tree: FileNode[]) {
  const index = buildIndex(tree);
  return { tree, index, paths: allPaths(tree) };
}

export const useRepoStore = create<RepoState>((set, get) => {
  /**
   * Applies a structural change: records undo, rebuilds the index, queues a
   * save. Every mutation funnels through here so none of that can be forgotten.
   */
  const commit = (
    nextTree: FileNode[],
    extra: Partial<RepoState> = {},
  ) => {
    const state = get();
    if (nextTree === state.tree) return;

    const snapshot: Snapshot = { tree: state.tree, selectedPath: state.selectedPath };
    const undoStack = [...state.undoStack, snapshot].slice(-UNDO_LIMIT);

    set({ ...derive(nextTree), undoStack, redoStack: [], ...extra });

    const { user } = get();
    if (user) persistence.save(user.uid, nextTree);
  };

  const restore = (snapshot: Snapshot, counterpart: 'undoStack' | 'redoStack') => {
    const state = get();
    const current: Snapshot = { tree: state.tree, selectedPath: state.selectedPath };
    set({
      ...derive(snapshot.tree),
      selectedPath: snapshot.selectedPath,
      [counterpart]: [...state[counterpart], current].slice(-UNDO_LIMIT),
    } as Partial<RepoState>);

    const { user } = get();
    if (user) persistence.save(user.uid, snapshot.tree);
  };

  return {
    tree: [],
    index: new Map(),
    paths: [],
    baseline: null,
    expanded: new Set<string>(),
    selectedPath: null,
    contentVersion: 0,
    user: null,
    saveStatus: { state: 'idle' },
    undoStack: [],
    redoStack: [],
    pendingChatPrompt: null,

    setSelectedPath: (path) => set({ selectedPath: path }),

    toggleExpanded: (path) => {
      const expanded = new Set(get().expanded);
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      set({ expanded });
    },

    setExpanded: (paths) => set({ expanded: new Set(paths) }),

    expandAll: () => {
      const folders = get()
        .paths.filter((p) => get().index.get(p)?.type === 'folder');
      set({ expanded: new Set(folders) });
    },

    collapseAll: () => set({ expanded: new Set() }),

    revealPath: (path) => {
      const expanded = new Set(get().expanded);
      for (const ancestor of ancestorPaths(path)) expanded.add(ancestor);
      set({ expanded, selectedPath: path });
    },

    addNode: (path, type, content) => {
      const target = normalizePath(path);
      const { tree, created } = addPath(get().tree, target, type);
      if (created.length === 0) {
        // Path already existed; an explicit content payload still applies.
        if (content !== undefined && type === 'file') contentStore.set(target, content);
        return;
      }

      if (content !== undefined && type === 'file') contentStore.set(target, content);

      const expanded = new Set(get().expanded);
      for (const ancestor of ancestorPaths(target)) expanded.add(ancestor);
      commit(tree, { expanded, contentVersion: get().contentVersion + 1 });
    },

    removeNode: (path) => {
      const target = normalizePath(path);
      const next = removePath(get().tree, target);
      if (next === null) return;

      contentStore.forget(target);

      const { selectedPath } = get();
      const expanded = new Set(
        Array.from(get().expanded).filter((p) => !isWithin(p, target)),
      );

      commit(next, {
        selectedPath: selectedPath && isWithin(selectedPath, target) ? null : selectedPath,
        expanded,
      });
    },

    moveNode: (sourcePath, targetFolderPath) => {
      const result = movePath(get().tree, sourcePath, targetFolderPath);
      if (!result) return;

      contentStore.remap(result.remapped);

      const expanded = new Set(
        Array.from(get().expanded).map((p) => result.remapped.get(p) ?? p),
      );
      for (const ancestor of ancestorPaths(
        result.remapped.get(normalizePath(sourcePath)) ?? sourcePath,
      )) {
        expanded.add(ancestor);
      }

      const { selectedPath } = get();
      commit(result.tree, {
        expanded,
        selectedPath: selectedPath ? result.remapped.get(selectedPath) ?? selectedPath : null,
      });
    },

    renameNode: (path, newName) => {
      const result = renamePath(get().tree, path, newName);
      if (!result) return;

      contentStore.remap(result.remapped);

      const expanded = new Set(
        Array.from(get().expanded).map((p) => result.remapped.get(p) ?? p),
      );
      const { selectedPath } = get();
      commit(result.tree, {
        expanded,
        selectedPath: selectedPath ? result.remapped.get(selectedPath) ?? selectedPath : null,
      });
    },

    /**
     * Applies a whole batch as one undoable step — the copilot proposes a set
     * of changes, and accepting them is a single decision.
     */
    applyDiffs: (diffs) => {
      let tree = get().tree;
      const expanded = new Set(get().expanded);
      let selectedPath = get().selectedPath;
      let touchedContent = false;

      for (const diff of diffs) {
        const target = normalizePath(diff.path);

        if (diff.action === 'add' || diff.action === 'update') {
          const existed = buildIndex(tree).has(target);

          if (!existed) {
            const result = addPath(tree, target, diff.type);
            tree = result.tree;
            for (const ancestor of ancestorPaths(target)) expanded.add(ancestor);
          }

          if (diff.content !== undefined && diff.type === 'file') {
            contentStore.set(target, diff.content);
            touchedContent = true;
          }
        } else if (diff.action === 'remove') {
          const next = removePath(tree, target);
          if (next !== null) {
            tree = next;
            contentStore.forget(target);
            touchedContent = true;
            if (selectedPath && isWithin(selectedPath, target)) selectedPath = null;
            for (const p of Array.from(expanded)) {
              if (isWithin(p, target)) expanded.delete(p);
            }
          }
        }
      }

      if (tree === get().tree) {
        if (touchedContent) set({ contentVersion: get().contentVersion + 1 });
        return;
      }

      commit(tree, {
        expanded,
        selectedPath,
        contentVersion: get().contentVersion + (touchedContent ? 1 : 0),
      });
    },

    writeFileContent: (path, content) => {
      contentStore.setSilently(path, content);
    },

    readFileContent: (path) => contentStore.get(path),

    loadFileContent: (path) => contentStore.load(path),

    isFileReadable: (path) => contentStore.isReadable(path),

    loadMockData: () => {
      contentStore.clear();

      const files: Array<[string, NodeType, string?]> = [
        ['/src/components/Button.tsx', 'file', 'export const Button = () => <button>Click me</button>;\n'],
        ['/src/components/Header.tsx', 'file', 'export const Header = () => <header>App Header</header>;\n'],
        ['/src/App.tsx', 'file', 'export default function App() {\n  return <div>App</div>;\n}\n'],
        ['/src/main.tsx', 'file', 'import { createRoot } from "react-dom/client";\n'],
        ['/package.json', 'file', '{\n  "name": "mock-repo",\n  "version": "1.0.0"\n}\n'],
        ['/README.md', 'file', '# Mock Repo\n\nA sample tree for trying out moves and exports.\n'],
      ];

      let tree: FileNode[] = [];
      for (const [path, type, content] of files) {
        tree = addPath(tree, path, type).tree;
        if (content !== undefined) contentStore.set(path, content);
      }

      set({
        ...derive(tree),
        baseline: tree,
        expanded: new Set(['/src', '/src/components']),
        selectedPath: null,
        undoStack: [],
        redoStack: [],
        contentVersion: get().contentVersion + 1,
      });

      const { user } = get();
      if (user) persistence.save(user.uid, tree);
    },

    setLocalFolder: (tree, sources) => {
      contentStore.clear();
      contentStore.setSources(sources);

      const topLevelFolders = tree.filter((n) => n.type === 'folder').map((n) => n.path);

      set({
        ...derive(tree),
        baseline: tree,
        expanded: new Set(topLevelFolders),
        selectedPath: null,
        undoStack: [],
        redoStack: [],
        contentVersion: get().contentVersion + 1,
      });

      const { user } = get();
      if (user) persistence.save(user.uid, tree);
    },

    resetToBaseline: () => {
      const { baseline } = get();
      if (!baseline) return;
      commit(baseline, { selectedPath: null });
    },

    undo: () => {
      const { undoStack } = get();
      const snapshot = undoStack[undoStack.length - 1];
      if (!snapshot) return;
      set({ undoStack: undoStack.slice(0, -1) });
      restore(snapshot, 'redoStack');
    },

    redo: () => {
      const { redoStack } = get();
      const snapshot = redoStack[redoStack.length - 1];
      if (!snapshot) return;
      set({ redoStack: redoStack.slice(0, -1) });
      restore(snapshot, 'undoStack');
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,

    setUser: (user) => {
      set({ user });
      if (!user) persistence.cancel();
    },

    setSaveStatus: (saveStatus) => set({ saveStatus }),

    setPendingChatPrompt: (pendingChatPrompt) => set({ pendingChatPrompt }),
  };
});

/** Adopts a tree loaded from Firestore as the new baseline. */
export function adoptLoadedTree(tree: FileNode[]): void {
  useRepoStore.setState({
    ...derive(tree),
    baseline: tree,
    expanded: new Set(tree.filter((n) => n.type === 'folder').map((n) => n.path)),
    selectedPath: null,
    undoStack: [],
    redoStack: [],
  });
}

export { makeId, basename };
