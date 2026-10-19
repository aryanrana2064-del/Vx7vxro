import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AnalyticsOverview } from "@vxqor/shared";
import { RangeSelect } from "../components/AppShell";
import { MetricTile, TimeSeriesChart } from "../components/charts";
import { SiteSelect } from "../components/SiteSelect";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, Table, Td } from "../components/ui";
import { apiGet } from "../lib/api";
import { formatNumber } from "../lib/format";

export function AnalyticsPage() {
  const [siteId, setSiteId] = useState("");
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "90d">("7d");
  const data = useQuery({
    enabled: Boolean(siteId),
    queryKey: ["analytics", siteId, range],
    queryFn: () => apiGet<AnalyticsOverview>(`/v1/sites/${siteId}/analytics?range=${range}`),
  });

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Privacy-conscious measurement from the VXQOR snippet. No cookies, no raw IP storage."
        actions={
          <>
            <SiteSelect value={siteId} onChange={setSiteId} />
            <RangeSelect value={range} onChange={setRange} />
          </>
        }
      />
      {!siteId ? (
        <EmptyState title="Select a website" body="Analytics remain empty until real instrumented events arrive from the tracking snippet." />
      ) : data.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.isError ? (
        <ErrorState message="Failed to load analytics" onRetry={() => data.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <MetricTile label="Pageviews" value={formatNumber(data.data!.pageviews)} sub={`window: ${range}`} />
            <MetricTile label="Sessions" value={formatNumber(data.data!.sessions)} sub="distinct session fingerprints" />
            <MetricTile label="Est. unique visitors" value={formatNumber(data.data!.estimatedUniqueVisitors)} sub="per-day truncated-IP fingerprints" />
          </div>
          <div className="mt-4">
            <Card title="Pageviews over time">
              <TimeSeriesChart data={data.data!.timeseries} range={range} />
            </Card>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Top paths" pad={false}>
              <Table head={["Path", "Views"]}>
                {data.data!.topPaths.map((p) => (
                  <tr key={p.path}>
                    <Td className="max-w-[200px] truncate font-mono text-xs">{p.path}</Td>
                    <Td className="text-xs tabular-nums">{formatNumber(p.count)}</Td>
                  </tr>
                ))}
              </Table>
              {!data.data!.topPaths.length ? <div className="p-3"><EmptyState title="No pageviews yet" /></div> : null}
            </Card>
            <Card title="Referrers" pad={false}>
              <Table head={["Source", "Visits"]}>
                {data.data!.topReferrers.map((r) => (
                  <tr key={r.referrer}>
                    <Td className="max-w-[180px] truncate text-xs">{r.referrer}</Td>
                    <Td className="text-xs tabular-nums">{formatNumber(r.count)}</Td>
                  </tr>
                ))}
              </Table>
              {!data.data!.topReferrers.length ? <div className="p-3"><EmptyState title="No external referrers yet" /></div> : null}
            </Card>
            <Card title="Devices" pad={false}>
              <Table head={["Device", "Views"]}>
                {data.data!.deviceBreakdown.map((d) => (
                  <tr key={d.label}>
                    <Td className="text-xs">{d.label}</Td>
                    <Td className="text-xs tabular-nums">{formatNumber(d.count)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">{data.data!.measurementNote}</p>
        </>
      )}
    </>
  );
}
