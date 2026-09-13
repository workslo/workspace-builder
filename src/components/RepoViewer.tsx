import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ActionIcon, Button, Group, Modal, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconEdit,
  IconFolderOpen,
  IconFolderPlus,
  IconPackageExport,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useRepoStore } from '../store/useRepoStore';
import { ancestorPaths, flattenVisible, type FlatRow } from '../store/treeOps';
import { computeRepoDiff } from '../utils/diffUtils';
import { parseDirectoryHandle, parseFileList } from '../utils/fileSystem';
import { TreeRow, type ChangeKind } from './TreeRow';
import { BundleChangesModal } from './BundleChangesModal';
import { ROW_HEIGHT } from '../theme';

/** Keeps typing responsive when the tree is large enough for search to cost. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
}

export function RepoViewer() {
  const tree = useRepoStore((s) => s.tree);
  const index = useRepoStore((s) => s.index);
  const paths = useRepoStore((s) => s.paths);
  const baseline = useRepoStore((s) => s.baseline);
  const expanded = useRepoStore((s) => s.expanded);
  const selectedPath = useRepoStore((s) => s.selectedPath);

  const toggleExpanded = useRepoStore((s) => s.toggleExpanded);
  const setExpanded = useRepoStore((s) => s.setExpanded);
  const setSelectedPath = useRepoStore((s) => s.setSelectedPath);
  const addNode = useRepoStore((s) => s.addNode);
  const removeNode = useRepoStore((s) => s.removeNode);
  const moveNode = useRepoStore((s) => s.moveNode);
  const renameNode = useRepoStore((s) => s.renameNode);
  const setLocalFolder = useRepoStore((s) => s.setLocalFolder);
  const loadMockData = useRepoStore((s) => s.loadMockData);
  const undo = useRepoStore((s) => s.undo);
  const redo = useRepoStore((s) => s.redo);
  const undoDepth = useRepoStore((s) => s.undoStack.length);
  const redoDepth = useRepoStore((s) => s.redoStack.length);

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 120);
  const [newPath, setNewPath] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const diff = useMemo(() => computeRepoDiff(baseline, tree), [baseline, tree]);

  /** path -> how it differs from the baseline, for the per-row tint. */
  const changedPaths = useMemo(() => {
    const map = new Map<string, ChangeKind>();
    for (const change of diff.changes) {
      if (change.type === 'add') map.set(change.path, 'added');
      else if (change.type === 'move') map.set(change.path, 'moved');
    }
    return map;
  }, [diff]);

  /**
   * Search runs over the flat path list rather than rebuilding the tree, and
   * only expands the ancestors of actual matches instead of expanding
   * everything.
   */
  const matchingPaths = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    if (!needle) return null;
    const matches = new Set<string>();
    for (const path of paths) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (name.toLowerCase().includes(needle)) {
        matches.add(path);
        for (const ancestor of ancestorPaths(path)) matches.add(ancestor);
      }
    }
    return matches;
  }, [debouncedQuery, paths]);

  const visibleRows: FlatRow[] = useMemo(() => {
    const rows = flattenVisible(tree, expanded);
    if (!matchingPaths) return rows;
    return rows.filter((row) => matchingPaths.has(row.node.path));
  }, [tree, expanded, matchingPaths]);

  // While searching, reveal the ancestors of matches so results are reachable.
  useEffect(() => {
    if (!matchingPaths) return;
    const folders = Array.from(matchingPaths).filter(
      (path) => index.get(path)?.type === 'folder',
    );
    setExpanded(new Set([...expanded, ...folders]));
    // `expanded` is intentionally omitted: including it would re-run on every
    // manual collapse and immediately undo it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingPaths, index, setExpanded]);

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (i) => visibleRows[i].node.id,
  });

  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    window.addEventListener('click', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.closest('.cm-editor')) return;

      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'z') return;

      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const handleContextMenu = useCallback((event: React.MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, path });
  }, []);

  const handleDrop = useCallback(
    (targetPath: string) => {
      const source = draggingPath;
      setDropTarget(null);
      setDraggingPath(null);
      if (source) moveNode(source, targetPath);
    },
    [draggingPath, moveNode],
  );

  const handleRenameCommit = useCallback(
    (path: string, name: string) => {
      setRenamingPath(null);
      const trimmed = name.trim();
      if (trimmed && trimmed !== path.slice(path.lastIndexOf('/') + 1)) {
        renameNode(path, trimmed);
      }
    },
    [renameNode],
  );

  const handleAdd = () => {
    const raw = newPath.trim();
    if (!raw) return;
    // A trailing slash is the explicit way to say "folder"; otherwise an
    // extension decides, which is only a guess for the final segment.
    const isFolder = raw.endsWith('/') || !raw.slice(raw.lastIndexOf('/') + 1).includes('.');
    addNode(raw, isFolder ? 'folder' : 'file');
    setNewPath('');
  };

  const handleOpenFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<unknown> })
      .showDirectoryPicker;

    if (typeof picker === 'function') {
      try {
        setIsOpening(true);
        const handle = await picker();
        const { nodes, sources } = await parseDirectoryHandle(handle as never);
        setLocalFolder(nodes, sources);
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        console.warn('Directory picker unavailable, falling back to input:', err);
        fileInputRef.current?.click();
      } finally {
        setIsOpening(false);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      setIsOpening(true);
      const { nodes, sources } = parseFileList(files);
      setLocalFolder(nodes, sources);
    } finally {
      setIsOpening(false);
      event.target.value = '';
    }
  };

  const items = virtualizer.getVirtualItems();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={handleFileInput}
      />

      <div className="pane-header">
        <span className="pane-title">Explorer</span>
        <Group gap={2}>
          <Tooltip label="Undo (⌘Z)">
            <ActionIcon variant="subtle" color="gray" disabled={undoDepth === 0} onClick={undo}>
              <IconArrowBackUp size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Redo (⇧⌘Z)">
            <ActionIcon variant="subtle" color="gray" disabled={redoDepth === 0} onClick={redo}>
              <IconArrowForwardUp size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Open a folder from disk">
            <ActionIcon variant="subtle" color="gray" loading={isOpening} onClick={handleOpenFolder}>
              <IconFolderOpen size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <TextInput
          placeholder="Filter by name"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          leftSection={<IconSearch size={13} />}
          rightSection={
            query ? (
              <ActionIcon variant="subtle" color="gray" onClick={() => setQuery('')}>
                <IconX size={12} />
              </ActionIcon>
            ) : null
          }
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleAdd();
          }}
        >
          <TextInput
            placeholder="New path, e.g. src/lib/api.ts"
            value={newPath}
            onChange={(event) => setNewPath(event.currentTarget.value)}
            leftSection={<IconFolderPlus size={13} />}
          />
        </form>
      </div>

      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 4px 8px' }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleDrop('/');
        }}
      >
        {visibleRows.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center' }}>
            <Text size="sm" c="dimmed">
              {tree.length === 0 ? 'No repository open' : 'No matches'}
            </Text>
            {tree.length === 0 && (
              <Group justify="center" gap={6} mt="md">
                <Button variant="light" onClick={handleOpenFolder} loading={isOpening}>
                  Open folder
                </Button>
                <Button variant="subtle" color="gray" onClick={loadMockData}>
                  Use sample
                </Button>
              </Group>
            )}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
              const row = visibleRows[item.index];
              return (
                <div
                  key={item.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TreeRow
                    row={row}
                    selected={selectedPath === row.node.path}
                    isDropTarget={dropTarget === row.node.path}
                    isDragging={draggingPath === row.node.path}
                    changeKind={changedPaths.get(row.node.path)}
                    query={debouncedQuery.trim()}
                    renaming={renamingPath === row.node.path}
                    onToggle={toggleExpanded}
                    onSelect={setSelectedPath}
                    onContextMenu={handleContextMenu}
                    onDragStart={setDraggingPath}
                    onDragEnd={() => {
                      setDraggingPath(null);
                      setDropTarget(null);
                    }}
                    onDragOverRow={setDropTarget}
                    onDrop={handleDrop}
                    onRenameCommit={handleRenameCommit}
                    onRenameCancel={() => setRenamingPath(null)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '6px 8px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-1)',
        }}
      >
        <Button
          fullWidth
          variant={diff.totalCount > 0 ? 'filled' : 'default'}
          color="teal"
          leftSection={<IconPackageExport size={14} />}
          disabled={diff.totalCount === 0}
          onClick={() => setExportOpen(true)}
        >
          {diff.totalCount > 0
            ? `Export ${diff.totalCount} change${diff.totalCount === 1 ? '' : 's'}`
            : 'No changes yet'}
        </Button>
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              setRenamingPath(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <IconEdit size={13} />
            Rename
          </button>
          <div className="context-menu-separator" />
          <button
            type="button"
            className="context-menu-item"
            data-danger="true"
            onClick={() => {
              setDeleteTarget(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <IconTrash size={13} />
            Delete
          </button>
        </div>
      )}

      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete path"
        centered
        size="sm"
      >
        <Text size="sm">
          Remove <Text span ff="monospace" c="red.4">{deleteTarget}</Text> from the plan?
        </Text>
        <Text size="xs" c="dimmed" mt="xs">
          This changes the plan only. Nothing is deleted on disk until you run the exported
          script — and ⌘Z undoes it.
        </Text>
        <Group justify="flex-end" mt="lg" gap="xs">
          <Button variant="default" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              if (deleteTarget) removeNode(deleteTarget);
              setDeleteTarget(null);
            }}
          >
            Delete
          </Button>
        </Group>
      </Modal>

      <BundleChangesModal
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        diff={diff}
      />
    </div>
  );
}
