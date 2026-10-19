import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { Button, Card, Input, PageHeader, Select, useToast } from "../components/ui";
import { API_BASE, ApiError } from "../lib/api";

const DATASETS = ["analytics", "monitoring", "incidents", "performance", "errors", "deployments", "audit", "api_usage"] as const;

export function ReportsPage() {
  const toast = useToast();
  const [dataset, setDataset] = useState<(typeof DATASETS)[number]>("analytics");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [siteId, setSiteId] = useState("");

  const run = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({ dataset, format });
      if (from) params.set("from", String(new Date(from).getTime()));
      if (to) params.set("to", String(new Date(to).getTime()));
      if (siteId) params.set("siteId", siteId);
      const res = await fetch(`${API_BASE}/v1/exports?${params}`, { credentials: "include" });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      return res.blob();
    },
    onSuccess: async (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vxqor-${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast("success", "Export downloaded");
    },
    onError: (e) => toast("danger", e instanceof ApiError ? e.message : "Export failed"),
  });

  return (
    <>
      <PageHeader title="Reports & Exports" subtitle="Date-filtered CSV/JSON exports, capped at 50,000 rows. Secrets are never included." />
      <Card title="Build an export">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <Select label="Dataset" value={dataset} onChange={(e) => setDataset(e.target.value as typeof dataset)}>
            {DATASETS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
          <Input label="From (date)" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To (date)" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Input label="Site ID (optional, site-scoped datasets)" value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="site_…" />
          <div className="flex items-end justify-end">
            <Button type="submit" variant="primary" loading={run.isPending}>
              <Download size={14} /> Export
            </Button>
          </div>
        </form>
      </Card>
      <div className="mt-4">
        <Card title="Retention & backups" subtitle="Operational policy">
          <ul className="list-disc pl-5 text-xs leading-relaxed text-muted">
            <li>Monitor results: 30 days · analytics & performance: 90 days · audit & security: 365 days (configurable via VXQOR_RETENTION).</li>
            <li>Backups: <code className="font-mono text-ink">wrangler d1 export vxqor --local|--remote</code> produces a SQL dump; restore with <code className="font-mono text-ink">wrangler d1 execute --file</code>.</li>
            <li>Migrations are versioned in apps/api/migrations and applied with <code className="font-mono text-ink">wrangler d1 migrations apply</code>.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
