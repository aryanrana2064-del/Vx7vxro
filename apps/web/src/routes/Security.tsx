import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Select, Skeleton, Table, Td } from "../components/ui";
import { apiGet } from "../lib/api";
import { formatDateTime } from "../lib/format";

interface SecurityEvent {
  id: string;
  kind: string;
  severity: string;
  title: string;
  detail: string | null;
  created_at: string;
}

export function SecurityEventsPage() {
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState("");
  const events = useQuery({
    queryKey: ["security-events", page, severity],
    queryFn: () => apiGet<{ items: SecurityEvent[]; total: number }>(`/v1/security/events?page=${page}&perPage=50${severity ? `&severity=${severity}` : ""}`),
  });
  return (
    <>
      <PageHeader
        title="Security Events"
        subtitle="Authentication failures, MFA events, SSRF rejections, incident and DNS findings. Evidence-based only."
        actions={
          <Select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label="Severity filter">
            <option value="">All severities</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="critical">critical</option>
          </Select>
        }
      />
      {events.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : events.isError ? (
        <ErrorState message="Failed to load security events" onRetry={() => events.refetch()} />
      ) : events.data!.items.length === 0 ? (
        <EmptyState title="No security events" body="Events appear when something noteworthy happens: failed logins, blocked targets, DNS changes, certificate warnings." />
      ) : (
        <Card pad={false}>
          <Table head={["When", "Severity", "Kind", "Title", "Detail"]}>
            {events.data!.items.map((e) => (
              <tr key={e.id} className="hover:bg-surface-2">
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(e.created_at)}</Td>
                <Td>
                  <Badge tone={e.severity === "critical" ? "danger" : e.severity === "warn" ? "warn" : "neutral"}>{e.severity}</Badge>
                </Td>
                <Td className="font-mono text-xs">{e.kind}</Td>
                <Td className="max-w-[280px] truncate text-xs">{e.title}</Td>
                <Td className="max-w-[240px] truncate text-xs text-muted">{e.detail ?? ""}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} perPage={50} total={events.data!.total} onPage={setPage} />
        </Card>
      )}
    </>
  );
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const audit = useQuery({ queryKey: ["audit", page], queryFn: () => apiGet<{ items: Record<string, unknown>[]; total: number }>(`/v1/audit?page=${page}&perPage=50`) });
  return (
    <>
      <PageHeader title="Audit Trail" subtitle="Every privileged action: auth, site/monitor changes, key lifecycle, incident actions." />
      {audit.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : audit.isError ? (
        <ErrorState message="Failed to load audit trail" onRetry={() => audit.refetch()} />
      ) : audit.data!.items.length === 0 ? (
        <EmptyState title="No audit events yet" />
      ) : (
        <Card pad={false}>
          <Table head={["When", "Category", "Action", "Actor", "IP"]}>
            {audit.data!.items.map((a) => (
              <tr key={String(a.id)} className="hover:bg-surface-2">
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(String(a.created_at))}</Td>
                <Td className="text-xs">{String(a.category)}</Td>
                <Td className="font-mono text-xs">{String(a.action)}</Td>
                <Td className="max-w-[200px] truncate text-xs text-muted">{String(a.actor)}</Td>
                <Td className="text-xs text-muted">{String(a.ip ?? "—")}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} perPage={50} total={audit.data!.total} onPage={setPage} />
        </Card>
      )}
    </>
  );
}

interface SecurityCheck {
  id: string;
  kind: string;
  status: string;
  detail: string | null;
  checked_at: string;
  site_id: string | null;
}
interface DnsRecord {
  id: string;
  domain: string;
  record_type: string;
  value: string;
  first_seen_at: string;
  last_seen_at: string;
}

export function SslDnsPage() {
  const checks = useQuery({ queryKey: ["security-checks"], queryFn: () => apiGet<{ checks: SecurityCheck[]; dnsRecords: DnsRecord[] }>("/v1/security/checks") });
  return (
    <>
      <PageHeader title="SSL & DNS" subtitle="HTTPS availability, security headers, DNS resolution changes and certificate expiry (Node scheduler only)." />
      {checks.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : checks.isError ? (
        <ErrorState message="Failed to load checks" onRetry={() => checks.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Latest checks" pad={false}>
            {checks.data!.checks.length ? (
              <Table head={["Kind", "Status", "Detail", "Checked"]}>
                {checks.data!.checks.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-2">
                    <Td className="text-xs">{c.kind}</Td>
                    <Td>
                      <Badge tone={c.status === "pass" ? "success" : c.status === "warn" ? "warn" : c.status === "fail" ? "danger" : "neutral"}>{c.status}</Badge>
                    </Td>
                    <Td className="max-w-[260px] truncate font-mono text-[11px] text-muted">{c.detail ?? ""}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(c.checked_at)}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <div className="p-3">
                <EmptyState title="No checks yet" body="Checks run with the monitoring scheduler against your registered monitors." />
              </div>
            )}
          </Card>
          <Card title="DNS records observed" subtitle="Changes trigger a warn-severity security event" pad={false}>
            {checks.data!.dnsRecords.length ? (
              <Table head={["Domain", "Value", "First seen", "Last seen"]}>
                {checks.data!.dnsRecords.map((d) => (
                  <tr key={d.id}>
                    <Td className="font-mono text-xs">{d.domain}</Td>
                    <Td className="font-mono text-xs text-muted">{d.value}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(d.first_seen_at)}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(d.last_seen_at)}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <div className="p-3">
                <EmptyState title="No DNS observations yet" />
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
