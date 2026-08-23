/**
 * ─── Serveur de développement / production ─────────────────────────────────────
 * En développement, Vite sert l'application en middleware (rechargement à
 * chaud). En production, on sert `dist/` et on renvoie `index.html` sur toutes
 * les routes — l'application est une SPA, c'est le routeur du navigateur qui
 * décide de la page, pas le serveur.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "http";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: { usePolling: true },
      },
      appType: "spa",
    });

    app.use(vite.middlewares);

    app.get("*", async (req, res) => {
      if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
      try {
        const indexHtmlPath = path.join(process.cwd(), "index.html");
        let template = fs.readFileSync(indexHtmlPath, "utf-8");
        template = await vite.transformIndexHtml(req.url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        res.status(500).end((e as Error).message);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Altech Cafeteria — http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Le serveur n'a pas pu démarrer :", err);
  process.exit(1);
});
