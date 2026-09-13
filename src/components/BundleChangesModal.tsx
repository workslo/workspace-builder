import { useMemo, useState } from 'react';
import { Badge, Button, Group, Modal, Stack, Tabs, Text, Tooltip } from '@mantine/core';
import {
  IconCheck,
  IconCopy,
  IconPackageExport,
  IconSend,
  IconSparkles,
  IconTerminal,
} from '@tabler/icons-react';
import CodeMirror from '@uiw/react-codemirror';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { generateAgentPrompt, generateShellScript, type RepoDiff } from '../utils/diffUtils';
import { useRepoStore } from '../store/useRepoStore';
import { contentStore } from '../store/contentStore';

interface BundleChangesModalProps {
  opened: boolean;
  onClose: () => void;
  diff: RepoDiff;
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  };
  return { copied, copy };
}

/**
 * The end of the user story: turn the plan into something you can run, and
 * something you can hand to a coding agent to fix the imports afterwards.
 */
export function BundleChangesModal({ opened, onClose, diff }: BundleChangesModalProps) {
  const setPendingChatPrompt = useRepoStore((s) => s.setPendingChatPrompt);
  const [tab, setTab] = useState<string | null>('shell');

  // Added files carry their planned contents into the script as heredocs.
  const contents = useMemo(() => {
    if (!opened) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const change of diff.topLevelChanges) {
      if (change.type !== 'add' || change.nodeType !== 'file') continue;
      const body = contentStore.get(change.path);
      if (body !== undefined) map.set(change.path, body);
    }
    return map;
  }, [opened, diff]);

  const script = useMemo(
    () => generateShellScript(diff, { contents }),
    [diff, contents],
  );
  const agentPrompt = useMemo(() => generateAgentPrompt(diff), [diff]);

  const shellCopy = useCopy(script);
  const promptCopy = useCopy(agentPrompt);

  const counts = useMemo(
    () => ({
      moves: diff.changes.filter((c) => c.type === 'move').length,
      adds: diff.changes.filter((c) => c.type === 'add').length,
      deletes: diff.changes.filter((c) => c.type === 'delete').length,
    }),
    [diff],
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      centered
      title={
        <Group gap={6}>
          <IconPackageExport size={15} color="var(--mantine-color-teal-5)" />
          <Text size="md" fw={600}>
            Export changes
          </Text>
        </Group>
      }
    >
      <Stack gap="sm">
        <Group gap={5}>
          {counts.moves > 0 && (
            <Badge color="blue" variant="dot">
              {counts.moves} moved
            </Badge>
          )}
          {counts.adds > 0 && (
            <Badge color="green" variant="dot">
              {counts.adds} added
            </Badge>
          )}
          {counts.deletes > 0 && (
            <Badge color="red" variant="dot">
              {counts.deletes} removed
            </Badge>
          )}
        </Group>

        <Tabs value={tab} onChange={setTab} variant="outline">
          <Tabs.List mb="sm">
            <Tabs.Tab value="shell" leftSection={<IconTerminal size={13} />}>
              Shell script
            </Tabs.Tab>
            <Tabs.Tab value="prompt" leftSection={<IconSparkles size={13} />}>
              Agent prompt
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="shell">
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Run from your repository root. Uses <code>git mv</code> so history follows the
                files.
              </Text>
              <CodeMirror
                value={script}
                readOnly
                height="340px"
                theme={vscodeDark}
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}
              />
              <Group justify="flex-end">
                <Button
                  variant="light"
                  color={shellCopy.copied ? 'teal' : 'blue'}
                  leftSection={
                    shellCopy.copied ? <IconCheck size={13} /> : <IconCopy size={13} />
                  }
                  onClick={shellCopy.copy}
                >
                  {shellCopy.copied ? 'Copied' : 'Copy script'}
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="prompt">
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Hand this to a coding agent after running the script — it lists every path that
                moved so imports can be updated.
              </Text>
              <CodeMirror
                value={agentPrompt}
                readOnly
                height="340px"
                theme={vscodeDark}
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}
              />
              <Group justify="space-between">
                <Button
                  variant="subtle"
                  color={promptCopy.copied ? 'teal' : 'gray'}
                  leftSection={
                    promptCopy.copied ? <IconCheck size={13} /> : <IconCopy size={13} />
                  }
                  onClick={promptCopy.copy}
                >
                  {promptCopy.copied ? 'Copied' : 'Copy prompt'}
                </Button>
                <Tooltip label="Puts this prompt in the copilot input">
                  <Button
                    leftSection={<IconSend size={13} />}
                    onClick={() => {
                      setPendingChatPrompt(agentPrompt);
                      onClose();
                    }}
                  >
                    Send to copilot
                  </Button>
                </Tooltip>
              </Group>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Modal>
  );
}
