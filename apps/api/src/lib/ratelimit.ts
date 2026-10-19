import { nowIso } from "./time";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Fixed-window rate limit persisted in D1 so it holds across isolates.
 * Windows are pruned by the retention job.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const row = await db
    .prepare("SELECT window_start, count FROM rate_limits WHERE key = ?")
    .bind(key)
    .first<{ window_start: string; count: number }>();
  if (!row || row.window_start !== windowStart) {
    await db
      .prepare("INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)")
      .bind(key, windowStart)
      .run();
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - 1 };
  }
  if (row.count >= limit) {
    const retry = Math.max(1, Math.ceil((new Date(windowStart).getTime() + windowSeconds * 1000 - now) / 1000));
    return { allowed: false, retryAfterSeconds: retry, remaining: 0 };
  }
  await db
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ? AND window_start = ?")
    .bind(key, windowStart)
    .run();
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - row.count - 1 };
}

export async function pruneRateLimits(db: D1Database, olderThanIso: string): Promise<number> {
  const res = await db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(olderThanIso).run();
  return res.meta.changes ?? 0;
}

export const _nowIso = nowIso;
