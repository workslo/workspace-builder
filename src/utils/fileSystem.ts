/**
 * Reads a real directory off disk into a tree.
 *
 * Only structure is read eagerly — file bodies stay behind their handles until
 * something asks for one. Opening a large repo should cost a directory walk,
 * not a full read of every file in it.
 */

import { compareNodes, makeId, type FileNode } from '../store/treeOps';
import type { FileSource } from '../store/contentStore';

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'out',
  '.output',
  '.nuxt',
  '.svelte-kit',
  '.parcel-cache',
  '.docusaurus',
  '.yarn',
  '.venv',
  '__pycache__',
  'vendor',
  'target',
  'coverage',
]);

const LOCK_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'composer.lock',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  'go.sum',
]);

export function isLockFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return LOCK_FILES.has(lower) || lower.endsWith('.lock') || lower.endsWith('.lockb');
}

export interface ParseResult {
  nodes: FileNode[];
  sources: Map<string, FileSource>;
}

const MAX_DEPTH = 25;

/** Recursively walks a `FileSystemDirectoryHandle` from `showDirectoryPicker`. */
export async function parseDirectoryHandle(
  dirHandle: {
    values?: () => AsyncIterable<{ kind: string; name: string }>;
    entries?: () => AsyncIterable<[string, { kind: string; name: string }]>;
  },
  currentPath = '',
  depth = 0,
): Promise<ParseResult> {
  const nodes: FileNode[] = [];
  const sources = new Map<string, FileSource>();

  if (depth > MAX_DEPTH) return { nodes, sources };

  try {
    const entries: Array<{ kind: string; name: string }> = [];
    if (typeof dirHandle.values === 'function') {
      for await (const entry of dirHandle.values()) entries.push(entry);
    } else if (typeof dirHandle.entries === 'function') {
      for await (const [, entry] of dirHandle.entries()) entries.push(entry);
    }

    for (const entry of entries) {
      const name = entry.name;
      if (!name) continue;

      if (entry.kind === 'directory') {
        if (IGNORED_DIRS.has(name.toLowerCase())) continue;
        const folderPath = `${currentPath}/${name}`;
        const sub = await parseDirectoryHandle(entry as never, folderPath, depth + 1);
        nodes.push({
          id: makeId(),
          path: folderPath,
          name,
          type: 'folder',
          children: sub.nodes,
        });
        for (const [path, source] of sub.sources) sources.set(path, source);
      } else if (entry.kind === 'file') {
        if (isLockFile(name)) continue;
        const filePath = `${currentPath}/${name}`;
        nodes.push({ id: makeId(), path: filePath, name, type: 'file' });
        sources.set(filePath, entry as unknown as FileSource);
      }
    }
  } catch (err) {
    console.error('Error reading directory handle:', err);
  }

  nodes.sort(compareNodes);
  return { nodes, sources };
}

/**
 * Parses a `FileList` from `<input webkitdirectory>` — the fallback path.
 *
 * Nodes are found through a path map rather than scanning each level's child
 * array, so a folder holding thousands of files costs a lookup per segment
 * instead of a linear scan per segment.
 */
export function parseFileList(files: FileList): ParseResult {
  const sources = new Map<string, FileSource>();
  const rootNodes: FileNode[] = [];
  const byPath = new Map<string, FileNode>();

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const relativePath = file.webkitRelativePath || file.name;
    const parts = relativePath.split('/').filter(Boolean);

    // The first segment is the directory the user picked; strip it so paths
    // are relative to the repo root rather than to wherever it happens to sit.
    const segments = parts.length > 1 ? parts.slice(1) : parts;
    if (segments.length === 0) continue;

    const dirSegments = segments.slice(0, -1);
    if (dirSegments.some((seg) => IGNORED_DIRS.has(seg.toLowerCase()))) continue;

    const fileName = segments[segments.length - 1];
    if (isLockFile(fileName)) continue;

    let level = rootNodes;
    let acc = '';

    for (let p = 0; p < segments.length; p += 1) {
      const part = segments[p];
      acc += `/${part}`;
      const isLast = p === segments.length - 1;

      let existing = byPath.get(acc);
      if (!existing) {
        existing = {
          id: makeId(),
          path: acc,
          name: part,
          type: isLast ? 'file' : 'folder',
          ...(isLast ? {} : { children: [] as FileNode[] }),
        };
        byPath.set(acc, existing);
        level.push(existing);
      }

      if (isLast) {
        sources.set(acc, file);
      } else {
        if (!existing.children) existing.children = [];
        level = existing.children;
      }
    }
  }

  const sortTree = (nodes: FileNode[]) => {
    nodes.sort(compareNodes);
    for (const node of nodes) if (node.children) sortTree(node.children);
  };
  sortTree(rootNodes);

  return { nodes: rootNodes, sources };
}
