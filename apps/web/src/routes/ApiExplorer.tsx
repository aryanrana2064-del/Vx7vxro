import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, PageHeader, Select, Textarea } from "../components/ui";
import { API_BASE, api } from "../lib/api";

const ENDPOINTS = [
  { method: "GET", path: "/v1/health", desc: "Liveness + database reachability (public)" },
  { method: "GET", path: "/v1/system/state", desc: "Bootstrap/auth/scheduler state (public)" },
  { method: "GET", path: "/v1/auth/session", desc: "Current session owner (cookie)" },
  { method: "GET", path: "/v1/sites", desc: "Website registry (session or sites:read key)" },
  { method: "GET", path: "/v1/monitors", desc: "Monitors with latest state (monitoring:read)" },
  { method: "GET", path: "/v1/incidents", desc: "Incident list (monitoring:read)" },
  { method: "GET", path: "/v1/dashboard/summary", desc: "Dashboard aggregates (monitoring:read)" },
  { method: "GET", path: "/v1/deployments", desc: "Deployment timeline (deployments:read)" },
  { method: "GET", path: "/v1/security/events", desc: "Security event log (security:read)" },
  { method: "GET", path: "/v1/audit", desc: "Audit trail (audit:read)" },
  { method: "GET", path: "/v1/keys", desc: "API key metadata (session only)" },
  { method: "GET", path: "/v1/exports?dataset=analytics&format=json", desc: "Analytics export (exports:read)" },
];

export function ApiExplorerPage() {
  const [selected, setSelected] = useState(ENDPOINTS[0]!);
  const [bearer, setBearer] = useState("");
  const [result, setResult] = useState<{ status: number; body: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useQuery({ queryKey: ["keys"], queryFn: () => api<{ keys: { id: string; name: string; prefix: string; scopes: string[] }[] }>("/v1/keys") });

  const send = async () => {
    setBusy(true);
    const start = performance.now();
    try {
      const headers: Record<string, string> = {};
      if (bearer) headers["authorization"] = `Bearer ${bearer}`;
      const res = await fetch(`${API_BASE}${selected.path}`, { headers, credentials: "include" });
      const text = await res.text();
      setResult({ status: res.status, body: pretty(text), ms: Math.round(performance.now() - start) });
    } catch (err) {
      setResult({ status: 0, body: String(err), ms: Math.round(performance.now() - start) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="API Explorer" subtitle="Safe read-only requests against the live backend. Responses are real, never mocked." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Request">
          <div className="flex flex-col gap-3">
            <Select label="Endpoint" value={`${selected.method} ${selected.path}`} onChange={(e) => setSelected(ENDPOINTS.find((x) => `${x.method} ${x.path}` === e.target.value) ?? ENDPOINTS[0]!)}>
              {ENDPOINTS.map((e) => (
                <option key={`${e.method} ${e.path}`} value={`${e.method} ${e.path}`}>
                  {e.method} {e.path}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted">{selected.desc}</p>
            <Select label="API key (optional — otherwise session cookie)" value={bearer} onChange={(e) => setBearer(e.target.value)}>
              <option value="">Use session cookie</option>
              {keys.data?.keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.prefix}…) — paste full key manually
                </option>
              ))}
            </Select>
            <Textarea label="Bearer token (full key, kept in memory only)" rows={2} value={bearer.startsWith("vxqor_") ? bearer : ""} onChange={(e) => setBearer(e.target.value)} placeholder="vxqor_…" />
            <Button variant="primary" onClick={() => void send()} loading={busy}>
              Send request
            </Button>
          </div>
        </Card>
        <Card title="Response" actions={result ? <Badge tone={result.status < 400 ? "success" : "danger"}>{result.status || "network error"} · {result.ms}ms</Badge> : undefined}>
          <pre className="max-h-96 overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted">{result?.body ?? "No request sent yet."}</pre>
        </Card>
      </div>
      <div className="mt-4">
        <Card title="Authentication scheme" subtitle="Documented, real schemas">
          <ul className="list-disc pl-5 text-xs leading-relaxed text-muted">
            <li>Owner session: HttpOnly SameSite cookie issued by /v1/auth/login (plus TOTP step when enrolled).</li>
            <li>Server keys: <code className="font-mono text-ink">Authorization: Bearer vxqor_…</code> with per-key scopes; secrets are hashed at rest and shown once.</li>
            <li>Public ingestion: <code className="font-mono text-ink">POST /v1/collect/:trackingId/…</code> — the tracking id is public and grants no admin access.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2).slice(0, 20000);
  } catch {
    return text.slice(0, 20000);
  }
}
