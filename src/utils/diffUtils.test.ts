import { describe, expect, it } from 'vitest';
import {
  computeRepoDiff,
  generateAgentPrompt,
  generateShellScript,
  type RepoDiff,
} from './diffUtils';
import { addPath, buildIndex, movePath, removePath, type FileNode } from '../store/treeOps';

function build(paths: Array<[string, 'file' | 'folder']>): FileNode[] {
  let tree: FileNode[] = [];
  for (const [path, type] of paths) tree = addPath(tree, path, type).tree;
  return tree;
}

const baseline = (): FileNode[] =>
  build([
    ['/src/components/Button.tsx', 'file'],
    ['/src/components/Header.tsx', 'file'],
    ['/src/App.tsx', 'file'],
    ['/README.md', 'file'],
  ]);

describe('computeRepoDiff', () => {
  it('reports nothing for an untouched tree', () => {
    const tree = baseline();
    expect(computeRepoDiff(tree, tree).totalCount).toBe(0);
  });

  it('reports nothing when there is no baseline', () => {
    expect(computeRepoDiff(null, baseline()).totalCount).toBe(0);
  });

  it('reports a drag as a move, not a delete plus an add', () => {
    const before = baseline();
    const after = movePath(before, '/src/App.tsx', '/src/components')!.tree;

    const diff = computeRepoDiff(before, after);
    expect(diff.totalCount).toBe(1);
    expect(diff.topLevelChanges[0]).toMatchObject({
      type: 'move',
      oldPath: '/src/App.tsx',
      path: '/src/components/App.tsx',
    });
  });

  it('reports an add', () => {
    const before = baseline();
    const after = addPath(before, '/src/lib/api.ts', 'file').tree;

    const diff = computeRepoDiff(before, after);
    const added = diff.changes.filter((c) => c.type === 'add').map((c) => c.path);
    expect(added).toContain('/src/lib');
    expect(added).toContain('/src/lib/api.ts');

    // Only the new folder is top level; its contents ride along with it.
    expect(diff.topLevelChanges.map((c) => c.path)).toEqual(['/src/lib']);
  });

  it('reports a delete', () => {
    const before = baseline();
    const after = removePath(before, '/README.md')!;
    expect(computeRepoDiff(before, after).topLevelChanges[0]).toMatchObject({
      type: 'delete',
      path: '/README.md',
    });
  });

  it('collapses children of a moved folder into the parent move', () => {
    const before = baseline();
    const after = movePath(before, '/src/components', '/')!.tree;

    const diff = computeRepoDiff(before, after);
    expect(diff.changes.filter((c) => c.type === 'move').length).toBe(3);
    expect(diff.topLevelChanges.map((c) => c.path)).toEqual(['/components']);
  });

  it('collapses children of a deleted folder', () => {
    const before = baseline();
    const after = removePath(before, '/src/components')!;
    expect(computeRepoDiff(before, after).topLevelChanges.map((c) => c.path)).toEqual([
      '/src/components',
    ]);
  });

  it('keeps a child move that is not explained by its parent move', () => {
    const before = baseline();
    // Move the folder, and separately move a file out of it to the root.
    let after = movePath(before, '/src/components', '/')!.tree;
    after = movePath(after, '/components/Button.tsx', '/')!.tree;

    const diff = computeRepoDiff(before, after);
    const paths = diff.topLevelChanges.map((c) => c.path).sort();
    expect(paths).toEqual(['/Button.tsx', '/components']);
  });
});

