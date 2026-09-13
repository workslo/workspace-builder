export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

export interface TreeDiff {
  action: 'add' | 'remove' | 'update';
  path: string;
  type: 'file' | 'folder';
}

export type RootState = {
  tree: FileNode[];
  setTree: (tree: FileNode[]) => void;
  loadMockRepo: () => void;
  applyDiffs: (diffs: TreeDiff[]) => void;
};
