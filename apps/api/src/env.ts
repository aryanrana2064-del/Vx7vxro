export interface AppEnv {
  DB: D1Database;
  VXQOR_WEB_ORIGIN?: string;
  VXQOR_BOOTSTRAP_SECRET?: string;
  VXQOR_ENCRYPTION_KEY?: string;
  VXQOR_PBKDF2_ITERATIONS?: string;
  VXQOR_MAX_CHECKS_PER_RUN?: string;
  VXQOR_RETENTION?: string;
  VXQOR_REMOTE_API_URL?: string;
  VXQOR_REMOTE_API_TOKEN?: string;
  /** Set by the Node dev/test harness; never present on Workers. */
  VXQOR_RUNTIME?: "workers" | "node";
  VXQOR_DEV?: "1";
}

export interface AppConfig {
  webOrigin: string;
  bootstrapSecret: string | null;
  encryptionKey: Uint8Array | null;
  pbkdf2Iterations: number;
  maxChecksPerRun: number;
  runtime: "workers" | "node";
  dev: boolean;
  retention: Record<string, number>;
  remoteApiUrl: string | null;
  remoteApiToken: string | null;
}

const DEFAULT_RETENTION: Record<string, number> = {
  monitor_results: 30,
  analytics_events: 90,
  perf_events: 90,
  audit_events: 365,
  security_events: 365,
  api_usage_hourly: 90,
};

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number, field: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${field}: expected integer between ${min} and ${max} (value redacted)`);
  }
  return n;
}

export function loadConfig(env: AppEnv): AppConfig {
  const webOrigin = (env.VXQOR_WEB_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "");
  let encryptionKey: Uint8Array | null = null;
  if (env.VXQOR_ENCRYPTION_KEY) {
    const hex = env.VXQOR_ENCRYPTION_KEY.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error("Invalid VXQOR_ENCRYPTION_KEY: expected 64 hex characters");
    }
    encryptionKey = Uint8Array.from(Buffer_or_hex(hex));
  }
  const retention = { ...DEFAULT_RETENTION };
  if (env.VXQOR_RETENTION) {
    for (const part of env.VXQOR_RETENTION.split(",")) {
      const [table, days] = part.split(":");
      if (!table || !days) continue;
      const d = Number(days);
      if (Number.isInteger(d) && d > 0 && d <= 3650) retention[table.trim()] = d;
    }
  }
  return {
    webOrigin,
    bootstrapSecret: env.VXQOR_BOOTSTRAP_SECRET?.trim() || null,
    encryptionKey,
    pbkdf2Iterations: parseIntEnv(env.VXQOR_PBKDF2_ITERATIONS, 210_000, 10_000, 1_000_000, "VXQOR_PBKDF2_ITERATIONS"),
    maxChecksPerRun: parseIntEnv(env.VXQOR_MAX_CHECKS_PER_RUN, 15, 1, 200, "VXQOR_MAX_CHECKS_PER_RUN"),
    runtime: env.VXQOR_RUNTIME === "node" ? "node" : "workers",
    dev: env.VXQOR_DEV === "1",
    retention,
    remoteApiUrl: (env.VXQOR_REMOTE_API_URL ?? "https://vxqor-api.aryanrana2064.workers.dev").replace(/\/+$/, "") || null,
    remoteApiToken: env.VXQOR_REMOTE_API_TOKEN?.trim() || null,
  };
}

function Buffer_or_hex(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return out;
}
