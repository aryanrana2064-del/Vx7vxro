import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "@vxqor/shared";
import { MetricTile, TimeSeriesChart } from "../components/charts";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, StatusDot, statusTone, Table, Td } from "../components/ui";
import { apiGet } from "../lib/api";
import { formatMs, formatNumber, formatPct, timeAgo } from "../lib/format";

export function OverviewPage() {
  const summary = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<DashboardSummary>("/v1/dashboard/summary"), refetchInterval: 60_000 });
  const monitors = useQuery({ queryKey: ["monitors"], queryFn: () => apiGet<{ monitors: Record<string, unknown>[] }>("/v1/monitors") });
  const incidents = useQuery({ queryKey: ["incidents-open"], queryFn: () => apiGet<{ incidents: Record<string, unknown>[] }>("/v1/incidents") });

  if (summary.isLoading) return <Skeleton className="h-64 w-full" />;
  if (summary.isError) return <ErrorState message="Could not load dashboard data" onRetry={() => summary.refetch()} />;
  const s = summary.data!;

  const openIncidents = (incidents.data?.incidents ?? []).filter((i) => i.status !== "resolved");

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Live state of your monitored assets. Every metric is computed from stored measurements."
        actions={
          s.schedulerStale ? (
            <Badge tone="warn">Scheduler stale</Badge>
          ) : (
            <Badge tone={s.schedulerLastRunAt ? "success" : "neutral"}>Scheduler {s.schedulerLastRunAt ? timeAgo(s.schedulerLastRunAt) : "idle"}</Badge>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Websites" value={formatNumber(s.sites)} sub="registered & enabled" />
        <MetricTile label="Endpoints up" value={`${s.monitorsUp}`} sub={`${s.monitorsDegraded} degraded · ${s.monitorsDown} down · ${s.monitorsUnknown} unknown`} tone={s.monitorsDown > 0 ? "danger" : s.monitorsDegraded > 0 ? "warn" : "success"} />
        <MetricTile label="Uptime (7d)" value={formatPct(s.uptimePct)} sub="successful checks / total checks" tone={s.uptimePct !== null && s.uptimePct < 99 ? "warn" : undefined} />
        <MetricTile label="Open incidents" value={`${s.openIncidents}`} sub={`${s.acknowledgedIncidents} acknowledged/investigating`} tone={s.openIncidents > 0 ? "danger" : undefined} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="p50 response" value={formatMs(s.responseP50)} sub="7d successful checks" />
        <MetricTile label="p95 response" value={formatMs(s.responseP95)} sub="7d successful checks" />
        <MetricTile label="Last check" value={s.lastCheckAt ? timeAgo(s.lastCheckAt) : "never"} sub={s.lastCheckAt ?? "no monitoring results yet"} />
        <MetricTile label="Last ingestion" value={s.lastIngestionAt ? timeAgo(s.lastIngestionAt) : "never"} sub={s.analyticsConfigured ? "analytics events received" : "no analytics events yet"} />
      </div>

      {!s.notificationsConfigured ? (
        <div className="mt-3 rounded-md border border-[#4d3a12] bg-[#2b2109] px-3 py-2 text-xs text-warn">
          Alert notifications are not configured. Incidents will be recorded but no external alerts are sent.{" "}
          <Link to="/integrations" className="underline">
            Configure a webhook
          </Link>
          .
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Monitored endpoints" subtitle="Current status from the latest checks" pad={false}>
          {monitors.data?.monitors.length ? (
            <Table head={["Endpoint", "Status", "Last check"]}>
              {monitors.data.monitors.slice(0, 8).map((m) => (
                <tr key={String(m.id)} className="hover:bg-surface-2">
                  <Td className="max-w-[220px] truncate font-mono text-xs">{String(m.url)}</Td>
                  <Td>
                    <StatusDot tone={statusTone(String(m.status))} label={String(m.status)} />
                  </Td>
                  <Td className="text-xs text-muted">{timeAgo(m.last_check_at as string | null)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState
                title="No monitors yet"
                body="Register a website and add an endpoint monitor to start collecting real uptime and latency data."
                action={
                  <Link to="/websites" className="text-xs text-primary underline">
                    Register a website
                  </Link>
                }
              />
            </div>
          )}
        </Card>
        <Card title="Open incidents" subtitle="Detected, acknowledged or investigating" pad={false}>
          {openIncidents.length ? (
            <Table head={["Trigger", "Status", "Detected"]}>
              {openIncidents.slice(0, 8).map((i) => (
                <tr key={String(i.id)} className="hover:bg-surface-2">
                  <Td className="max-w-[240px] truncate text-xs">{String(i.trigger_condition)}</Td>
                  <Td>
                    <Badge tone={statusTone(String(i.status))}>{String(i.status)}</Badge>
                  </Td>
                  <Td className="text-xs text-muted">{timeAgo(i.detected_at as string)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="No open incidents" body="When an endpoint fails its failure threshold, an incident opens here automatically." />
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent deployments" subtitle="Recorded via API keys or integrations" pad={false}>
          {s.recentDeployments.length ? (
            <Table head={["Source", "Environment", "Status", "When"]}>
              {s.recentDeployments.map((d) => (
                <tr key={d.id} className="hover:bg-surface-2">
                  <Td className="text-xs">{d.source}</Td>
                  <Td className="text-xs">{d.environment}</Td>
                  <Td>
                    <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                  </Td>
                  <Td className="text-xs text-muted">{timeAgo(d.created_at)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="No deployments recorded" body="Connect Vercel/GitHub or post deployments with an API key to build a release timeline." />
            </div>
          )}
        </Card>
        <Card title="Recent frontend errors" subtitle="Grouped instrumented exceptions" pad={false}>
          {s.recentErrors.length ? (
            <Table head={["Message", "Count", "Last seen"]}>
              {s.recentErrors.map((e) => (
                <tr key={e.id} className="hover:bg-surface-2">
                  <Td className="max-w-[260px] truncate font-mono text-xs">{e.message}</Td>
                  <Td className="text-xs tabular-nums">{e.count}</Td>
                  <Td className="text-xs text-muted">{timeAgo(e.last_seen_at)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="No errors captured" body="Install the VXQOR snippet on your sites to capture uncaught exceptions and rejections." />
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Traffic trend" subtitle="Pageviews per bucket — empty until the snippet reports real visits">
          <TrafficTrend />
        </Card>
      </div>
    </>
  );
}

function TrafficTrend() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: () => apiGet<{ sites: { id: string }[] }>("/v1/sites") });
  const first = sites.data?.sites[0]?.id;
  const analytics = useQuery({
    enabled: Boolean(first),
    queryKey: ["analytics", first, "24h"],
    queryFn: () => apiGet<{ timeseries: { ts: string; value: number }[] }>(`/v1/sites/${first}/analytics?range=24h`),
  });
  if (!first) return <EmptyState title="No websites registered" body="Register a website to see traffic trends." />;
  if (analytics.isLoading) return <Skeleton className="h-52 w-full" />;
  return <TimeSeriesChart data={analytics.data?.timeseries ?? []} range="24h" />;
}
