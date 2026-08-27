import { Router } from "express";
import { config } from "../config.js";
import { isValidMetaSignature } from "../modules/meta/signature.js";
import { processWebhook } from "../modules/meta/webhook.js";

export const webhookRouter = Router();

webhookRouter.get("/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.META_WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

webhookRouter.post("/meta", async (req, res) => {
  if (!isValidMetaSignature(req.rawBody ?? Buffer.alloc(0), req.header("x-hub-signature-256"), config.META_APP_SECRET)) {
    return res.sendStatus(401);
  }
  try {
    await processWebhook(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Falha ao processar webhook Meta:", error);
    res.sendStatus(500);
  }
});
