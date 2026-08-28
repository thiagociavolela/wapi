import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { migrate } from "./database/migrate.js";
import { pool } from "./database/pool.js";
import { ensureInitialAdmin } from "./modules/auth/auth.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { webhookRouter } from "./routes/webhooks.js";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
if (config.TRUST_PROXY) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "2mb", verify: (req, _res, buffer) => { (req as express.Request).rawBody = Buffer.from(buffer); } }));
app.use(cookieParser());
app.use("/webhooks", webhookRouter);
app.use("/api/auth", authRouter);
app.use("/api", apiRouter);
app.use("/vendor/emoji-picker", express.static(path.resolve(root, "../node_modules/emoji-picker-element"), { fallthrough: false }));
app.use("/vendor/emoji-data", express.static(path.resolve(root, "../node_modules/emoji-picker-element-data"), { fallthrough: false }));
app.use(express.static(root, { extensions: ["html"] }));
app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada." }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Erro interno." });
});

async function start() {
  await migrate();
  await ensureInitialAdmin();
  app.listen(config.PORT, () => console.log(`Central disponível em ${config.APP_URL}`));
}

start().catch(async (error) => { console.error("Falha na inicialização:", error); await pool.end(); process.exit(1); });
