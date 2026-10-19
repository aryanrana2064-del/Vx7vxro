const SECRET_KEY = /(token|secret|password|cookie|authorization|key_hash|apikey|api_key)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function log(level: "debug" | "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, msg, ...(fields ? { fields: redact(fields) } : {}) };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
