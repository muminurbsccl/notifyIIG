/**
 * Apply SQL files (migrations, seeds) to a Postgres database.
 *
 * Usage:
 *   node scripts/apply-sql.mjs <file.sql> [file2.sql ...]
 *
 * Requires the DATABASE_URL environment variable (see .env.local).
 * Files are executed in the given order, each in its own connection.
 * Exits non-zero on the first failure and never prints SQL contents or values.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/apply-sql.mjs <file.sql> [...]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (see .env.local)");
  process.exit(2);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  for (const file of files) {
    const sql = await readFile(resolve(file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
      console.log(`OK ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
  console.log("All files applied.");
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
