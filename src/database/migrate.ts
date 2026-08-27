import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

export async function migrate() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsPath = path.resolve(here, "../../migrations");
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(190) PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);
  const files = (await fs.readdir(migrationsPath)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const [existing] = await pool.execute<any[]>("SELECT name FROM schema_migrations WHERE name = ?", [name]);
    if (existing.length) continue;
    const sql = await fs.readFile(path.join(migrationsPath, name), "utf8");
    const statements = sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of statements) await connection.query(statement);
      await connection.execute("INSERT INTO schema_migrations (name) VALUES (?)", [name]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).then(() => console.log("Migrações aplicadas.")).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
