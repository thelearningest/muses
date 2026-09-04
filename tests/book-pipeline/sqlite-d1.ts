import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { D1DatabaseBinding, D1PreparedStatementBinding, D1Result } from "../../app/lib/book-pipeline/runtime-env";

class Statement implements D1PreparedStatementBinding {
  constructor(private db: DatabaseSync, private sql: string, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.db,this.sql,values); }
  execute<T>(): D1Result<T> { const r = this.db.prepare(this.sql).run(...this.values as SQLInputValue[]); return { success: true, results: [], meta: { changes: Number(r.changes) } }; }
  async run<T>() { return this.execute<T>(); }
  async first<T>(): Promise<T | null> { return this.db.prepare(this.sql).get(...this.values as SQLInputValue[]) as T ?? null; }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: this.db.prepare(this.sql).all(...this.values as SQLInputValue[]) as T[] }; }
}

/** Executes checked-in production migrations, not a hand-maintained schema. */
export class MigratedD1 implements D1DatabaseBinding {
  readonly database = new DatabaseSync(":memory:");
  constructor() {
    const dir = resolve("drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) this.database.exec(readFileSync(resolve(dir,file),"utf8"));
  }
  prepare(sql: string) { return new Statement(this.database,sql); }
  async batch<T>(statements: D1PreparedStatementBinding[]): Promise<D1Result<T>[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((s) => (s as Statement).execute<T>());
      this.database.exec("COMMIT"); return results;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}
