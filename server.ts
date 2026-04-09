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

const PORT = Number(process.env.PORT) || 3000;

async function startDevServer() {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Dev server running on http://localhost:${PORT}`);
  });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== "production") {
  startDevServer();
} else {
  startProdServer();
}
