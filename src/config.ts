import "dotenv/config";
import { z } from "zod";

export const SYSTEM_TIME_ZONE = "America/Sao_Paulo";
export const MYSQL_TIME_ZONE = "-03:00";
process.env.TZ = SYSTEM_TIME_ZONE;

const booleanValue = z.string().default("false").transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TRUST_PROXY: booleanValue,
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default("service_desk"),
  DB_PASSWORD: z.string().default("change-me"),
  DB_NAME: z.string().default("service_desk"),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  JWT_SECRET: z.string().min(32).default("development-secret-change-before-prod"),
  COOKIE_SECURE: booleanValue,
  ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().min(10).default("change-this-password"),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  META_PHONE_NUMBER_ID: z.string().default(""),
  META_WABA_ID: z.string().default(""),
  META_ACCESS_TOKEN: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default("")
});

export const config = schema.parse(process.env);
export const isMetaConfigured = () => Boolean(config.META_PHONE_NUMBER_ID && config.META_ACCESS_TOKEN);
