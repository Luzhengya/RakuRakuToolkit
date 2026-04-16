/**
 * Local development entry point only.
 * Imports the Express app from api/index.ts and wraps it with Vite dev middleware.
 *
 * On Vercel, api/index.ts is used directly as a self-contained serverless function.
 * This file is never executed on Vercel.
 */
import app from "./api/index.js";
import path from "path";
import fs from "fs";
import type { Server } from "http";

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST;

function listenWithHelpfulError(applyListen: () => Server, label: string) {
  const server = applyListen();
  server.on("error", (err: any) => {
    if (err?.code === "EADDRINUSE") {
      console.error(`[${label}] Port ${PORT} is already in use. Try setting PORT=3001 and run again.`);
      process.exit(1);
    }
    if (err?.code === "EACCES") {
      console.error(
        `[${label}] Permission denied for ${HOST ?? "default-host"}:${PORT}. Try changing PORT or setting HOST=127.0.0.1.`
      );
      process.exit(1);
    }
    console.error(`[${label}] Server start failed:`, err);
    process.exit(1);
  });
  return server;
}

function startListening(onReady: () => void, label: string): Server {
  if (HOST) return listenWithHelpfulError(() => app.listen(PORT, HOST, onReady), label);
  return listenWithHelpfulError(() => app.listen(PORT, onReady), label);
}

async function startDevServer() {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  startListening(
    () => {
      console.log(`Dev server running on http://localhost:${PORT}`);
    },
    "dev"
  );
}

async function startProdServer() {
  const distPath = path.join(process.cwd(), "dist");
  const { default: express } = await import("express");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  // Periodic cleanup of any leftover temp files
  const uploadDir = path.join(process.cwd(), "uploads");
  if (fs.existsSync(uploadDir)) {
    setInterval(() => {
      const MAX_AGE = 60 * 60 * 1000;
      for (const name of fs.readdirSync(uploadDir)) {
        const fp = path.join(uploadDir, name);
        try {
          if (Date.now() - fs.statSync(fp).mtimeMs > MAX_AGE) fs.unlinkSync(fp);
        } catch { /* ignore */ }
      }
    }, 30 * 60 * 1000);
  }

  startListening(
    () => {
      console.log(`Server running on http://localhost:${PORT}`);
    },
    "prod"
  );
}

if (process.env.NODE_ENV !== "production") {
  startDevServer();
} else {
  startProdServer();
}
