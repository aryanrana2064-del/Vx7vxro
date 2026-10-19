import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SiteSelect } from "../components/SiteSelect";
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, PageHeader, Select, Skeleton, Table, Td } from "../components/ui";
import { apiGet, apiPatch } from "../lib/api";
import { formatDateTime, formatNumber, timeAgo } from "../lib/format";

interface ErrorGroup {
  id: string;
  category: string;
  message: string;
  stack: string | null;
  path: string | null;
  release_tag: string | null;
  correlation_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  count: number;
  status: string;
}

export function ErrorsPage() {
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState("open");
  const [selected, setSelected] = useState<ErrorGroup | null>(null);
  const errors = useQuery({
    enabled: Boolean(siteId),
    queryKey: ["errors", siteId, status],
    queryFn: () => apiGet<{ errors: ErrorGroup[] }>(`/v1/sites/${siteId}/errors?status=${status}`),
  });
  const setStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch(`/v1/errors/${id}?status=${status}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["errors"] }),
  });

  return (
    <>
      <PageHeader
        title="Errors & Logs"
        subtitle="Grouped frontend exceptions captured by the snippet. Secrets are redacted before storage."
        actions={
          <>
            <SiteSelect value={siteId} onChange={setSiteId} />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status">
              <option value="open">open</option>
              <option value="resolved">resolved</option>
              <option value="ignored">ignored</option>
            </Select>
          </>
        }
      />
      {!siteId ? (
        <EmptyState title="Select a website" body="Error intelligence requires the tracking snippet on your site. VXQOR does not claim access to server logs unless an integration is configured." />
      ) : errors.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : errors.isError ? (
        <ErrorState message="Failed to load errors" onRetry={() => errors.refetch()} />
      ) : errors.data!.errors.length === 0 ? (
        <EmptyState title={`No ${status} errors`} body="Uncaught exceptions, unhandled rejections and manual reports group here by message signature." />
      ) : (
        <Card pad={false}>
          <Table head={["Message", "Category", "Count", "First seen", "Last seen", "Status"]}>
            {errors.data!.errors.map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setSelected(e)}>
                <Td className="max-w-[320px] truncate font-mono text-xs">{e.message}</Td>
                <Td>
                  <Badge tone="neutral">{e.category}</Badge>
                </Td>
                <Td className="text-xs tabular-nums">{formatNumber(e.count)}</Td>
                <Td className="text-xs text-muted">{formatDateTime(e.first_seen_at)}</Td>
                <Td className="text-xs text-muted">{timeAgo(e.last_seen_at)}</Td>
                <Td>
                  <Badge tone={e.status === "open" ? "danger" : "neutral"}>{e.status}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title="Error group">
        {selected ? (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs text-ink">{selected.message}</p>
            <div className="flex flex-wrap gap-2 text-[11px] text-muted">
              <Badge tone="neutral">{selected.category}</Badge>
              {selected.path ? <Badge tone="info">{selected.path}</Badge> : null}
              {selected.release_tag ? <Badge tone="neutral">release {selected.release_tag}</Badge> : null}
              {selected.correlation_id ? <Badge tone="neutral">corr {selected.correlation_id}</Badge> : null}
            </div>
            <p className="text-[11px] text-faint">
              first {formatDateTime(selected.first_seen_at)} · last {formatDateTime(selected.last_seen_at)} · {selected.count} occurrences
            </p>
            {selected.stack ? <pre className="max-h-72 overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted">{selected.stack}</pre> : null}
            <div className="flex gap-2">
              {selected.status !== "resolved" ? (
                <Button size="sm" variant="primary" onClick={() => setStatusMutation.mutate({ id: selected.id, status: "resolved" })}>
                  Mark resolved
                </Button>
              ) : null}
              {selected.status !== "ignored" ? (
                <Button size="sm" onClick={() => setStatusMutation.mutate({ id: selected.id, status: "ignored" })}>
                  Ignore
                </Button>
              ) : null}
              {selected.status !== "open" ? (
                <Button size="sm" onClick={() => setStatusMutation.mutate({ id: selected.id, status: "open" })}>
                  Reopen
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
