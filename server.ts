/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { generateDebugApk, ApkBuildMetadata } from "./scripts/apkBuilder";

const MODEL_UPGRADES: Record<string, string> = {
  "gemini-2.5-flash": "gemini-3-flash-preview",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
  "gemini-2.0-flash": "gemini-3-flash-preview",
  "gemini-2.0-flash-exp": "gemini-3-flash-preview",
};

function resolveModel(model?: string): string {
  if (!model) return "gemini-3-flash-preview";
  return MODEL_UPGRADES[model] || model;
}

function serializeGenerateContentResponse(r: any) {
  return {
    candidates: r?.candidates,
    promptFeedback: r?.promptFeedback,
    usageMetadata: r?.usageMetadata,
    modelVersion: r?.modelVersion,
    responseId: r?.responseId,
    text: r?.text,
    functionCalls: r?.functionCalls,
    data: r?.data,
    executableCode: r?.executableCode,
    codeExecutionResult: r?.codeExecutionResult,
  };
}

const chats = new Map<string, any>();
const videoOps = new Map<string, any>();
let latestApkMetadata: ApkBuildMetadata | null = null;

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Build initial debug/debug.apk on startup
  try {
    latestApkMetadata = generateDebugApk(process.cwd());
    console.log(`[APK Auto-Sync] Generated debug/debug.apk (${latestApkMetadata.versionName})`);
  } catch (err) {
    console.error("[APK Auto-Sync] Initial APK build error:", err);
  }

  // Watch source files so any future update automatically rebuilds debug/debug.apk
  let rebuildTimeout: NodeJS.Timeout | null = null;
  const triggerApkRebuild = (changedPath: string) => {
    if (changedPath.includes("debug") || changedPath.includes("node_modules") || changedPath.includes(".git")) return;
    if (rebuildTimeout) clearTimeout(rebuildTimeout);
    rebuildTimeout = setTimeout(() => {
      try {
        latestApkMetadata = generateDebugApk(process.cwd());
        console.log(`[APK Auto-Sync] Updated debug/debug.apk after change in ${changedPath} -> ${latestApkMetadata.versionName}`);
      } catch (e) {
        console.error("[APK Auto-Sync] Rebuild error:", e);
      }
    }, 600);
  };

  for (const watchTarget of ["components", "context", "hooks", "services", "sessions", "App.tsx", "index.html", "config.ts"]) {
    const fullTarget = path.join(process.cwd(), watchTarget);
    if (fs.existsSync(fullTarget)) {
      try {
        fs.watch(fullTarget, { recursive: false }, (_eventType, filename) => {
          triggerApkRebuild(filename ? `${watchTarget}/${filename}` : watchTarget);
        });
      } catch {
        // Ignore watch errors on unsupported platforms
      }
    }
  }

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  for (const dir of ["examples", "assets", "public", "debug"]) {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
      app.use(`/${dir}`, express.static(dirPath));
    }
  }

  app.get("/debug/debug.apk", (_req, res) => {
    const apkFile = path.join(process.cwd(), "debug", "debug.apk");
    if (!fs.existsSync(apkFile)) {
      latestApkMetadata = generateDebugApk(process.cwd());
    }
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="debug.apk"');
    res.sendFile(apkFile);
  });

  app.get("/api/apk-info", (_req, res) => {
    if (!latestApkMetadata) {
      latestApkMetadata = generateDebugApk(process.cwd());
    }
    res.json(latestApkMetadata);
  });

  app.post("/api/apk-rebuild", (_req, res) => {
    try {
      latestApkMetadata = generateDebugApk(process.cwd());
      res.json(latestApkMetadata);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to rebuild debug.apk" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/generate-content", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const params = { ...req.body, model: resolveModel(req.body?.model) };
      const response = await ai.models.generateContent(params);
      return res.json(serializeGenerateContentResponse(response));
    } catch (error: any) {
      console.error("[Backend] /api/generate-content error:", error);
      return res.status(500).json({ error: error.message || "Failed to generate content." });
    }
  });

  app.post("/api/generate-content-stream", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const params = { ...req.body, model: resolveModel(req.body?.model) };
      const stream = await ai.models.generateContentStream(params);
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      for await (const chunk of stream) {
        res.write(JSON.stringify(serializeGenerateContentResponse(chunk)) + "\n");
      }
      res.end();
    } catch (error: any) {
      console.error("[Backend] /api/generate-content-stream error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message || "Failed to stream content." });
      }
      res.end();
    }
  });

  app.post("/api/chat-message", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const { sessionId, model, config, history, message, msgConfig } = req.body || {};
      const ai = new GoogleGenAI({ apiKey });
      let chat = sessionId ? chats.get(sessionId) : undefined;
      if (!chat) {
        chat = ai.chats.create({
          model: resolveModel(model),
          config,
          history,
        });
        if (sessionId) chats.set(sessionId, chat);
      }
      const response = await chat.sendMessage({ message, config: msgConfig });
      return res.json(serializeGenerateContentResponse(response));
    } catch (error: any) {
      console.error("[Backend] /api/chat-message error:", error);
      return res.status(500).json({ error: error.message || "Failed to send chat message." });
    }
  });

  app.post("/api/chat-stream", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const { sessionId, model, config, history, message, msgConfig } = req.body || {};
      const ai = new GoogleGenAI({ apiKey });
      let chat = sessionId ? chats.get(sessionId) : undefined;
      if (!chat) {
        chat = ai.chats.create({
          model: resolveModel(model),
          config,
          history,
        });
        if (sessionId) chats.set(sessionId, chat);
      }
      const stream = await chat.sendMessageStream({ message, config: msgConfig });
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      for await (const chunk of stream) {
        res.write(JSON.stringify(serializeGenerateContentResponse(chunk)) + "\n");
      }
      res.end();
    } catch (error: any) {
      console.error("[Backend] /api/chat-stream error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message || "Failed to stream chat message." });
      }
      res.end();
    }
  });

  app.post("/api/generate-images", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateImages(req.body);
      return res.json(response);
    } catch (error: any) {
      console.error("[Backend] /api/generate-images error:", error);
      return res.status(500).json({ error: error.message || "Failed to generate images." });
    }
  });

  app.post("/api/generate-videos", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const op = await ai.models.generateVideos(req.body);
      if (op.name) {
        videoOps.set(op.name, op);
      }
      return res.json({
        name: op.name,
        done: op.done,
        metadata: op.metadata,
        error: op.error,
        response: op.response,
      });
    } catch (error: any) {
      console.error("[Backend] /api/generate-videos error:", error);
      return res.status(500).json({ error: error.message || "Failed to start video generation." });
    }
  });

  app.post("/api/videos-operation", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const opName = req.body?.operation?.name;
      const storedOp = opName ? videoOps.get(opName) : undefined;
      if (!storedOp) {
        return res.status(404).json({ error: "Video operation not found on server." });
      }
      const op = await ai.operations.getVideosOperation({ operation: storedOp });
      if (op.name) {
        videoOps.set(op.name, op);
      }
      const responseCopy = op.response ? JSON.parse(JSON.stringify(op.response)) : undefined;
      if (op.done && responseCopy?.generatedVideos) {
        for (const gv of responseCopy.generatedVideos) {
          if (gv.video?.uri) {
            gv.video.uri = `/api/video-download?uri=${encodeURIComponent(gv.video.uri)}`;
          }
        }
      }
      return res.json({
        name: op.name,
        done: op.done,
        metadata: op.metadata,
        error: op.error,
        response: responseCopy,
      });
    } catch (error: any) {
      console.error("[Backend] /api/videos-operation error:", error);
      return res.status(500).json({ error: error.message || "Failed to poll video operation." });
    }
  });

  app.get("/api/video-download", async (req, res): Promise<any> => {
    try {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
      if (!apiKey) {
        return res.status(503).json({ error: "API key is not configured." });
      }
      const rawUri = String(req.query.uri || "").split("&key=")[0];
      if (!rawUri) {
        return res.status(400).json({ error: "Missing uri parameter." });
      }
      const sep = rawUri.includes("?") ? "&" : "?";
      const downloadUrl = `${rawUri}${sep}key=${apiKey}`;
      const upstream = await fetch(downloadUrl);
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return res.status(upstream.status).send(errText || upstream.statusText);
      }
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
      const arrayBuf = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuf));
    } catch (error: any) {
      console.error("[Backend] /api/video-download error:", error);
      return res.status(500).json({ error: error.message || "Failed to download video." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Backend] Server running on http://localhost:${PORT}`);
  });
}

startServer();
