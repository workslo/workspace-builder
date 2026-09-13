import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentStore } from './contentStore';

const fileHandle = (text: string) => ({
  getFile: async () => ({ text: async () => text }) as unknown as File,
});

describe('ContentStore', () => {
  let store: ContentStore;

  beforeEach(() => {
    store = new ContentStore();
  });

  it('reads back what was written', () => {
    store.set('/a.ts', 'hello');
    expect(store.get('/a.ts')).toBe('hello');
    expect(store.has('/a.ts')).toBe(true);
  });

  it('notifies subscribers for an off-screen change', () => {
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('/a.ts', 'hello');
    expect(listener).toHaveBeenCalledWith('/a.ts');
  });

  it('stays silent for an editor keystroke', () => {
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSilently('/a.ts', 'typing');
    expect(listener).not.toHaveBeenCalled();
    expect(store.get('/a.ts')).toBe('typing');
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    store.subscribe(listener)();
    store.set('/a.ts', 'hello');
    expect(listener).not.toHaveBeenCalled();
  });

  describe('lazy loading', () => {
    it('reads content from a handle on demand', async () => {
      store.setSources(new Map([['/a.ts', fileHandle('from disk')]]));
      expect(store.get('/a.ts')).toBeUndefined();

      await expect(store.load('/a.ts')).resolves.toBe('from disk');
      expect(store.get('/a.ts')).toBe('from disk');
    });

    it('reads a given path only once, even for concurrent callers', async () => {
      const getFile = vi.fn(async () => ({ text: async () => 'body' }) as unknown as File);
      store.setSources(new Map([['/a.ts', { getFile }]]));

      await Promise.all([store.load('/a.ts'), store.load('/a.ts'), store.load('/a.ts')]);
      expect(getFile).toHaveBeenCalledTimes(1);
    });

    it('resolves undefined when there is no source', async () => {
      await expect(store.load('/missing.ts')).resolves.toBeUndefined();
    });

    it('surfaces a read failure as file content rather than throwing', async () => {
      store.setSources(
        new Map([['/a.ts', { getFile: async () => { throw new Error('permission denied'); } }]]),
      );
      const result = await store.load('/a.ts');
      expect(result).toContain('permission denied');
    });

    it('treats a plain File as a source', async () => {
      const file = { text: async () => 'plain file' } as unknown as File;
      store.setSources(new Map([['/a.ts', file]]));
      await expect(store.load('/a.ts')).resolves.toBe('plain file');
    });

    it('knows whether a path is readable at all', () => {
      store.setSources(new Map([['/lazy.ts', fileHandle('x')]]));
      store.set('/loaded.ts', 'y');

      expect(store.isReadable('/lazy.ts')).toBe(true);
      expect(store.isReadable('/loaded.ts')).toBe(true);
      expect(store.isReadable('/planned.ts')).toBe(false);
    });
  });

  describe('remap', () => {
    it('moves content to the new path', () => {
      store.set('/old.ts', 'body');
      store.remap(new Map([['/old.ts', '/new.ts']]));
      expect(store.get('/new.ts')).toBe('body');
      expect(store.get('/old.ts')).toBeUndefined();
    });

    it('moves the lazy source too, so an unread file stays readable', async () => {
      store.setSources(new Map([['/old.ts', fileHandle('from disk')]]));
      store.remap(new Map([['/old.ts', '/new.ts']]));
      await expect(store.load('/new.ts')).resolves.toBe('from disk');
    });

    it('handles a swap without losing either side', () => {
      store.set('/a.ts', 'A');
      store.set('/b.ts', 'B');
      store.remap(new Map([['/a.ts', '/b.ts'], ['/b.ts', '/a.ts']]));
      expect(store.get('/a.ts')).toBe('B');
      expect(store.get('/b.ts')).toBe('A');
    });

    it('ignores an entry that maps a path to itself', () => {
      store.set('/a.ts', 'body');
      store.remap(new Map([['/a.ts', '/a.ts']]));
      expect(store.get('/a.ts')).toBe('body');
    });
  });

  describe('forget', () => {
    it('drops the path and everything beneath it', () => {
      store.set('/src/a.ts', 'a');
      store.set('/src/deep/b.ts', 'b');
      store.set('/other.ts', 'c');

      store.forget('/src');

      expect(store.get('/src/a.ts')).toBeUndefined();
      expect(store.get('/src/deep/b.ts')).toBeUndefined();
      expect(store.get('/other.ts')).toBe('c');
    });

    it('does not drop a sibling that merely shares a prefix', () => {
      store.set('/src/a.ts', 'a');
      store.set('/srcfoo/b.ts', 'b');
      store.forget('/src');
      expect(store.get('/srcfoo/b.ts')).toBe('b');
    });
  });
});
