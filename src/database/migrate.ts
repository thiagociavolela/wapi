import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

export async function migrate() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(path.resolve(here, "../../migrations/001_initial.sql"), "utf8");
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean);
  for (const statement of statements) await pool.query(statement);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).then(() => console.log("Migrações aplicadas.")).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
