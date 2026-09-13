/**
 * Path-addressed tree operations with structural sharing.
 *
 * Every mutation returns a new root array, but only copies the nodes along the
 * affected path — untouched subtrees keep their identity. That keeps `add`,
 * `remove` and `move` O(depth) instead of O(tree), and lets React skip
 * re-rendering any branch that did not change.
 *
 * File *content* deliberately does not live on the node (see `contents` in the
 * store). Editing a file must never touch the tree.
 */

export type NodeType = 'file' | 'folder';

export interface FileNode {
  /** Stable identity, survives moves. The diff engine pairs nodes by this. */
  id: string;
  /** Absolute path, always leading-slash, never trailing. Unique in the tree. */
  path: string;
  /** Last path segment. */
  name: string;
  type: NodeType;
  /** Present on folders only. Files have no `children` key at all. */
  children?: FileNode[];
}

let idCounter = 0;

/** Monotonic, collision-free within a session. Not persisted across reloads. */
export function makeId(prefix = 'n'): string {
  idCounter += 1;
  return `${prefix}${idCounter.toString(36)}`;
}

/** Normalises to a leading slash with no trailing slash. Root is `/`. */
export function normalizePath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

export function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function parentPath(path: string): string {
  const parts = pathSegments(path);
  parts.pop();
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

export function basename(path: string): string {
  const parts = pathSegments(path);
  return parts[parts.length - 1] ?? '';
}

/** True when `path` is `ancestor` itself or sits underneath it. */
export function isWithin(path: string, ancestor: string): boolean {
  if (ancestor === '/') return true;
  return path === ancestor || path.startsWith(ancestor + '/');
}

/** Folders before files, then case-insensitive by name. */
export function compareNodes(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function sortedInsert(list: readonly FileNode[], node: FileNode): FileNode[] {
  const next = [...list];
  let i = 0;
  while (i < next.length && compareNodes(next[i], node) < 0) i += 1;
  next.splice(i, 0, node);
  return next;
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export type TreeIndex = ReadonlyMap<string, FileNode>;

/**
 * Builds a path -> node lookup. Rebuilt only when the tree structure changes,
 * so component selectors can resolve a path in O(1) instead of walking.
 */
export function buildIndex(tree: readonly FileNode[]): Map<string, FileNode> {
  const index = new Map<string, FileNode>();
  const walk = (nodes: readonly FileNode[]) => {
    for (const node of nodes) {
      index.set(node.path, node);
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return index;
}

// ---------------------------------------------------------------------------
// Mutations — each returns a new root, sharing every untouched subtree
// ---------------------------------------------------------------------------

/**
 * Replaces the child list of the folder at `targetPath` using `update`,
 * copying only the spine from the root down to that folder.
 * Returns the original root unchanged if the folder does not exist, or if
 * `update` returns the identical array.
 */
function updateFolder(
  tree: readonly FileNode[],
  targetPath: string,
  update: (children: readonly FileNode[]) => FileNode[] | null,
): FileNode[] | null {
  if (targetPath === '/') {
    const next = update(tree);
    return next === null || next === tree ? null : next;
  }

  const segments = pathSegments(targetPath);

  const recurse = (
    nodes: readonly FileNode[],
    depth: number,
  ): FileNode[] | null => {
    const wanted = segments[depth];
    const index = nodes.findIndex((n) => n.name === wanted && n.type === 'folder');
    if (index === -1) return null;

    const node = nodes[index];
    const isTarget = depth === segments.length - 1;

    const nextChildren = isTarget
      ? update(node.children ?? [])
      : recurse(node.children ?? [], depth + 1);

    if (nextChildren === null || nextChildren === node.children) return null;

    const copy = [...nodes];
    copy[index] = { ...node, children: nextChildren };
    return copy;
  };

  return recurse(tree, 0);
}

/** Re-points a subtree at a new base path, copying every node whose path moves. */
function rebase(node: FileNode, newPath: string): FileNode {
  const moved: FileNode = { ...node, path: newPath, name: basename(newPath) };
  if (node.children) {
    moved.children = node.children.map((child) =>
      rebase(child, `${newPath}/${child.name}`),
    );
  }
  return moved;
}

export interface AddResult {
  tree: FileNode[];
  /** Nodes actually created, parents first. Empty when the path already existed. */
  created: FileNode[];
}

/**
 * Creates `path`, plus any missing intermediate folders. Existing nodes are
 * left alone, so this is safe to call repeatedly with overlapping paths.
 */
export function addPath(
  tree: readonly FileNode[],
  path: string,
  type: NodeType,
): AddResult {
  const target = normalizePath(path);
  if (target === '/') return { tree: tree as FileNode[], created: [] };

  const segments = pathSegments(target);
  const created: FileNode[] = [];

  const recurse = (nodes: readonly FileNode[], depth: number, prefix: string): FileNode[] => {
    const name = segments[depth];
    const isLast = depth === segments.length - 1;
    const childPath = `${prefix}/${name}`;
    const existingIndex = nodes.findIndex((n) => n.name === name);

    if (existingIndex === -1) {
      const nodeType: NodeType = isLast ? type : 'folder';
      const node: FileNode = {
        id: makeId(),
        path: childPath,
        name,
        type: nodeType,
        ...(nodeType === 'folder' ? { children: [] as FileNode[] } : {}),
      };
      created.push(node);
      if (!isLast) {
        node.children = recurse([], depth + 1, childPath);
      }
      return sortedInsert(nodes, node);
    }

    if (isLast) return nodes as FileNode[];

    const existing = nodes[existingIndex];
    if (existing.type !== 'folder') return nodes as FileNode[];

    const nextChildren = recurse(existing.children ?? [], depth + 1, childPath);
    if (nextChildren === existing.children) return nodes as FileNode[];

    const copy = [...nodes];
    copy[existingIndex] = { ...existing, children: nextChildren };
    return copy;
  };

  const next = recurse(tree, 0, '');
  return { tree: next, created };
}

/**
 * Builds a whole tree from a path list in one pass.
 *
 * `addPath` is the right shape for a single change — it shares structure with
 * the tree it came from — but calling it once per path is quadratic when a
 * folder holds thousands of direct children, because each insert copies and
 * re-scans that folder's child array. Bulk ingest groups through a lookup map
 * and sorts each level once at the end instead.
 */
export function buildTreeFromPaths(
  entries: Iterable<{ path: string; type: NodeType }>,
): FileNode[] {
  const roots: FileNode[] = [];
  const byPath = new Map<string, FileNode>();

  for (const entry of entries) {
    const target = normalizePath(entry.path);
    if (target === '/') continue;

    const segments = pathSegments(target);
    let prefix = '';
    let siblings = roots;

    for (let i = 0; i < segments.length; i += 1) {
      const name = segments[i];
      const isLast = i === segments.length - 1;
      prefix += `/${name}`;

      let node = byPath.get(prefix);
      if (!node) {
        const type: NodeType = isLast ? entry.type : 'folder';
        node = {
          id: makeId(),
          path: prefix,
          name,
          type,
          ...(type === 'folder' ? { children: [] as FileNode[] } : {}),
        };
        byPath.set(prefix, node);
        siblings.push(node);
      }

      if (isLast) break;
      if (node.type !== 'folder') break;
      if (!node.children) node.children = [];
      siblings = node.children;
    }
  }

  const sortAll = (nodes: FileNode[]) => {
    nodes.sort(compareNodes);
    for (const node of nodes) if (node.children) sortAll(node.children);
  };
  sortAll(roots);

  return roots;
}

/** Removes the node at `path` and everything under it. */
export function removePath(
  tree: readonly FileNode[],
  path: string,
): FileNode[] | null {
  const target = normalizePath(path);
  if (target === '/') return null;

  return updateFolder(tree, parentPath(target), (children) => {
    const index = children.findIndex((n) => n.path === target);
    if (index === -1) return null;
    const next = [...children];
    next.splice(index, 1);
    return next;
  });
}

export interface MoveResult {
  tree: FileNode[];
  /** Old path -> new path for the moved node and every descendant. */
  remapped: Map<string, string>;
}

/**
 * Moves `sourcePath` into the folder `targetFolderPath`, keeping node ids so
 * the diff engine reports a move rather than a delete plus an add.
 *
 * Refuses no-ops, moves into self, and moves into own descendant. Refuses a
 * move that would collide with an existing name in the target.
 */
export function movePath(
  tree: readonly FileNode[],
  sourcePath: string,
  targetFolderPath: string,
): MoveResult | null {
  const source = normalizePath(sourcePath);
  const target = normalizePath(targetFolderPath);

  if (source === '/') return null;
  if (isWithin(target, source)) return null;
  if (parentPath(source) === target) return null;

  const index = buildIndex(tree);
  const node = index.get(source);
  if (!node) return null;

  if (target !== '/') {
    const targetNode = index.get(target);
    if (!targetNode || targetNode.type !== 'folder') return null;
  }

  const newPath = target === '/' ? `/${node.name}` : `${target}/${node.name}`;
  if (index.has(newPath)) return null;

  const detached = removePath(tree, source);
  if (detached === null) return null;

  const moved = rebase(node, newPath);

  const attached = updateFolder(detached, target, (children) => sortedInsert(children, moved));
  if (attached === null) return null;

  const remapped = new Map<string, string>();
  const walk = (from: FileNode, to: FileNode) => {
    remapped.set(from.path, to.path);
    if (from.children && to.children) {
      from.children.forEach((child, i) => walk(child, to.children![i]));
    }
  };
  walk(node, moved);

  return { tree: attached, remapped };
}

/** Renames the node at `path` in place, keeping its id and its children. */
export function renamePath(
  tree: readonly FileNode[],
  path: string,
  newName: string,
): MoveResult | null {
  const source = normalizePath(path);
  const name = newName.trim();
  if (source === '/' || !name || name.includes('/')) return null;

  const parent = parentPath(source);
  const newPath = parent === '/' ? `/${name}` : `${parent}/${name}`;
  if (newPath === source) return null;

  const index = buildIndex(tree);
  const node = index.get(source);
  if (!node || index.has(newPath)) return null;

  const renamed = rebase(node, newPath);

  const next = updateFolder(tree, parent, (children) => {
    const at = children.findIndex((n) => n.path === source);
    if (at === -1) return null;
    const without = [...children];
    without.splice(at, 1);
    return sortedInsert(without, renamed);
  });
  if (next === null) return null;

  const remapped = new Map<string, string>();
  const walk = (from: FileNode, to: FileNode) => {
    remapped.set(from.path, to.path);
    if (from.children && to.children) {
      from.children.forEach((child, i) => walk(child, to.children![i]));
    }
  };
  walk(node, renamed);

  return { tree: next, remapped };
}

// ---------------------------------------------------------------------------
// Flattening for virtualised rendering
// ---------------------------------------------------------------------------

export interface FlatRow {
  node: FileNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
}

/**
 * Produces the visible row list in render order, skipping collapsed subtrees.
 * The virtualiser only ever needs this array plus a row height.
 */
export function flattenVisible(
  tree: readonly FileNode[],
  expanded: ReadonlySet<string>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (nodes: readonly FileNode[], depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.type === 'folder';
      const isExpanded = hasChildren && expanded.has(node.path);
      rows.push({ node, depth, expanded: isExpanded, hasChildren });
      if (isExpanded && node.children?.length) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(tree, 0);
  return rows;
}

/** Every ancestor folder path of `path`, root-first. Used to reveal a match. */
export function ancestorPaths(path: string): string[] {
  const segments = pathSegments(path);
  const out: string[] = [];
  let acc = '';
  for (let i = 0; i < segments.length - 1; i += 1) {
    acc += `/${segments[i]}`;
    out.push(acc);
  }
  return out;
}

/** Flat list of every path in the tree. Cheap substring search target. */
export function allPaths(tree: readonly FileNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly FileNode[]) => {
    for (const node of nodes) {
      out.push(node.path);
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return out;
}
