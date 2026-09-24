import { Router } from "express";
import { config } from "../config.js";
import { isValidMetaSignature } from "../modules/meta/signature.js";
import { processWebhook } from "../modules/meta/webhook.js";
import { isValidMercadoPagoSignature, processMercadoPagoPayment } from "../modules/payments/service.js";

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

webhookRouter.post("/mercado-pago", async (req, res) => {
  const dataId = String(req.query["data.id"] ?? req.body?.data?.id ?? "");
  const requestId = String(req.header("x-request-id") ?? "");
  if (!dataId || !requestId || !isValidMercadoPagoSignature(dataId, requestId, req.header("x-signature"))) return res.sendStatus(401);
  res.sendStatus(200);
  if (String(req.body?.type ?? req.query.type ?? "") !== "payment") return;
  void processMercadoPagoPayment(dataId).catch((error) => console.error("Falha ao processar webhook Mercado Pago:", error));
});
