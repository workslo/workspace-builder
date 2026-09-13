import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/chat", async (req, res) => {
    try {
      const { prompt, currentStructure } = req.body;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          systemInstruction: `You are an AI Copilot for a Visual Repository Planner.
The user is working on a file tree.
The current file tree state in JSON format is:
${JSON.stringify(currentStructure)}

Please analyze the user request and propose changes to the current file tree.
You must return a JSON array of structural diffs. Each diff should have:
- "action": "add" or "remove"
- "path": e.g., "/src/components/NewFile.tsx"
- "type": "folder" or "file"

Ensure you only respond with the structural diff JSON based on the user's prompt. Try to suggest practical additions.
`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              thoughts: {
                type: Type.STRING,
                description: "Your brief thought process"
              },
              diffs: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    action: { type: Type.STRING, description: "'add' or 'remove' or 'update'" },
                    path: { type: Type.STRING, description: "Absolute path like '/src/components/MyComponent.tsx'" },
                    type: { type: Type.STRING, description: "'folder' or 'file'" }
                  },
                  required: ["action", "path", "type"]
                }
              }
            },
            required: ["diffs"]
          }
        }
      });
      console.log(response.text);
      res.json(JSON.parse(response.text));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
