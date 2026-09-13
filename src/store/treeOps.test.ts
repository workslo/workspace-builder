import { describe, expect, it } from 'vitest';
import {
  addPath,
  allPaths,
  buildTreeFromPaths,
  ancestorPaths,
  buildIndex,
  flattenVisible,
  isWithin,
  movePath,
  normalizePath,
  removePath,
  renamePath,
  type FileNode,
} from './treeOps';

function build(paths: Array<[string, 'file' | 'folder']>): FileNode[] {
  let tree: FileNode[] = [];
  for (const [path, type] of paths) tree = addPath(tree, path, type).tree;
  return tree;
}

const sample = (): FileNode[] =>
  build([
    ['/src/components/Button.tsx', 'file'],
    ['/src/components/Header.tsx', 'file'],
    ['/src/utils/format.ts', 'file'],
    ['/src/App.tsx', 'file'],
    ['/README.md', 'file'],
  ]);

describe('path helpers', () => {
  it('normalises leading and trailing slashes', () => {
    expect(normalizePath('src/lib/')).toBe('/src/lib');
    expect(normalizePath('//src//lib//')).toBe('/src/lib');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });

  it('treats every path as within root, and a path as within itself', () => {
    expect(isWithin('/src/a.ts', '/')).toBe(true);
    expect(isWithin('/src', '/src')).toBe(true);
    expect(isWithin('/src/a.ts', '/src')).toBe(true);
  });

  it('does not treat a sibling with a shared prefix as nested', () => {
    expect(isWithin('/srcfoo/a.ts', '/src')).toBe(false);
  });

  it('lists ancestors root-first, excluding the path itself', () => {
    expect(ancestorPaths('/a/b/c.ts')).toEqual(['/a', '/a/b']);
    expect(ancestorPaths('/a.ts')).toEqual([]);
  });
});

describe('addPath', () => {
  it('creates missing intermediate folders', () => {
    const { tree, created } = addPath([], '/src/lib/api.ts', 'file');
    expect(allPaths(tree)).toEqual(['/src', '/src/lib', '/src/lib/api.ts']);
    expect(created.map((n) => n.path)).toEqual(['/src', '/src/lib', '/src/lib/api.ts']);
  });

  it('gives files no children key and folders an array', () => {
    const index = buildIndex(addPath([], '/src/a.ts', 'file').tree);
    expect(index.get('/src/a.ts')!.children).toBeUndefined();
    expect(index.get('/src')!.children).toEqual([expect.objectContaining({ path: '/src/a.ts' })]);
  });

  it('is a no-op for a path that already exists', () => {
    const tree = sample();
    const { tree: next, created } = addPath(tree, '/src/App.tsx', 'file');
    expect(created).toEqual([]);
    expect(next).toBe(tree);
  });

  it('keeps folders before files and sorts by name', () => {
    const tree = build([
      ['/zeta.ts', 'file'],
      ['/alpha.ts', 'file'],
      ['/src/a.ts', 'file'],
    ]);
    expect(tree.map((n) => n.name)).toEqual(['src', 'alpha.ts', 'zeta.ts']);
  });

  it('refuses to add a child under an existing file', () => {
    const tree = build([['/src/a.ts', 'file']]);
    const { tree: next } = addPath(tree, '/src/a.ts/nested.ts', 'file');
    expect(allPaths(next)).not.toContain('/src/a.ts/nested.ts');
  });
});

describe('structural sharing', () => {
  it('keeps the identity of subtrees an add did not touch', () => {
    const tree = sample();
    const componentsBefore = buildIndex(tree).get('/src/components')!;

    const next = addPath(tree, '/src/utils/parse.ts', 'file').tree;
    const componentsAfter = buildIndex(next).get('/src/components')!;

    // The sibling subtree is the *same object*, so React can skip it entirely.
    expect(componentsAfter).toBe(componentsBefore);
    expect(next).not.toBe(tree);
  });

  it('keeps untouched subtrees identical across a remove', () => {
    const tree = sample();
    const componentsBefore = buildIndex(tree).get('/src/components')!;
    const next = removePath(tree, '/src/utils/format.ts')!;
    expect(buildIndex(next).get('/src/components')).toBe(componentsBefore);
  });

  it('keeps untouched subtrees identical across a move', () => {
    const tree = sample();
    const utilsBefore = buildIndex(tree).get('/src/utils')!;
    const result = movePath(tree, '/README.md', '/src')!;
    expect(buildIndex(result.tree).get('/src/utils')).toBe(utilsBefore);
  });
});

describe('removePath', () => {
  it('removes a folder and everything beneath it', () => {
    const next = removePath(sample(), '/src/components')!;
    expect(allPaths(next)).toEqual(['/src', '/src/utils', '/src/utils/format.ts', '/src/App.tsx', '/README.md']);
  });

  it('returns null for a path that does not exist', () => {
    expect(removePath(sample(), '/nope.ts')).toBeNull();
  });

  it('refuses to remove the root', () => {
    expect(removePath(sample(), '/')).toBeNull();
  });
});

