import mysql, { type RowDataPacket } from "mysql2/promise";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { config, MYSQL_TIME_ZONE } from "../../config.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static") as string | null;

const productPool = mysql.createPool({
  host: config.PRODUCT_DB_HOST || "127.0.0.1",
  port: config.PRODUCT_DB_PORT,
  user: config.PRODUCT_DB_USER,
  password: config.PRODUCT_DB_PASSWORD,
  database: config.PRODUCT_DB_NAME,
  connectionLimit: 4,
  connectTimeout: 10000,
  timezone: MYSQL_TIME_ZONE,
  decimalNumbers: true
});

export interface Product {
  id: number;
  name: string;
  shortDescription: string;
  description: string;
  descriptionHtml: string;
  price: string;
  discount: string;
  imageUrl: string;
  active: boolean;
}

function ensureConfigured() {
  if (!config.PRODUCT_DB_HOST || !config.PRODUCT_DB_USER || !config.PRODUCT_DB_NAME) throw new Error("O banco de produtos ainda não foi configurado.");
}

function imageUrl(value: unknown) {
  const source = String(value ?? "").trim();
  if (!source) return "";
  try { return new URL(source, `${config.PRODUCT_IMAGE_BASE_URL.replace(/\/$/, "")}/`).href; } catch { return ""; }
}

function plainText(value: unknown) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/(p|div|h[1-6]|blockquote|section|article)\s*>/gi, "\n\n").replace(/<\/(li|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
      if (entity[0] === "#") { const hexadecimal = entity[1]?.toLowerCase() === "x"; const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10); return Number.isFinite(code) ? String.fromCodePoint(code) : ""; }
      return entities[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function mapProduct(row: RowDataPacket): Product {
  return {
    id: Number(row.id),
    name: String(row.nome ?? ""),
    shortDescription: plainText(row.desc_curta),
    description: plainText(row.descricao ?? row.desc_curta),
    descriptionHtml: String(row.descricao ?? row.desc_curta ?? ""),
    price: String(row.preco ?? ""),
    discount: String(row.desconto ?? ""),
    imageUrl: imageUrl(row.imagem),
    active: Number(row.status) === 0
  };
}

const PRODUCT_FIELDS = "id, nome, desc_curta, descricao, preco, desconto, imagem, status";

export async function searchProducts(search: string) {
  ensureConfigured();
  const term = search.trim().slice(0, 120);
  if (!term) return [];
  const [rows] = await productPool.execute<RowDataPacket[]>(`SELECT ${PRODUCT_FIELDS} FROM produtos WHERE nome LIKE ? ORDER BY status ASC, nome LIMIT 12`, [`%${term}%`]);
  return rows.map(mapProduct);
}

export async function getProduct(id: number) {
  ensureConfigured();
  const [rows] = await productPool.execute<RowDataPacket[]>(`SELECT ${PRODUCT_FIELDS} FROM produtos WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? mapProduct(rows[0]) : null;
}

function numericValue(value: string) {
  const source = value.replace(/[^\d,.-]/g, "").trim();
  if (!source) return NaN;
  return Number(source.includes(",") ? source.replace(/\./g, "").replace(",", ".") : source);
}

function formattedPrice(value: string | number) {
  if (typeof value === "number") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  const source = value.trim();
  if (!source || /R\$/i.test(source)) return source;
  const amount = numericValue(source);
  return Number.isFinite(amount) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount) : source;
}

function formattedDiscount(value: string) {
  const amount = numericValue(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(amount)}%`;
}

export function productCaption(product: Product, includeDescription = true) {
  const heading = `*${product.name}*`;
  const tail: string[] = [];
  if (product.price) tail.push(`Valor do produto: *${formattedPrice(product.price)}*`);
  const discount = formattedDiscount(product.discount);
  if (discount) tail.push(`Desconto: *${discount}*`);
  const priceAmount = numericValue(product.price); const discountAmount = numericValue(product.discount);
  if (Number.isFinite(priceAmount) && Number.isFinite(discountAmount) && discountAmount > 0) tail.push(`Valor com desconto: *${formattedPrice(priceAmount * (1 - discountAmount / 100))}*`);
  tail.push("Em até 3x sem juros no cartão.");
  const fixedLength = [heading, ...tail].join("\n\n").length;
  const description = includeDescription ? (product.description || product.shortDescription).slice(0, Math.max(0, 1024 - fixedLength - 4)) : "";
  return [heading, ...(description ? [description] : []), ...tail].join("\n\n").slice(0, 1024);
}

export function productDescriptionMessages(product: Product) {
  const description = plainText(product.descriptionHtml || product.description || product.shortDescription);
  if (!description) return [];
  const prefix = "*Descrição do produto:*\n\n"; const limit = 4000; const messages: string[] = [];
  let remaining = description;
  while (remaining) {
    const available = limit - (messages.length ? 0 : prefix.length);
    let end = Math.min(available, remaining.length);
    if (end < remaining.length) {
      const paragraph = remaining.lastIndexOf("\n", end); const space = remaining.lastIndexOf(" ", end);
      end = Math.max(paragraph, space, Math.floor(available * 0.75));
    }
    const part = remaining.slice(0, end).trim(); remaining = remaining.slice(end).trim();
    if (part) messages.push(`${messages.length ? "" : prefix}${part}`);
  }
  return messages;
}

export function convertProductImageToJpeg(input: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("FFmpeg não está disponível para converter a imagem do produto."));
    const process = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-frames:v", "1",
      "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
    ], { windowsHide: true });
    const output: Buffer[] = []; const errors: Buffer[] = [];
    process.stdout.on("data", (chunk) => output.push(Buffer.from(chunk)));
    process.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    process.on("error", () => reject(new Error("Não foi possível iniciar a conversão da imagem.")));
    process.on("close", (code) => code === 0 && output.length ? resolve(Buffer.concat(output)) : reject(new Error(Buffer.concat(errors).toString("utf8") || "Não foi possível converter a imagem do produto.")));
    process.stdin.end(input);
  });
}

export async function downloadProductImage(product: Product) {
  if (!product.imageUrl) throw new Error("Este produto não possui imagem cadastrada.");
  const url = new URL(product.imageUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("A imagem do produto possui uma URL inválida.");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!response.ok) throw new Error(`Não foi possível baixar a imagem do produto (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "";
  if (!mimeType.startsWith("image/")) throw new Error("O arquivo cadastrado no produto não é uma imagem válida.");
  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  if (!sourceBuffer.length || sourceBuffer.length > 20 * 1024 * 1024) throw new Error("A imagem original do produto deve ter no máximo 20 MB.");
  const buffer = await convertProductImageToJpeg(sourceBuffer);
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error("A imagem convertida excede o limite de 5 MB do WhatsApp.");
  return { buffer, mimeType: "image/jpeg", fileName: `produto-${product.id}.jpg` };
}
