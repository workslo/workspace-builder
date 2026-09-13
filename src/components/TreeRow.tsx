import React, { memo, useEffect, useRef, useState } from 'react';
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFileCode,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconPhoto,
  IconSettings,
} from '@tabler/icons-react';
import type { FlatRow } from '../store/treeOps';
import { INDENT_WIDTH } from '../theme';

const ICON_SIZE = 14;

/**
 * File type comes from the node's `type` field, never from whether the name
 * contains a dot — `Makefile` is a file and `v1.2` can be a folder.
 */
function iconFor(name: string, isFolder: boolean, expanded: boolean) {
  if (isFolder) {
    return expanded ? (
      <IconFolderOpen size={ICON_SIZE} color="#8b8b94" />
    ) : (
      <IconFolder size={ICON_SIZE} color="#8b8b94" />
    );
  }

  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';

  switch (ext) {
    case 'tsx':
    case 'jsx':
      return <IconFileCode size={ICON_SIZE} color="#61dbfb" />;
    case 'ts':
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'json':
      return <IconFileCode size={ICON_SIZE} color="#579bf0" />;
    case 'css':
    case 'scss':
    case 'html':
      return <IconFileCode size={ICON_SIZE} color="#4fc3a1" />;
    case 'md':
    case 'mdx':
    case 'txt':
      return <IconFileText size={ICON_SIZE} color="#a78bfa" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <IconPhoto size={ICON_SIZE} color="#34d399" />;
    default:
      return name.startsWith('.') ? (
        <IconSettings size={ICON_SIZE} color="#6b7280" />
      ) : (
        <IconFile size={ICON_SIZE} color="#8b8b94" />
      );
  }
}

/** Splits a label around a case-insensitive match so it can be highlighted. */
function highlight(label: string, query: string): React.ReactNode {
  if (!query) return label;
  const at = label.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark>{label.slice(at, at + query.length)}</mark>
      {label.slice(at + query.length)}
    </>
  );
}

export type ChangeKind = 'added' | 'moved' | undefined;

export interface TreeRowProps {
  row: FlatRow;
  selected: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  changeKind: ChangeKind;
  query: string;
  renaming: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, path: string) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDragOverRow: (path: string | null) => void;
  onDrop: (targetPath: string) => void;
  onRenameCommit: (path: string, name: string) => void;
  onRenameCancel: () => void;
}

function TreeRowImpl({
  row,
  selected,
  isDropTarget,
  isDragging,
  changeKind,
  query,
  renaming,
  onToggle,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOverRow,
  onDrop,
  onRenameCommit,
  onRenameCancel,
}: TreeRowProps) {
  const { node, depth, expanded, hasChildren } = row;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(node.name);

  useEffect(() => {
    if (renaming) {
      setDraft(node.name);
      // Select the stem, leaving the extension — renames usually keep it.
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        const dot = node.name.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : node.name.length);
      });
    }
  }, [renaming, node.name]);

  const handleClick = () => {
    if (hasChildren) onToggle(node.path);
    else onSelect(node.path);
  };

  return (
    <div
      className="tree-row"
      data-selected={selected}
      data-drop-target={isDropTarget}
      data-dragging={isDragging}
      data-changed={changeKind}
      style={{ paddingLeft: depth * INDENT_WIDTH + 6 }}
      onClick={handleClick}
      onContextMenu={(event) => onContextMenu(event, node.path)}
      draggable={!renaming}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-repo-node', node.path);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(node.path);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!hasChildren) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOverRow(node.path);
      }}
      onDragLeave={() => onDragOverRow(null)}
      onDrop={(event) => {
        if (!hasChildren) return;
        event.preventDefault();
        event.stopPropagation();
        onDrop(node.path);
      }}
      title={node.path}
    >
      <span className="tree-chevron" data-leaf={!hasChildren}>
        {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
      </span>

      <span className="tree-icon">{iconFor(node.name, hasChildren, expanded)}</span>

      {renaming ? (
        <input
          ref={inputRef}
          className="tree-rename-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => onRenameCommit(node.path, draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onRenameCommit(node.path, draft);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onRenameCancel();
            }
          }}
        />
      ) : (
        <span className="tree-label">{highlight(node.name, query)}</span>
      )}
    </div>
  );
}

/**
 * Memoised on identity: with structural sharing, a row whose node reference is
 * unchanged cannot have changed, so scrolling and editing skip it entirely.
 */
export const TreeRow = memo(TreeRowImpl, (prev, next) => {
  return (
    prev.row.node === next.row.node &&
    prev.row.depth === next.row.depth &&
    prev.row.expanded === next.row.expanded &&
    prev.selected === next.selected &&
    prev.isDropTarget === next.isDropTarget &&
    prev.isDragging === next.isDragging &&
    prev.changeKind === next.changeKind &&
    prev.query === next.query &&
    prev.renaming === next.renaming
  );
});
