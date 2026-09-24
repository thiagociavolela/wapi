import mysql, { type RowDataPacket } from "mysql2/promise";
import { config, MYSQL_TIME_ZONE } from "../../config.js";

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
  return String(value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p\s*>/gi, "\n\n").replace(/<\/li\s*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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

export function productCaption(product: Product) {
  const heading = `*${product.name}*`;
  const tail: string[] = [];
  if (product.price) tail.push(`Valor do produto: *${formattedPrice(product.price)}*`);
  const discount = formattedDiscount(product.discount);
  if (discount) tail.push(`Desconto: *${discount}*`);
  const priceAmount = numericValue(product.price); const discountAmount = numericValue(product.discount);
  if (Number.isFinite(priceAmount) && Number.isFinite(discountAmount) && discountAmount > 0) tail.push(`Valor com desconto: *${formattedPrice(priceAmount * (1 - discountAmount / 100))}*`);
  tail.push("Em até 3x sem juros no cartão.");
  const fixedLength = [heading, ...tail].join("\n\n").length;
  const description = (product.description || product.shortDescription).slice(0, Math.max(0, 1024 - fixedLength - 4));
  return [heading, ...(description ? [description] : []), ...tail].join("\n\n").slice(0, 1024);
}

export async function downloadProductImage(product: Product) {
  if (!product.imageUrl) throw new Error("Este produto não possui imagem cadastrada.");
  const url = new URL(product.imageUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("A imagem do produto possui uma URL inválida.");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!response.ok) throw new Error(`Não foi possível baixar a imagem do produto (${response.status}).`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "";
  if (!mimeType.startsWith("image/")) throw new Error("O arquivo cadastrado no produto não é uma imagem válida.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error("A imagem do produto deve ter no máximo 20 MB.");
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  return { buffer, mimeType, fileName: `produto-${product.id}.${extension}` };
}
