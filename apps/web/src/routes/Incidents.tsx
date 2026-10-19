import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, PageHeader, Select, Skeleton, Table, Td, Textarea, statusTone } from "../components/ui";
import { apiGet, apiPost } from "../lib/api";
import { durationBetween, formatDateTime, timeAgo } from "../lib/format";

interface Incident {
  id: string;
  site_name: string;
  monitor_url: string | null;
  status: string;
  trigger_condition: string;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export function IncidentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const incidents = useQuery({
    queryKey: ["incidents", status],
    queryFn: () => apiGet<{ incidents: Incident[] }>(`/v1/incidents${status ? `?status=${status}` : ""}`),
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ["incident", selected],
    queryFn: () => apiGet<{ incident: Incident; events: { id: string; type: string; message: string; actor: string; created_at: string }[]; checks: Record<string, unknown>[] }>(`/v1/incidents/${selected}`),
  });

  const act = useMutation({
    mutationFn: ({ action, note }: { action: string; note: string }) => apiPost(`/v1/incidents/${selected}/${action}`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setNote("");
    },
  });

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Lifecycle: detected → acknowledged → investigating → resolved. Duplicates are suppressed per monitor."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="detected">detected</option>
            <option value="acknowledged">acknowledged</option>
            <option value="investigating">investigating</option>
            <option value="resolved">resolved</option>
          </Select>
        }
      />
      {incidents.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : incidents.isError ? (
        <ErrorState message="Failed to load incidents" onRetry={() => incidents.refetch()} />
      ) : incidents.data!.incidents.length === 0 ? (
        <EmptyState title="No incidents" body="Incidents open automatically when a monitor hits its failure threshold, and resolve when checks recover." />
      ) : (
        <Card pad={false}>
          <Table head={["Trigger", "Site", "Endpoint", "Status", "Detected", "Duration"]}>
            {incidents.data!.incidents.map((i) => (
              <tr key={i.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setSelected(i.id)}>
                <Td className="max-w-[260px] truncate text-xs">{i.trigger_condition}</Td>
                <Td className="text-xs text-muted">{i.site_name}</Td>
                <Td className="max-w-[180px] truncate font-mono text-xs">{i.monitor_url ?? "—"}</Td>
                <Td>
                  <Badge tone={statusTone(i.status)}>{i.status}</Badge>
                </Td>
                <Td className="text-xs text-muted">{timeAgo(i.detected_at)}</Td>
                <Td className="text-xs text-muted">{durationBetween(i.detected_at, i.resolved_at)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title="Incident detail">
        {detail.data ? (
          <div className="flex flex-col gap-4">
            <div>
              <Badge tone={statusTone(detail.data.incident.status)}>{detail.data.incident.status}</Badge>
              <p className="mt-2 text-sm text-ink">{detail.data.incident.trigger_condition}</p>
              <p className="mt-1 text-xs text-muted">
                {detail.data.incident.site_name} · {detail.data.incident.monitor_url ?? "no monitor"} · detected {formatDateTime(detail.data.incident.detected_at)}
              </p>
            </div>
            <Card title="Timeline" pad={false}>
              <ul className="divide-y divide-line">
                {detail.data.events.map((e) => (
                  <li key={e.id} className="px-3 py-2">
                    <p className="text-xs text-ink">
                      <Badge tone={statusTone(e.type)}>{e.type}</Badge> <span className="ml-1">{e.message}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {e.actor} · {formatDateTime(e.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Evidence — recent checks" pad={false}>
              {detail.data.checks.length ? (
                <Table head={["When", "Status", "Duration", "Error"]}>
                  {detail.data.checks.slice(0, 12).map((c) => (
                    <tr key={String(c.checked_at) + String(c.duration_ms)}>
                      <Td className="text-xs text-muted">{formatDateTime(c.checked_at as string)}</Td>
                      <Td>
                        <Badge tone={c.success === 1 ? "success" : "danger"}>{String(c.status_code ?? "—")}</Badge>
                      </Td>
                      <Td className="text-xs tabular-nums">{String(c.duration_ms)}ms</Td>
                      <Td className="max-w-[120px] truncate text-xs text-muted">{c.error_category !== "none" ? String(c.error_message ?? c.error_category) : ""}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <div className="p-3">
                  <EmptyState title="No check evidence" />
                </div>
              )}
            </Card>
            {detail.data.incident.status !== "resolved" ? (
              <div className="flex flex-col gap-2">
                <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "acknowledged", note })}>
                    Acknowledge
                  </Button>
                  <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "investigating", note })}>
                    Investigating
                  </Button>
                  <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate({ action: "resolved", note })}>
                    Resolve
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </Drawer>
    </>
  );
}
