import { newId } from "./ids";
import { nowIso } from "./time";

export interface AuditInput {
  db: D1Database;
  ownerId?: string | null;
  category: string;
  action: string;
  actor: string;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown> | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  await input.db
    .prepare(
      "INSERT INTO audit_events (id, owner_id, category, action, actor, ip, user_agent, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      newId("aud"),
      input.ownerId ?? null,
      input.category,
      input.action,
      input.actor,
      input.ip ?? null,
      input.userAgent ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
      nowIso(),
    )
    .run();
}

export interface SecurityEventInput {
  db: D1Database;
  kind: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail?: string | null;
  siteId?: string | null;
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  await input.db
    .prepare(
      "INSERT INTO security_events (id, kind, severity, title, detail, site_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(newId("sec"), input.kind, input.severity, input.title, input.detail ?? null, input.siteId ?? null, nowIso())
    .run();
}