describe('generateShellScript', () => {
  const scriptFor = (before: FileNode[], after: FileNode[], contents?: Map<string, string>) =>
    generateShellScript(computeRepoDiff(before, after), { contents });

  it('says so when there is nothing to do', () => {
    const tree = baseline();
    expect(scriptFor(tree, tree)).toContain('No changes to apply');
  });

  it('refuses to run outside a git repository', () => {
    const tree = baseline();
    expect(scriptFor(tree, tree)).toContain('git rev-parse --show-toplevel');
  });

  it('emits git mv for a move, with paths relative to the repo root', () => {
    const before = baseline();
    const after = movePath(before, '/src/App.tsx', '/src/components')!.tree;
    const script = scriptFor(before, after);

    expect(script).toContain(`git mv 'src/App.tsx' 'src/components/App.tsx'`);
    expect(script).not.toContain("'/src/App.tsx'");
  });

  it('creates target directories before moving into them', () => {
    const before = build([['/a.ts', 'file'], ['/deep/nested/.keep', 'file']]);
    const after = movePath(before, '/a.ts', '/deep/nested')!.tree;
    const script = scriptFor(before, after);

    expect(script.indexOf('mkdir -p')).toBeLessThan(script.indexOf('git mv'));
  });

  it('orders moves deepest source first', () => {
    const before = build([
      ['/src/deep/a.ts', 'file'],
      ['/out/.keep', 'file'],
    ]);
    let after = movePath(before, '/src/deep/a.ts', '/out')!.tree;
    after = movePath(after, '/src/deep', '/out')!.tree;

    const script = scriptFor(before, after);
    expect(script.indexOf(`git mv 'src/deep/a.ts'`)).toBeLessThan(
      script.indexOf(`git mv 'src/deep'`),
    );
  });

  it('writes planned content for a new file as a heredoc', () => {
    const before = baseline();
    const after = addPath(before, '/src/new.ts', 'file').tree;
    const script = scriptFor(before, after, new Map([['/src/new.ts', 'export const x = 1;']]));

    expect(script).toContain(`cat > 'src/new.ts' <<'VRP_EOF'`);
    expect(script).toContain('export const x = 1;');
    expect(script).toContain('VRP_EOF');
  });

  it('falls back to touch when a new file has no content', () => {
    const before = baseline();
    const after = addPath(before, '/src/new.ts', 'file').tree;
    expect(scriptFor(before, after)).toContain(`touch 'src/new.ts'`);
  });

  it('quotes paths that contain a space', () => {
    const before = build([['/my docs/a.ts', 'file'], ['/out/.keep', 'file']]);
    const after = movePath(before, '/my docs/a.ts', '/out')!.tree;
    expect(scriptFor(before, after)).toContain(`git mv 'my docs/a.ts' 'out/a.ts'`);
  });

  it('escapes a single quote in a path rather than breaking out of the quoting', () => {
    const before = build([[`/it's/a.ts`, 'file'], ['/out/.keep', 'file']]);
    const after = movePath(before, `/it's/a.ts`, '/out')!.tree;
    const script = scriptFor(before, after);
    expect(script).toContain(`'it'\\''s/a.ts'`);
  });

  it('uses rm -rf for folders and rm -f for files', () => {
    const before = baseline();
    let after = removePath(before, '/src/components')!;
    after = removePath(after, '/README.md')!;
    const script = scriptFor(before, after);

    expect(script).toContain(`rm -rf 'src/components'`);
    expect(script).toContain(`rm -f 'README.md'`);
  });

  it('runs moves before deletes', () => {
    const before = baseline();
    let after = movePath(before, '/src/App.tsx', '/')!.tree;
    after = removePath(after, '/README.md')!;
    const script = scriptFor(before, after);

    expect(script.indexOf('git mv')).toBeLessThan(script.indexOf('rm -f'));
  });
});

