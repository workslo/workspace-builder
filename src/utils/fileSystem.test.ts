import { describe, expect, it } from 'vitest';
import { IGNORED_DIRS, isLockFile, parseDirectoryHandle, parseFileList } from './fileSystem';
import { allPaths } from '../store/treeOps';

/** Minimal stand-in for the FileList a `webkitdirectory` input produces. */
function fileList(paths: string[]): FileList {
  const files = paths.map((path) => ({
    name: path.split('/').pop()!,
    webkitRelativePath: path,
    text: async () => `content of ${path}`,
  }));
  return Object.assign(files, { item: (i: number) => files[i] }) as unknown as FileList;
}

/** Minimal stand-in for a FileSystemDirectoryHandle. */
function dirHandle(entries: Record<string, unknown>): {
  values: () => AsyncIterable<{ kind: string; name: string }>;
} {
  const items = Object.entries(entries).map(([name, value]) =>
    typeof value === 'object' && value !== null && !('__file' in value)
      ? { kind: 'directory', name, ...dirHandle(value as Record<string, unknown>) }
      : { kind: 'file', name },
  );
  return {
    async *values() {
      for (const item of items) yield item as { kind: string; name: string };
    },
  };
}

const FILE = { __file: true };

describe('isLockFile', () => {
  it('matches known lockfiles regardless of case', () => {
    expect(isLockFile('package-lock.json')).toBe(true);
    expect(isLockFile('YARN.LOCK')).toBe(true);
    expect(isLockFile('Cargo.lock')).toBe(true);
    expect(isLockFile('bun.lockb')).toBe(true);
  });

  it('leaves ordinary files alone', () => {
    expect(isLockFile('index.ts')).toBe(false);
    expect(isLockFile('lockfile.ts')).toBe(false);
  });
});

describe('parseFileList', () => {
  it('strips the chosen directory so paths start at the repo root', () => {
    const result = parseFileList(fileList(['my-repo/src/index.ts', 'my-repo/README.md']));
    expect(allPaths(result.nodes)).toEqual(['/src', '/src/index.ts', '/README.md']);
  });

  it('records a source for every file, so contents load lazily', () => {
    const result = parseFileList(fileList(['repo/src/a.ts', 'repo/b.ts']));
    expect(Array.from(result.sources.keys()).sort()).toEqual(['/b.ts', '/src/a.ts']);
  });

  it('does not eagerly read any file content', () => {
    const result = parseFileList(fileList(['repo/a.ts']));
    const node = result.nodes.find((n) => n.path === '/a.ts')!;
    expect('content' in node).toBe(false);
  });

  it('skips ignored directories at any depth', () => {
    const result = parseFileList(
      fileList([
        'repo/src/a.ts',
        'repo/node_modules/pkg/index.js',
        'repo/src/.git/config',
        'repo/dist/bundle.js',
      ]),
    );
    const paths = allPaths(result.nodes);
    expect(paths).toEqual(['/src', '/src/a.ts']);
  });

  it('skips lockfiles', () => {
    const result = parseFileList(fileList(['repo/package.json', 'repo/package-lock.json']));
    expect(allPaths(result.nodes)).toEqual(['/package.json']);
  });

  it('sorts folders before files, then by name, at every level', () => {
    const result = parseFileList(
      fileList(['repo/zeta.ts', 'repo/alpha.ts', 'repo/src/b.ts', 'repo/src/a.ts']),
    );
    expect(result.nodes.map((n) => n.name)).toEqual(['src', 'alpha.ts', 'zeta.ts']);
    expect(result.nodes[0].children!.map((n) => n.name)).toEqual(['a.ts', 'b.ts']);
  });

  it('gives every node a distinct id', () => {
    const result = parseFileList(fileList(['repo/a.ts', 'repo/src/b.ts', 'repo/src/c.ts']));
    const ids: string[] = [];
    const walk = (nodes: typeof result.nodes) => {
      for (const n of nodes) {
        ids.push(n.id);
        if (n.children) walk(n.children);
      }
    };
    walk(result.nodes);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('handles a single file with no directory prefix', () => {
    const result = parseFileList(fileList(['solo.ts']));
    expect(allPaths(result.nodes)).toEqual(['/solo.ts']);
  });
});

describe('parseDirectoryHandle', () => {
  it('walks nested directories into a tree', async () => {
    const result = await parseDirectoryHandle(
      dirHandle({
        src: { 'index.ts': FILE, components: { 'Button.tsx': FILE } },
        'README.md': FILE,
      }),
    );

    expect(allPaths(result.nodes)).toEqual([
      '/src',
      '/src/components',
      '/src/components/Button.tsx',
      '/src/index.ts',
      '/README.md',
    ]);
  });

  it('skips ignored directories and lockfiles', async () => {
    const result = await parseDirectoryHandle(
      dirHandle({
        src: { 'a.ts': FILE },
        node_modules: { pkg: { 'index.js': FILE } },
        'yarn.lock': FILE,
      }),
    );
    expect(allPaths(result.nodes)).toEqual(['/src', '/src/a.ts']);
  });

  it('maps every file path to its handle for lazy reads', async () => {
    const result = await parseDirectoryHandle(dirHandle({ src: { 'a.ts': FILE } }));
    expect(result.sources.has('/src/a.ts')).toBe(true);
    expect(result.sources.has('/src')).toBe(false);
  });

  it('ignores the usual build and dependency directories', () => {
    for (const dir of ['node_modules', '.git', 'dist', 'build', '.next', 'coverage']) {
      expect(IGNORED_DIRS.has(dir)).toBe(true);
    }
  });
});
