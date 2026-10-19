import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus } from "lucide-react";
import { useState } from "react";
import type { MonitorRow } from "@vxqor/shared";
import { RangeSelect } from "../components/AppShell";
import { TimeSeriesChart } from "../components/charts";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusDot,
  statusTone,
  Table,
  Td,
  useToast,
} from "../components/ui";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { formatDateTime, formatMs, formatPct, timeAgo } from "../lib/format";

interface MonitorFull extends MonitorRow {
  site_name: string;
}

export function MonitoringPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const monitors = useQuery({ queryKey: ["monitors"], queryFn: () => apiGet<{ monitors: MonitorFull[] }>("/v1/monitors") });
  const sites = useQuery({ queryKey: ["sites"], queryFn: () => apiGet<{ sites: { id: string; name: string }[] }>("/v1/sites") });
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "90d">("24h");
  const [form, setForm] = useState({ siteId: "", url: "", intervalSeconds: 300, timeoutMs: 10000, failureThreshold: 2, slowThresholdMs: 3000 });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost("/v1/monitors", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      setCreateOpen(false);
      toast("success", "Monitor created — first check runs on the next scheduler tick");
    },
    onError: (e) => setError(e instanceof ApiError ? `${e.message}${(e.payload as Record<string, unknown> | null) && "reason" in (e.payload as object) ? ` (${String((e.payload as { reason: unknown }).reason)})` : ""}` : "Failed"),
  });

  const checkNow = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/monitors/${id}/check-now`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      qc.invalidateQueries({ queryKey: ["monitor-detail"] });
      toast("success", "Manual check completed");
    },
  });

  const summary = useQuery({
    enabled: Boolean(selected),
    queryKey: ["monitor-detail", selected, range],
    queryFn: () => apiGet<{ checks: number; uptimePct: number | null; p50: number | null; p95: number | null; p99: number | null; timeseries: { ts: string; p50: number | null; uptimePct: number }[] }>(`/v1/monitors/${selected}/summary?range=${range}`),
  });
  const results = useQuery({
    enabled: Boolean(selected),
    queryKey: ["monitor-results", selected, range],
    queryFn: () => apiGet<{ results: Record<string, unknown>[] }>(`/v1/monitors/${selected}/results?range=${range}&limit=100`),
  });

  return (
    <>
      <PageHeader
        title="Monitoring"
        subtitle="Scheduled HTTP checks with SSRF-safe target validation. Intervals respect the deployed scheduler plan."
        actions={
          <>
            <RangeSelect value={range} onChange={setRange} />
            <Button variant="primary" onClick={() => setCreateOpen(true)} disabled={!sites.data?.sites.length}>
              <Plus size={14} /> Add monitor
            </Button>
          </>
        }
      />
      {monitors.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : monitors.isError ? (
        <ErrorState message="Failed to load monitors" onRetry={() => monitors.refetch()} />
      ) : monitors.data!.monitors.length === 0 ? (
        <EmptyState
          title="No monitors configured"
          body="Monitors perform real HTTP checks from the scheduler: status, latency, redirects and security headers. Unsafe targets (loopback, private ranges, metadata endpoints) are rejected server-side."
          action={
            sites.data?.sites.length ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Add monitor
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card pad={false}>
          <Table head={["Endpoint", "Site", "Status", "Interval", "Last check", "Latency", ""]}>
            {monitors.data!.monitors.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setSelected(m.id)}>
                <Td className="max-w-[260px] truncate font-mono text-xs">{m.url}</Td>
                <Td className="text-xs text-muted">{m.site_name}</Td>
                <Td>
                  <StatusDot tone={statusTone(m.status)} label={m.status} />
                </Td>
                <Td className="text-xs text-muted">{m.interval_seconds}s</Td>
                <Td className="text-xs text-muted">{timeAgo(m.last_check_at)}</Td>
                <Td className="text-xs text-muted">{m.enabled ? "" : <Badge tone="warn">disabled</Badge>}</Td>
                <Td>
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      checkNow.mutate(m.id);
                    }}
                    loading={checkNow.isPending && checkNow.variables === m.id}
                  >
                    <Play size={12} /> Check now
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Add monitor" wide>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <div className="col-span-2">
            <Select label="Website" required value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">Select site…</option>
              {sites.data?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <Input label="Target URL" required placeholder="https://example.com/health" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} hint="http/https only. Loopback, private, link-local and metadata targets are blocked." />
          </div>
          <Input label="Interval (seconds)" type="number" min={60} max={86400} value={form.intervalSeconds} onChange={(e) => setForm({ ...form, intervalSeconds: Number(e.target.value) })} />
          <Input label="Timeout (ms)" type="number" min={1000} max={30000} value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} />
          <Input label="Failure threshold" type="number" min={1} max={10} value={form.failureThreshold} onChange={(e) => setForm({ ...form, failureThreshold: Number(e.target.value) })} hint="Consecutive failures before DOWN" />
          <Input label="Slow threshold (ms)" type="number" min={100} max={60000} value={form.slowThresholdMs} onChange={(e) => setForm({ ...form, slowThresholdMs: Number(e.target.value) })} hint="Above this the endpoint is degraded" />
          {error ? (
            <p role="alert" className="col-span-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create monitor
            </Button>
          </div>
        </form>
      </Dialog>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title="Monitor detail">
        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Checks in range" value={summary.data ? `${summary.data.checks}` : "…"} />
              <Stat label="Uptime" value={summary.data ? formatPct(summary.data.uptimePct) : "…"} />
              <Stat label="p50 latency" value={summary.data ? formatMs(summary.data.p50) : "…"} />
              <Stat label="p95 latency" value={summary.data ? formatMs(summary.data.p95) : "…"} />
            </div>
            {summary.data?.timeseries.length ? (
              <TimeSeriesChart data={summary.data.timeseries.map((t) => ({ ts: t.ts, value: t.p50 ?? 0 }))} range={range} unit="ms" height={160} />
            ) : (
              <EmptyState title="No checks in this window" body="Results appear after the scheduler runs checks for this monitor." />
            )}
            <Card title="Recent results" pad={false}>
              {results.data?.results.length ? (
                <Table head={["When", "Status", "Duration", "Error"]}>
                  {results.data.results.map((r) => (
                    <tr key={String(r.id)}>
                      <Td className="text-xs text-muted">{formatDateTime(r.checked_at as string)}</Td>
                      <Td>
                        <Badge tone={r.success === 1 ? "success" : "danger"}>{String(r.status_code ?? "—")}</Badge>
                      </Td>
                      <Td className="text-xs tabular-nums">{formatMs(r.duration_ms as number)}</Td>
                      <Td className="max-w-[140px] truncate text-xs text-muted">{r.error_category !== "none" ? String(r.error_category) : ""}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <div className="p-3">
                  <EmptyState title="No results yet" />
                </div>
              )}
            </Card>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-faint">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