describe('generateShellScript — added folders', () => {
  const scriptFor = (before: FileNode[], after: FileNode[], contents?: Map<string, string>) =>
    generateShellScript(computeRepoDiff(before, after), { contents });

  it('creates files inside a newly added folder', () => {
    // Collapsing these under the parent add would export an empty directory:
    // mkdir -p makes the folder, not what is in it.
    const before = baseline();
    let after = addPath(before, '/src/hooks/useAuth.ts', 'file').tree;
    after = addPath(after, '/src/hooks/useUser.ts', 'file').tree;

    const script = scriptFor(before, after);
    expect(script).toContain(`mkdir -p 'src/hooks'`);
    expect(script).toContain(`touch 'src/hooks/useAuth.ts'`);
    expect(script).toContain(`touch 'src/hooks/useUser.ts'`);
  });

  it('writes generated content for files inside a new folder', () => {
    const before = baseline();
    const after = addPath(before, '/src/hooks/useAuth.ts', 'file').tree;
    const script = scriptFor(
      before,
      after,
      new Map([['/src/hooks/useAuth.ts', 'export const useAuth = () => {};']]),
    );
    expect(script).toContain(`cat > 'src/hooks/useAuth.ts'`);
    expect(script).toContain('export const useAuth');
  });

  it('creates a deeply nested new tree at every level', () => {
    const before = baseline();
    const after = addPath(before, '/a/b/c/d.ts', 'file').tree;
    const script = scriptFor(before, after);
    expect(script).toContain(`mkdir -p 'a/b/c'`);
    expect(script).toContain(`touch 'a/b/c/d.ts'`);
  });

  it('does not emit a redundant mkdir for a parent of another mkdir', () => {
    const before = baseline();
    const after = addPath(before, '/a/b/c/d.ts', 'file').tree;
    const script = scriptFor(before, after);
    expect(script).not.toMatch(/^mkdir -p 'a'$/m);
    expect(script).not.toMatch(/^mkdir -p 'a\/b'$/m);
  });

  it('still creates an explicitly added empty folder', () => {
    const before = baseline();
    const after = addPath(before, '/src/empty', 'folder').tree;
    expect(scriptFor(before, after)).toContain(`mkdir -p 'src/empty'`);
  });

  it('counts every action it emits', () => {
    const before = baseline();
    let after = addPath(before, '/src/hooks/useAuth.ts', 'file').tree;
    after = addPath(after, '/src/hooks/useUser.ts', 'file').tree;
    // folder + two files
    expect(scriptFor(before, after)).toContain('Applied 3 change(s)');
  });
});

describe('generateAgentPrompt', () => {
  const promptFor = (before: FileNode[], after: FileNode[]) =>
    generateAgentPrompt(computeRepoDiff(before, after));

  it('says when nothing has changed', () => {
    const tree = baseline();
    expect(promptFor(tree, tree)).toContain('No repository layout changes');
  });

  it('lists every moved path, including ones collapsed out of the script', () => {
    const before = baseline();
    const after = movePath(before, '/src/components', '/')!.tree;
    const prompt = promptFor(before, after);

    // The script only needs the folder, but the agent needs every file path
    // to find the imports that referenced them.
    expect(prompt).toContain('`src/components` → `components`');
    expect(prompt).toContain('`src/components/Button.tsx` → `components/Button.tsx`');
  });

  it('asks for the things that actually break on a move', () => {
    const before = baseline();
    const after = movePath(before, '/src/App.tsx', '/')!.tree;
    const prompt = promptFor(before, after);

    expect(prompt).toMatch(/relative imports/i);
    expect(prompt).toMatch(/tsconfig/i);
  });
});

describe('diff shape', () => {
  it('pairs nodes by id, so an identical path with a new id reads as add plus delete', () => {
    const before = baseline();
    const removed = removePath(before, '/README.md')!;
    const after = addPath(removed, '/README.md', 'file').tree;

    const diff: RepoDiff = computeRepoDiff(before, after);
    const kinds = diff.changes.map((c) => c.type).sort();
    expect(kinds).toEqual(['add', 'delete']);
  });

  it('keeps node identity stable across an unrelated edit', () => {
    const before = baseline();
    const after = addPath(before, '/other.ts', 'file').tree;
    const idBefore = buildIndex(before).get('/src/App.tsx')!.id;
    expect(buildIndex(after).get('/src/App.tsx')!.id).toBe(idBefore);
  });
});
