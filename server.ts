import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const PORT = Number(process.env.PORT) || 3000;

/**
 * The copilot returns a *batch* of structural changes through a response
 * schema, not prose with a JSON block buried in it. Parsing a fenced block out
 * of a stream was the single flakiest part of the version this replaces: one
 * change per turn, and a malformed fence failed silently.
 */
const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description:
        'One or two sentences, in markdown, explaining the reasoning. No code fences.',
    },
    diffs: {
      type: Type.ARRAY,
      description: 'Every structural change to apply. Empty when none are needed.',
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, enum: ['add', 'remove', 'update'] },
          path: {
            type: Type.STRING,
            description: 'Absolute path from the repo root, e.g. /src/lib/api.ts',
          },
          type: { type: Type.STRING, enum: ['file', 'folder'] },
          content: {
            type: Type.STRING,
            description: 'File body, for add/update of a file. Omit for folders.',
          },
        },
        required: ['action', 'path', 'type'],
      },
    },
  },
  required: ['summary', 'diffs'],
} as const;

const VALID_ACTIONS = new Set(['add', 'remove', 'update']);
const VALID_TYPES = new Set(['file', 'folder']);

interface RawDiff {
  action?: unknown;
  path?: unknown;
  type?: unknown;
  content?: unknown;
}

/**
 * A schema constrains shape, not meaning — the model can still return a
 * relative path or an unknown action. Anything that would not apply cleanly is
 * dropped here rather than in the store.
 */
function sanitizeDiffs(raw: unknown): Array<{
  action: string;
  path: string;
  type: string;
  content?: string;
}> {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out = [];

  for (const entry of raw as RawDiff[]) {
    const action = String(entry?.action ?? '');
    const type = String(entry?.type ?? '');
    let filePath = String(entry?.path ?? '').trim();

    if (!VALID_ACTIONS.has(action) || !VALID_TYPES.has(type) || !filePath) continue;

    filePath = '/' + filePath.replace(/^\/+/, '').replace(/\/+$/, '');
    if (filePath === '/' || filePath.includes('..')) continue;

    const key = `${action}:${filePath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const content = typeof entry?.content === 'string' ? entry.content : undefined;
    out.push({
      action,
      path: filePath,
      type,
      ...(content !== undefined && type === 'file' ? { content } : {}),
    });
  }

  return out;
}

function describeError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.includes('429') || raw.toLowerCase().includes('quota')) {
    return {
      status: 429,
      message: 'API quota exceeded. Check your key and billing, then try again.',
    };
  }
  if (raw.includes('401') || raw.includes('403') || raw.includes('API key')) {
    return { status: 401, message: 'The Gemini API key is missing or rejected.' };
  }

  // Gemini nests the useful message a couple of layers into a JSON string.
  try {
    const outer = JSON.parse(raw) as { error?: { message?: string } };
    if (outer.error?.message) {
      try {
        const inner = JSON.parse(outer.error.message) as { error?: { message?: string } };
        if (inner.error?.message) return { status: 502, message: inner.error.message };
      } catch {
        /* outer message was not itself JSON */
      }
      return { status: 502, message: outer.error.message };
    }
  } catch {
    /* not JSON at all */
  }

  return { status: 502, message: raw || 'The model request failed.' };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const ai = new GoogleGenAI({
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  app.post('/api/plan', async (req, res) => {
    const { prompt, model, treeContext, activeFile, history } = req.body ?? {};

    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'A prompt is required.' });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not set, so the copilot is unavailable. Everything else works.',
      });
      return;
    }

    const activeFileBlock =
      activeFile && typeof activeFile.path === 'string'
        ? [
            '',
            `The user is looking at ${activeFile.path}.`,
            typeof activeFile.content === 'string'
              ? `Its contents:\n\`\`\`\n${activeFile.content.slice(0, 24_000)}\n\`\`\``
              : '(Contents not loaded.)',
          ].join('\n')
        : '';

    const systemInstruction = [
      'You help a developer reorganise a repository file layout.',
      'You are given the current paths, one per line. Propose concrete structural changes.',
      '',
      'Rules:',
      '- Paths are absolute from the repo root and start with "/".',
      '- Only propose changes that follow from the request. Do not redesign the repo unasked.',
      '- To relocate a file, emit a "remove" of the old path and an "add" of the new one.',
      '- Prefer folders that already exist over inventing parallel ones.',
      '- Put reasoning in "summary". Keep it to a couple of sentences.',
      activeFileBlock,
      '',
      'Current paths:',
      typeof treeContext === 'string' && treeContext.trim()
        ? treeContext
        : '(The repository is empty.)',
    ].join('\n');

    const contents = [
      ...(Array.isArray(history)
        ? history
            .filter(
              (m: { role?: unknown; text?: unknown }) =>
                typeof m?.text === 'string' && m.text.trim(),
            )
            .map((m: { role?: unknown; text: string }) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.text }],
            }))
        : []),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    try {
      const response = await ai.models.generateContent({
        model: typeof model === 'string' && model ? model : 'gemini-3.5-flash',
        contents,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: PLAN_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        res.status(502).json({ error: 'The model returned an empty response.' });
        return;
      }

      let parsed: { summary?: unknown; diffs?: unknown };
      try {
        parsed = JSON.parse(text);
      } catch {
        res.status(502).json({ error: 'The model returned malformed JSON.' });
        return;
      }

      res.json({
        summary:
          typeof parsed.summary === 'string' && parsed.summary.trim()
            ? parsed.summary
            : 'Here is what I would change.',
        diffs: sanitizeDiffs(parsed.diffs),
      });
    } catch (error) {
      console.error('[/api/plan]', error);
      const { status, message } = describeError(error);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Express 4 wildcard. Express 5 would need '/*splat'.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Visual Repository Planner on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
