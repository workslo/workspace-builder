/**
 * File contents, deliberately kept outside React state.
 *
 * Typing in the editor must not re-render the tree, must not clone the tree,
 * and must not trigger a network write. So content lives here in a plain Map,
 * and the editor writes through to it directly. React only hears about a
 * content change when it arrives from somewhere the user is not looking at —
 * a lazy disk read completing, or a diff being applied.
 */

export type FileSource = { getFile?: () => Promise<File> } | File;

type Listener = (path: string) => void;

export class ContentStore {
  private contents = new Map<string, string>();
  private sources = new Map<string, FileSource>();
  private inflight = new Map<string, Promise<string | undefined>>();
  private listeners = new Set<Listener>();

  /** Fires only for changes React needs to see; not for editor keystrokes. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(path: string) {
    for (const listener of this.listeners) listener(path);
  }

  get(path: string): string | undefined {
    return this.contents.get(path);
  }

  has(path: string): boolean {
    return this.contents.has(path);
  }

  /** Editor write-through. Silent by design — see the note at the top. */
  setSilently(path: string, value: string): void {
    this.contents.set(path, value);
  }

  /** A change from off-screen: lazy load finished, diff applied, file reset. */
  set(path: string, value: string): void {
    this.contents.set(path, value);
    this.emit(path);
  }

  hasSource(path: string): boolean {
    return this.sources.has(path);
  }

  setSources(sources: Map<string, FileSource>): void {
    this.sources = sources;
  }

  /** Content is either already loaded, or lazily readable from disk. */
  isReadable(path: string): boolean {
    return this.contents.has(path) || this.sources.has(path);
  }

  /**
   * Reads a file's content from its disk handle, once. Concurrent callers for
   * the same path share one read.
   */
  load(path: string): Promise<string | undefined> {
    const cached = this.contents.get(path);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = this.inflight.get(path);
    if (existing) return existing;

    const source = this.sources.get(path);
    if (!source) return Promise.resolve(undefined);

    const read = (async () => {
      try {
        let file: File;
        if (typeof (source as { getFile?: () => Promise<File> }).getFile === 'function') {
          file = await (source as { getFile: () => Promise<File> }).getFile();
        } else {
          file = source as File;
        }
        const text = await file.text();
        this.set(path, text);
        return text;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const placeholder = `// Unable to read file content: ${message}`;
        this.set(path, placeholder);
        return placeholder;
      } finally {
        this.inflight.delete(path);
      }
    })();

    this.inflight.set(path, read);
    return read;
  }

  /** Follows a rename or move so the open editor keeps its text. */
  remap(remapped: ReadonlyMap<string, string>): void {
    const movedContents: Array<[string, string]> = [];
    const movedSources: Array<[string, FileSource]> = [];

    for (const [from, to] of remapped) {
      if (from === to) continue;
      const content = this.contents.get(from);
      if (content !== undefined) {
        this.contents.delete(from);
        movedContents.push([to, content]);
      }
      const source = this.sources.get(from);
      if (source !== undefined) {
        this.sources.delete(from);
        movedSources.push([to, source]);
      }
    }

    for (const [path, content] of movedContents) this.contents.set(path, content);
    for (const [path, source] of movedSources) this.sources.set(path, source);
  }

  /** Drops a path and everything beneath it. */
  forget(prefix: string): void {
    const under = (key: string) => key === prefix || key.startsWith(prefix + '/');
    for (const key of Array.from(this.contents.keys())) {
      if (under(key)) this.contents.delete(key);
    }
    for (const key of Array.from(this.sources.keys())) {
      if (under(key)) this.sources.delete(key);
    }
  }

  clear(): void {
    this.contents.clear();
    this.sources.clear();
    this.inflight.clear();
  }
}

export const contentStore = new ContentStore();
