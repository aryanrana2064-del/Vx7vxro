import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { DeploymentRow } from "@vxqor/shared";
import { Badge, Button, Card, CopyField, EmptyState, ErrorState, PageHeader, Skeleton, statusTone, Table, Td } from "../components/ui";
import { apiGet } from "../lib/api";
import { formatDateTime, timeAgo } from "../lib/format";

export function DeploymentsPage() {
  const deployments = useQuery({ queryKey: ["deployments"], queryFn: () => apiGet<{ deployments: DeploymentRow[] }>("/v1/deployments?limit=100") });
  const example = `curl -X POST $VXQOR_API/v1/deployments \\
  -H "Authorization: Bearer $VXQOR_KEY" \\
  -H "content-type: application/json" \\
  -d '{"source":"ci","environment":"production","status":"ready","commitSha":"'"$GIT_SHA"'","commitMessage":"release 42"}'`;

  return (
    <>
      <PageHeader title="Deployments" subtitle="Release timeline from CI posts, Vercel sync or manual records." />
      {deployments.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : deployments.isError ? (
        <ErrorState message="Failed to load deployments" onRetry={() => deployments.refetch()} />
      ) : deployments.data!.deployments.length === 0 ? (
        <EmptyState
          title="No deployments recorded"
          body="Record deployments from CI with a scoped API key (deployments:write), or connect Vercel to sync them automatically."
          action={
            <Link to="/integrations" className="text-xs text-primary underline">
              Connect an integration
            </Link>
          }
        />
      ) : (
        <Card pad={false}>
          <Table head={["Source", "Environment", "Status", "Commit", "Message", "When", "URL"]}>
            {deployments.data!.deployments.map((d) => (
              <tr key={d.id} className="hover:bg-surface-2">
                <Td className="text-xs">{d.source}</Td>
                <Td>
                  <Badge tone={d.environment === "production" ? "info" : "neutral"}>{d.environment}</Badge>
                </Td>
                <Td>
                  <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                </Td>
                <Td className="font-mono text-xs text-muted">{d.commit_sha ? d.commit_sha.slice(0, 7) : "—"}</Td>
                <Td className="max-w-[220px] truncate text-xs text-muted">{d.commit_message ?? "—"}</Td>
                <Td className="text-xs text-muted">{timeAgo(d.created_at)}</Td>
                <Td className="max-w-[160px] truncate text-xs">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      preview
                    </a>
                  ) : (
                    "—"
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <div className="mt-4">
        <Card title="Record from CI" subtitle="Use an API key with the deployments:write scope">
          <CopyField value={example} />
          <p className="mt-2 text-[11px] text-faint">Duplicate commits (same source + sha) are deduplicated server-side.</p>
          <div className="mt-2">
            <Link to="/keys">
              <Button size="sm">Manage API keys</Button>
            </Link>
          </div>
        </Card>
      </div>
      <p className="mt-3 text-[11px] text-faint">Deployments recorded {formatDateTime(new Date().toISOString()).slice(0, 10)} window: all time, newest first.</p>
    </>
  );
}
