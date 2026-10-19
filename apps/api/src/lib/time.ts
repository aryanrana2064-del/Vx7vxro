import type { AnalyticRange } from "@vxqor/shared";
import { RANGE_MS } from "@vxqor/shared";

export const nowIso = () => new Date().toISOString();

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function secondsAgoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

export function rangeBounds(range: AnalyticRange): { from: string; to: string } {
  const to = Date.now();
  return { from: new Date(to - RANGE_MS[range]).toISOString(), to: new Date(to).toISOString() };
}

/** Bucket size in ms used for time series aggregation per range. */
export function bucketMs(range: AnalyticRange): number {
  switch (range) {
    case "24h":
      return 3600_000;
    case "7d":
      return 6 * 3600_000;
    case "30d":
      return 24 * 3600_000;
    case "90d":
      return 24 * 3600_000;
  }
}

export function floorToBucket(ms: number, bucket: number): number {
  return Math.floor(ms / bucket) * bucket;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}
