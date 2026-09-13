import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Group,
  Loader,
  Select,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { IconLink, IconSend, IconSparkles, IconUnlink } from '@tabler/icons-react';
import ReactMarkdown from 'react-markdown';
import { useRepoStore, type FileDiff } from '../store/useRepoStore';
import { DiffCard } from './DiffCard';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  diffs?: FileDiff[];
  applied?: boolean;
  error?: boolean;
}

const MODELS = [
  { value: 'gemini-3.5-flash', label: 'Flash — fast' },
  { value: 'gemini-3.1-pro-preview', label: 'Pro — careful' },
  { value: 'gemini-3.1-flash-lite', label: 'Flash Lite — fastest' },
];

/** Paths only, newline separated. The model does not need file bodies to plan. */
function buildTreeContext(paths: readonly string[], limit = 2000): string {
  if (paths.length <= limit) return paths.join('\n');
  return `${paths.slice(0, limit).join('\n')}\n… and ${paths.length - limit} more paths`;
}

let messageSeq = 0;
const nextId = () => `m${(messageSeq += 1)}`;

export function CopilotChat() {
  const paths = useRepoStore((s) => s.paths);
  const index = useRepoStore((s) => s.index);
  const selectedPath = useRepoStore((s) => s.selectedPath);
  const applyDiffs = useRepoStore((s) => s.applyDiffs);
  const readFileContent = useRepoStore((s) => s.readFileContent);
  const pendingChatPrompt = useRepoStore((s) => s.pendingChatPrompt);
  const setPendingChatPrompt = useRepoStore((s) => s.setPendingChatPrompt);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [model, setModel] = useState(MODELS[0].value);
  const [attachFile, setAttachFile] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!pendingChatPrompt) return;
    setInput(pendingChatPrompt);
    setPendingChatPrompt(null);
    inputRef.current?.focus();
  }, [pendingChatPrompt, setPendingChatPrompt]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const activeFile = useMemo(() => {
    if (!attachFile || !selectedPath) return null;
    const node = index.get(selectedPath);
    if (!node || node.type !== 'file') return null;
    return { path: selectedPath, content: readFileContent(selectedPath) };
  }, [attachFile, selectedPath, index, readFileContent]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: prompt }]);
    setInput('');
    setBusy(true);
    setSlow(false);

    const slowTimer = setTimeout(() => setSlow(true), 8000);

    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model,
          treeContext: buildTreeContext(paths),
          activeFile,
          history: messages.slice(-8).map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || `Request failed (${response.status})`);
      }

      const diffs: FileDiff[] = Array.isArray(data?.diffs) ? data.diffs : [];
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: data?.summary || 'Here is what I would change.',
          diffs: diffs.length > 0 ? diffs : undefined,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: err instanceof Error ? err.message : 'Something went wrong.',
          error: true,
        },
      ]);
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
      setSlow(false);
    }
  };

  const apply = (id: string, diffs: FileDiff[]) => {
    applyDiffs(diffs);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, applied: true } : m)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="pane-header">
        <Group gap={5}>
          <IconSparkles size={13} color="var(--accent)" />
          <span className="pane-title">Copilot</span>
        </Group>
        <Select
          value={model}
          onChange={(value) => setModel(value || MODELS[0].value)}
          data={MODELS}
          allowDeselect={false}
          w={148}
        />
      </div>

      {selectedPath && index.get(selectedPath)?.type === 'file' && (
        <div style={{ padding: '5px 8px 0' }}>
          <Tooltip label={attachFile ? 'Sending this file with your message' : 'File not attached'}>
            <Badge
              variant={attachFile ? 'light' : 'outline'}
              color={attachFile ? 'blue' : 'gray'}
              leftSection={attachFile ? <IconLink size={10} /> : <IconUnlink size={10} />}
              style={{ cursor: 'pointer', textTransform: 'none', maxWidth: '100%' }}
              onClick={() => setAttachFile((v) => !v)}
            >
              {selectedPath.slice(selectedPath.lastIndexOf('/') + 1)}
            </Badge>
          </Tooltip>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {messages.length === 0 && (
          <div style={{ padding: '20px 8px', textAlign: 'center' }}>
            <Text size="xs" c="dimmed">
              Ask for a layout change and apply the result to your plan.
            </Text>
            <Text size="xs" c="dark.3" mt="xs" style={{ lineHeight: 1.7 }}>
              “group these components by feature”
              <br />
              “split utils into io and format”
            </Text>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} style={{ alignSelf: 'flex-end', maxWidth: '92%' }}>
                <div
                  style={{
                    padding: '6px 9px',
                    fontSize: 12,
                    lineHeight: 1.5,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {message.text}
                </div>
              </div>
            ) : (
              <div key={message.id} style={{ alignSelf: 'flex-start', width: '100%' }}>
                <div
                  className="markdown-body"
                  style={{ color: message.error ? 'var(--removed)' : 'var(--text-dim)' }}
                >
                  <ReactMarkdown>{message.text}</ReactMarkdown>
                </div>
                {message.diffs && (
                  <DiffCard
                    diffs={message.diffs}
                    applied={Boolean(message.applied)}
                    onApply={() => apply(message.id, message.diffs!)}
                  />
                )}
              </div>
            ),
          )}

          {busy && (
            <Group gap={6}>
              <Loader size={11} type="dots" />
              <Text size="xs" c="dimmed">
                {slow ? 'Still working…' : 'Thinking…'}
              </Text>
            </Group>
          )}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: 8,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-1)',
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={inputRef}
            placeholder="Ask for a layout change…"
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={7}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Group justify="space-between" mt={5}>
            <Text size="xs" c="dark.3">
              Enter to send
            </Text>
            <ActionIcon
              type="submit"
              variant="filled"
              color="blue"
              disabled={!input.trim() || busy}
              loading={busy}
            >
              <IconSend size={13} />
            </ActionIcon>
          </Group>
        </form>
      </div>
    </div>
  );
}
