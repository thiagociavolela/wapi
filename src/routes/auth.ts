import { Router } from "express";
import { z } from "zod";
import { authenticate, clearSession, issueSession, requireAuth } from "../modules/auth/auth.js";

export const authRouter = Router();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "E-mail ou senha inválidos." });
  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return res.status(401).json({ error: "E-mail ou senha incorretos." });
  issueSession(res, user);
  res.json({ user });
});
authRouter.post("/logout", (_req, res) => { clearSession(res); res.status(204).end(); });
authRouter.get("/me", requireAuth, (req, res) => res.json({ user: req.auth }));