describe('movePath', () => {
  it('moves a file and re-points its path', () => {
    const result = movePath(sample(), '/src/App.tsx', '/src/components')!;
    const paths = allPaths(result.tree);
    expect(paths).toContain('/src/components/App.tsx');
    expect(paths).not.toContain('/src/App.tsx');
  });

  it('preserves node ids so the diff reads as a move', () => {
    const tree = sample();
    const idBefore = buildIndex(tree).get('/src/App.tsx')!.id;
    const result = movePath(tree, '/src/App.tsx', '/src/components')!;
    expect(buildIndex(result.tree).get('/src/components/App.tsx')!.id).toBe(idBefore);
  });

  it('re-points every descendant and reports the remap', () => {
    const result = movePath(sample(), '/src/components', '/')!;
    expect(allPaths(result.tree)).toContain('/components/Button.tsx');
    expect(result.remapped.get('/src/components/Button.tsx')).toBe('/components/Button.tsx');
    expect(result.remapped.get('/src/components')).toBe('/components');
  });

  it('refuses to move a folder into itself or its own descendant', () => {
    expect(movePath(sample(), '/src', '/src')).toBeNull();
    expect(movePath(sample(), '/src', '/src/components')).toBeNull();
  });

  it('refuses a move that would collide with an existing name', () => {
    const tree = build([
      ['/a/config.ts', 'file'],
      ['/b/config.ts', 'file'],
    ]);
    expect(movePath(tree, '/a/config.ts', '/b')).toBeNull();
  });

  it('refuses a move into a file', () => {
    expect(movePath(sample(), '/README.md', '/src/App.tsx')).toBeNull();
  });

  it('treats a move into the current parent as a no-op', () => {
    expect(movePath(sample(), '/src/App.tsx', '/src')).toBeNull();
  });

  it('moves to the root', () => {
    const result = movePath(sample(), '/src/App.tsx', '/')!;
    expect(allPaths(result.tree)).toContain('/App.tsx');
  });
});

describe('renamePath', () => {
  it('renames in place, keeping the id', () => {
    const tree = sample();
    const idBefore = buildIndex(tree).get('/src/App.tsx')!.id;
    const result = renamePath(tree, '/src/App.tsx', 'Root.tsx')!;
    const renamed = buildIndex(result.tree).get('/src/Root.tsx')!;
    expect(renamed.id).toBe(idBefore);
    expect(renamed.name).toBe('Root.tsx');
  });

  it('re-points descendants when a folder is renamed', () => {
    const result = renamePath(sample(), '/src/components', 'ui')!;
    expect(allPaths(result.tree)).toContain('/src/ui/Button.tsx');
    expect(result.remapped.get('/src/components/Button.tsx')).toBe('/src/ui/Button.tsx');
  });

  it('rejects a name that collides, is empty, or contains a slash', () => {
    const tree = sample();
    expect(renamePath(tree, '/src/components/Button.tsx', 'Header.tsx')).toBeNull();
    expect(renamePath(tree, '/src/App.tsx', '   ')).toBeNull();
    expect(renamePath(tree, '/src/App.tsx', 'a/b.tsx')).toBeNull();
  });
});

describe('flattenVisible', () => {
  it('only descends into expanded folders', () => {
    const tree = sample();
    expect(flattenVisible(tree, new Set()).map((r) => r.node.path)).toEqual([
      '/src',
      '/README.md',
    ]);

    const opened = flattenVisible(tree, new Set(['/src'])).map((r) => r.node.path);
    expect(opened).toEqual([
      '/src',
      '/src/components',
      '/src/utils',
      '/src/App.tsx',
      '/README.md',
    ]);
  });

  it('reports depth for indentation', () => {
    const rows = flattenVisible(sample(), new Set(['/src', '/src/components']));
    const button = rows.find((r) => r.node.path === '/src/components/Button.tsx')!;
    expect(button.depth).toBe(2);
  });
});

describe('buildTreeFromPaths', () => {
  it('produces the same tree as repeated addPath calls', () => {
    const entries = [
      { path: '/src/components/Button.tsx', type: 'file' as const },
      { path: '/src/components/Header.tsx', type: 'file' as const },
      { path: '/src/utils/format.ts', type: 'file' as const },
      { path: '/src/App.tsx', type: 'file' as const },
      { path: '/README.md', type: 'file' as const },
    ];
    expect(allPaths(buildTreeFromPaths(entries))).toEqual(allPaths(sample()));
  });

  it('sorts folders before files at every level', () => {
    const tree = buildTreeFromPaths([
      { path: '/zeta.ts', type: 'file' },
      { path: '/alpha.ts', type: 'file' },
      { path: '/src/b.ts', type: 'file' },
      { path: '/src/a.ts', type: 'file' },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['src', 'alpha.ts', 'zeta.ts']);
    expect(tree[0].children!.map((n) => n.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('gives every node a distinct id', () => {
    const tree = buildTreeFromPaths([
      { path: '/a/b/c.ts', type: 'file' },
      { path: '/a/d.ts', type: 'file' },
    ]);
    const ids = allPaths(tree).map((p) => buildIndex(tree).get(p)!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates an explicitly requested empty folder', () => {
    const tree = buildTreeFromPaths([{ path: '/empty', type: 'folder' }]);
    expect(tree[0]).toMatchObject({ path: '/empty', type: 'folder', children: [] });
  });

  it('stays linear on a folder holding thousands of direct children', () => {
    // Guards the quadratic insert this function exists to avoid: building this
    // one path at a time through addPath took minutes.
    const entries = Array.from({ length: 20000 }, (_, i) => ({
      path: `/generated/file${i}.ts`,
      type: 'file' as const,
    }));

    const started = Date.now();
    const tree = buildTreeFromPaths(entries);
    const elapsed = Date.now() - started;

    expect(tree[0].children!.length).toBe(20000);
    expect(elapsed).toBeLessThan(3000);
  });
});
