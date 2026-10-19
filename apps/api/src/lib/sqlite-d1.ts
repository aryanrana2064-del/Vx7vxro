/**
 * Minimal D1-compatible shim over node:sqlite for local development and tests.
 * Implements the subset of the D1 API used by this codebase:
 * prepare().bind().all()/first()/run() and batch().
 */
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from "node:sqlite";

// Loaded via createRequire so bundlers/test runners do not try to resolve the
// node: builtin statically.
const nodeSqlite = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const DatabaseSync = nodeSqlite.DatabaseSync;
type DatabaseSync = DatabaseSyncType;

interface PendingOp {
  type: "all" | "first" | "run";
  col?: string;
}

class SqliteStatement {
  private params: unknown[] = [];
  private op: PendingOp | null = null;

  constructor(
    private db: DatabaseSync,
    private sql: string,
  ) {}

  bind(...params: unknown[]): this {
    this.params = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
    return this;
  }

  private args(): SQLInputValue[] {
    return this.params.map((p) => (p === undefined ? null : p)) as SQLInputValue[];
  }

  all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { changes: number; last_row_id: number; duration: number } }> {
    this.op = { type: "all" };
    return this.executeAll() as Promise<{ results: T[]; meta: { changes: number; last_row_id: number; duration: number } }>;
  }

  first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    this.op = { type: "first", col };
    return this.executeFirst<T>(col);
  }

  run(): Promise<{ results: []; meta: { changes: number; last_row_id: number; duration: number } }> {
    this.op = { type: "run" };
    return this.executeRun();
  }

  private executeAll() {
    const start = Date.now();
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...this.args()) as Record<string, unknown>[];
    return Promise.resolve({ results, meta: { changes: 0, last_row_id: 0, duration: Date.now() - start } });
  }

  private executeFirst<T>(col?: string) {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.args()) as Record<string, unknown> | undefined;
    if (row === undefined) return Promise.resolve(null);
    if (col) return Promise.resolve((row[col] as T) ?? null);
    return Promise.resolve(row as T);
  }

  private executeRun() {
    const stmt = this.db.prepare(this.sql);
    const res = stmt.run(...this.args());
    return Promise.resolve({
      results: [] as [],
      meta: { changes: Number(res.changes), last_row_id: Number(res.lastInsertRowid), duration: 0 },
    });
  }

  /** Used by batch(): replays the chained operation. */
  async replay(): Promise<unknown> {
    const op = this.op ?? { type: "run" };
    if (op.type === "all") return this.executeAll();
    if (op.type === "first") return this.executeFirst(op.col);
    return this.executeRun();
  }
}

export class SqliteD1 {
  constructor(private db: DatabaseSync) {
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements: SqliteStatement[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const s of statements) out.push(await s.replay());
    return out;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

export function openSqliteD1(path: string): SqliteD1 {
  return new SqliteD1(new DatabaseSync(path));
}

export function openMemorySqliteD1(): SqliteD1 {
  return new SqliteD1(new DatabaseSync(":memory:"));
}

export function applyMigrations(d1: SqliteD1, migrationSql: string[]): void {
  for (const sql of migrationSql) d1.exec(sql);
}
