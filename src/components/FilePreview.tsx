import { useEffect, useMemo, useState } from 'react';
import { Badge, Group, Loader, Text } from '@mantine/core';
import { IconCode } from '@tabler/icons-react';
import { useRepoStore } from '../store/useRepoStore';
import { CodeView } from './CodeView';

export function FilePreview() {
  const selectedPath = useRepoStore((s) => s.selectedPath);
  const index = useRepoStore((s) => s.index);
  const contentVersion = useRepoStore((s) => s.contentVersion);
  const writeFileContent = useRepoStore((s) => s.writeFileContent);
  const readFileContent = useRepoStore((s) => s.readFileContent);
  const loadFileContent = useRepoStore((s) => s.loadFileContent);
  const isFileReadable = useRepoStore((s) => s.isFileReadable);

  const [loading, setLoading] = useState(false);

  const node = selectedPath ? index.get(selectedPath) : undefined;
  const isFile = node?.type === 'file';

  useEffect(() => {
    if (!selectedPath || !isFile) {
      setLoading(false);
      return;
    }
    if (readFileContent(selectedPath) !== undefined) {
      setLoading(false);
      return;
    }
    if (!isFileReadable(selectedPath)) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    loadFileContent(selectedPath).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [selectedPath, isFile, readFileContent, isFileReadable, loadFileContent, contentVersion]);

  /**
   * Read once per (path, external change). CodeMirror owns the document while
   * the user types, and `writeFileContent` deliberately does not bump
   * `contentVersion`, so typing never remounts the editor.
   */
  const initialValue = useMemo(
    () => (selectedPath ? readFileContent(selectedPath) : undefined),
    [selectedPath, contentVersion, readFileContent],
  );

  if (!selectedPath || !node) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="pane-header">
          <span className="pane-title">Preview</span>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--text-faint)',
          }}
        >
          <IconCode size={40} stroke={1.2} />
          <Text size="sm" c="dimmed">
            Select a file to read it
          </Text>
          <Text size="xs" c="dimmed" maw={280} ta="center">
            Drag rows in the explorer to plan a new layout. Nothing on disk changes until you
            export.
          </Text>
        </div>
      </div>
    );
  }

  const segments = selectedPath.split('/').filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="pane-header">
        <Group gap={4} style={{ overflow: 'hidden' }} wrap="nowrap">
          {segments.map((segment, i) => (
            <Group key={i} gap={4} wrap="nowrap">
              {i > 0 && (
                <Text size="xs" c="dark.3">
                  /
                </Text>
              )}
              <Text
                size="xs"
                ff="monospace"
                c={i === segments.length - 1 ? 'gray.3' : 'dimmed'}
                fw={i === segments.length - 1 ? 600 : 400}
                style={{ whiteSpace: 'nowrap' }}
              >
                {segment}
              </Text>
            </Group>
          ))}
        </Group>
        {node.type === 'folder' && (
          <Badge variant="light" color="gray">
            folder
          </Badge>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {node.type === 'folder' ? (
          <Centered>
            <Text size="sm" c="dimmed">
              {node.children?.length ?? 0} item
              {(node.children?.length ?? 0) === 1 ? '' : 's'}
            </Text>
          </Centered>
        ) : loading ? (
          <Centered>
            <Loader size="xs" />
            <Text size="xs" c="dimmed" mt="xs">
              Reading file…
            </Text>
          </Centered>
        ) : initialValue !== undefined ? (
          <CodeView
            key={`${selectedPath}:${contentVersion}`}
            value={initialValue}
            filename={node.name}
            onChange={(value) => writeFileContent(selectedPath, value)}
          />
        ) : (
          <Centered>
            <Text size="sm" c="dimmed">
              Planned file — no contents yet
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              It will be created when you run the export.
            </Text>
          </Centered>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}
