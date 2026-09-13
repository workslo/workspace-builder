import { create } from 'zustand';
import { FileNode, RootState, TreeDiff } from './types';
import { v4 as uuidv4 } from 'uuid';

const initialTree: FileNode[] = [
  { id: uuidv4(), name: 'src', type: 'folder', children: [] }
];

const mockRepo: FileNode[] = [
  {
    id: uuidv4(),
    name: 'src',
    type: 'folder',
    children: [
      {
        id: uuidv4(),
        name: 'components',
        type: 'folder',
        children: [
          { id: uuidv4(), name: 'Button.tsx', type: 'file' },
          { id: uuidv4(), name: 'Header.tsx', type: 'file' }
        ]
      },
      {
        id: uuidv4(),
        name: 'hooks',
        type: 'folder',
        children: [
          { id: uuidv4(), name: 'useAuth.ts', type: 'file' }
        ]
      },
      { id: uuidv4(), name: 'App.tsx', type: 'file' },
      { id: uuidv4(), name: 'index.css', type: 'file' },
      { id: uuidv4(), name: 'main.tsx', type: 'file' }
    ]
  },
  { id: uuidv4(), name: 'public', type: 'folder', children: [{ id: uuidv4(), name: 'vite.svg', type: 'file' }] },
  { id: uuidv4(), name: 'package.json', type: 'file' },
  { id: uuidv4(), name: 'vite.config.ts', type: 'file' }
];

function ensurePathExistsInfo(tree: FileNode[], parts: string[], type: 'file' | 'folder'): FileNode[] {
  let currentArr = tree;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    let node = currentArr.find(n => n.name === part);
    
    if (!node) {
      node = {
        id: uuidv4(),
        name: part,
        type: isLast ? type : 'folder',
        ...(isLast && type === 'file' ? {} : { children: [] })
      };
      currentArr.push(node);
    }
    
    if (!isLast) {
      if (!node.children) node.children = [];
      currentArr = node.children;
    }
  }
  return tree;
}

function removePathFromTree(tree: FileNode[], parts: string[]): FileNode[] {
  if (parts.length === 0) return tree;
  if (parts.length === 1) {
    return tree.filter(n => n.name !== parts[0]);
  }
  
  const [current, ...rest] = parts;
  return tree.map(node => {
    if (node.name === current && node.children) {
      return { ...node, children: removePathFromTree(node.children, rest) };
    }
    return node;
  });
}

function cloneTree(tree: FileNode[]): FileNode[] {
  return tree.map(n => ({
    ...n,
    children: n.children ? cloneTree(n.children) : undefined
  }));
}

export const useStore = create<RootState>((set) => ({
  tree: initialTree,
  setTree: (tree) => set({ tree }),
  loadMockRepo: () => set({ tree: mockRepo }),
  applyDiffs: (diffs: TreeDiff[]) => set((state) => {
    let newTree = cloneTree(state.tree);
    
    for (const diff of diffs) {
      const parts = diff.path.split('/').filter(Boolean);
      if (diff.action === 'add') {
        newTree = ensurePathExistsInfo(newTree, parts, diff.type);
      } else if (diff.action === 'remove') {
        newTree = removePathFromTree(newTree, parts);
      }
      // 'update' could mean resolving conflicts, but add handles creating
    }
    
    return { tree: newTree };
  })
}));
