import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PerformanceOverview } from "@vxqor/shared";
import { RangeSelect } from "../components/AppShell";
import { BarListChart, MetricTile, TimeSeriesChart } from "../components/charts";
import { SiteSelect } from "../components/SiteSelect";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, Table, Td } from "../components/ui";
import { apiGet } from "../lib/api";
import { formatMs, formatNumber } from "../lib/format";

const METRIC_LABEL: Record<string, string> = {
  lcp: "Largest Contentful Paint",
  inp: "Interaction to Next Paint",
  cls: "Cumulative Layout Shift",
  fcp: "First Contentful Paint",
  ttfb: "Time to First Byte",
};

export function PerformancePage() {
  const [siteId, setSiteId] = useState("");
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "90d">("7d");
  const data = useQuery({
    enabled: Boolean(siteId),
    queryKey: ["performance", siteId, range],
    queryFn: () => apiGet<PerformanceOverview>(`/v1/sites/${siteId}/performance?range=${range}`),
  });

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle="Real-user Core Web Vitals from the snippet plus server-side monitor latency percentiles."
        actions={
          <>
            <SiteSelect value={siteId} onChange={setSiteId} />
            <RangeSelect value={range} onChange={setRange} />
          </>
        }
      />
      {!siteId ? (
        <EmptyState title="Select a website" body="Core Web Vitals can only come from instrumented browsers — VXQOR never guesses them from a domain." />
      ) : data.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.isError ? (
        <ErrorState message="Failed to load performance data" onRetry={() => data.refetch()} />
      ) : data.data!.samples === 0 ? (
        <EmptyState title="No performance samples" body="Install the snippet with data-deployment attribution to collect LCP, INP, CLS, FCP and TTFB from real visitors." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {data.data!.metrics.map((m) => (
              <MetricTile key={m.metric} label={METRIC_LABEL[m.metric] ?? m.metric} value={m.metric === "cls" ? (m.p75 ?? 0).toFixed(3) : formatMs(m.p75)} sub={`p75 · n=${m.count}`} />
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Monitor latency p50" subtitle="Server-side HTTP checks">
              <TimeSeriesChart data={data.data!.monitorLatency} range={range} unit="ms" />
            </Card>
            <Card title="Slowest paths (p95 LCP/TTFB)">
              <BarListChart data={data.data!.slowestPaths.map((p) => ({ label: p.path.slice(0, 18), value: Math.round(p.p95 ?? 0) }))} unit="ms" />
            </Card>
          </div>
          <div className="mt-4">
            <Card title="By deployment" subtitle="Compare releases where attribution exists" pad={false}>
              {data.data!.byDeployment.length ? (
                <Table head={["Deployment", "Metric", "p75", "Samples"]}>
                  {data.data!.byDeployment.map((d, i) => (
                    <tr key={`${d.deployment}-${d.metric}-${i}`}>
                      <Td className="font-mono text-xs">{d.deployment}</Td>
                      <Td className="text-xs">{d.metric}</Td>
                      <Td className="text-xs tabular-nums">{d.metric === "cls" ? (d.p75 ?? 0).toFixed(3) : formatMs(d.p75)}</Td>
                      <Td className="text-xs tabular-nums">{formatNumber(d.count)}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <div className="p-3">
                  <EmptyState title="No deployment attribution yet" body="Tag pages with data-deployment (or window.__VXQOR_DEPLOYMENT__) to compare releases." />
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
