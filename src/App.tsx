/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import { Anchor, Button, Group, Splitter, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCloudUpload } from '@tabler/icons-react';
import { RepoViewer } from './components/RepoViewer';
import { FilePreview } from './components/FilePreview';
import { CopilotChat } from './components/CopilotChat';
import { adoptLoadedTree, useRepoStore } from './store/useRepoStore';
import { makeId } from './store/treeOps';
import { describeAuthError, googleSignIn, logout, watchAuth } from './lib/auth';
import { persistence } from './lib/persistence';

function SaveIndicator() {
  const status = useRepoStore((s) => s.saveStatus);

  if (status.state === 'idle') return null;

  if (status.state === 'error') {
    return (
      <Tooltip label={status.message} multiline w={280}>
        <Group gap={4} style={{ cursor: 'help' }}>
          <IconAlertTriangle size={12} color="var(--removed)" />
          <Text size="xs" c="red.4">
            Not synced
          </Text>
        </Group>
      </Tooltip>
    );
  }

  return (
    <Group gap={4}>
      {status.state === 'saving' ? (
        <IconCloudUpload size={12} color="var(--text-faint)" />
      ) : (
        <IconCheck size={12} color="var(--text-faint)" />
      )}
      <Text size="xs" c="dimmed">
        {status.state === 'saving' ? 'Syncing…' : 'Synced'}
      </Text>
    </Group>
  );
}

export default function App() {
  const user = useRepoStore((s) => s.user);
  const setUser = useRepoStore((s) => s.setUser);
  const setSaveStatus = useRepoStore((s) => s.setSaveStatus);
  const treeSize = useRepoStore((s) => s.paths.length);

  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => persistence.onStatus(setSaveStatus), [setSaveStatus]);

  useEffect(
    () =>
      watchAuth((sessionUser) => {
        setUser(sessionUser);
        if (!sessionUser) return;

        // Only adopt the saved layout when there is nothing open, so signing in
        // mid-session never discards the folder the user is working on.
        if (useRepoStore.getState().tree.length > 0) return;

        persistence
          .load(sessionUser.uid, makeId)
          .then((tree) => {
            if (tree && tree.length > 0 && useRepoStore.getState().tree.length === 0) {
              adoptLoadedTree(tree);
            }
          })
          .catch((err) => console.error('Could not load saved layout:', err));
      }),
    [setUser],
  );

  // A queued save would otherwise be lost when the tab closes.
  useEffect(() => {
    const flush = () => void persistence.flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      setUser(await googleSignIn());
    } catch (err) {
      setAuthError(describeAuthError(err));
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 34,
          padding: '0 10px',
          flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-1)',
        }}
      >
        <Group gap={8}>
          <Text size="sm" fw={600}>
            Visual Repository Planner
          </Text>
          {treeSize > 0 && (
            <Text size="xs" c="dark.3">
              {treeSize} paths
            </Text>
          )}
        </Group>

        <Group gap="sm">
          {authError && (
            <Text size="xs" c="red.4">
              {authError}
            </Text>
          )}
          <SaveIndicator />
          {user ? (
            <Group gap={6}>
              <Text size="xs" c="dimmed">
                {user.email}
              </Text>
              <Anchor
                component="button"
                type="button"
                size="xs"
                c="dimmed"
                onClick={() => {
                  void persistence.flush().then(logout);
                }}
              >
                Sign out
              </Anchor>
            </Group>
          ) : (
            <Tooltip label="Optional — keeps your planned layout across devices">
              <Button variant="default" loading={signingIn} onClick={handleSignIn}>
                Sign in
              </Button>
            </Tooltip>
          )}
        </Group>
      </header>

      <Splitter style={{ flex: 1, minHeight: 0 }}>
        <Splitter.Pane defaultSize={22} min={15}>
          <div style={{ height: '100%', borderRight: '1px solid var(--border)' }}>
            <RepoViewer />
          </div>
        </Splitter.Pane>

        <Splitter.Pane defaultSize={48} min={20}>
          <FilePreview />
        </Splitter.Pane>

        <Splitter.Pane defaultSize={30} min={18}>
          <div style={{ height: '100%', borderLeft: '1px solid var(--border)' }}>
            <CopilotChat />
          </div>
        </Splitter.Pane>
      </Splitter>
    </div>
  );
}
