import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Table, Td } from "../components/ui";
import { apiGet, apiPost } from "../lib/api";
import { formatDateTime, timeAgo } from "../lib/format";

interface GitData {
  configured: boolean;
  status?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  data?: {
    repo: string;
    branch?: string;
    commits: { sha: string; message: string; author: string; date: string; url: string }[];
    pulls: { number: number; title: string; state: string; author: string; updatedAt: string; url: string }[];
    releases: { tag: string; name: string; publishedAt: string; url: string }[];
  } | null;
}

export function GitActivityPage() {
  const qc = useQueryClient();
  const git = useQuery({ queryKey: ["git"], queryFn: () => apiGet<GitData>("/v1/integrations/github/data") });
  const sync = useMutation({
    mutationFn: () => apiPost("/v1/integrations/github/sync"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["git"] }),
  });

  return (
    <>
      <PageHeader
        title="Git Activity"
        subtitle="Commits, pull requests and releases from a connected GitHub repository (read-only, least privilege)."
        actions={
          git.data?.configured ? (
            <Button onClick={() => sync.mutate()} loading={sync.isPending}>
              <RefreshCw size={13} /> Sync now
            </Button>
          ) : undefined
        }
      />
      {git.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : git.isError ? (
        <ErrorState message="Failed to load Git integration state" onRetry={() => git.refetch()} />
      ) : !git.data!.configured ? (
        <EmptyState
          title="GitHub is not connected"
          body="VXQOR never scans repositories that have not been connected. Configure a fine-grained personal access token with read-only contents/metadata permissions to enable commit, PR and release views."
          action={
            <Link to="/integrations" className="text-xs text-primary underline">
              Configure GitHub integration
            </Link>
          }
        />
      ) : !git.data!.data ? (
        <EmptyState
          title="Connected but not synced"
          body={git.data!.lastError ? `Last sync error: ${git.data!.lastError}` : "Run a sync to fetch repository activity."}
          action={
            <Button variant="primary" onClick={() => sync.mutate()} loading={sync.isPending}>
              <RefreshCw size={13} /> Sync now
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            {git.data!.data.repo} · branch {git.data!.data.branch ?? "default"} · synced {git.data!.lastSyncAt ? timeAgo(git.data!.lastSyncAt) : "never"}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Recent commits" pad={false}>
              <Table head={["Commit", "Author", "When"]}>
                {git.data!.data.commits.map((c) => (
                  <tr key={c.sha}>
                    <Td>
                      <a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono text-xs text-ink hover:text-primary">
                        {c.sha.slice(0, 7)} <ExternalLink size={11} className="text-faint" />
                      </a>
                      <p className="mt-0.5 max-w-[280px] truncate text-[11px] text-muted">{c.message.split("\n")[0]}</p>
                    </Td>
                    <Td className="text-xs text-muted">{c.author}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(c.date)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <div className="flex flex-col gap-4">
              <Card title="Pull requests" pad={false}>
                <Table head={["PR", "State", "Updated"]}>
                  {git.data!.data.pulls.map((p) => (
                    <tr key={p.number}>
                      <Td>
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-ink hover:text-primary">
                          #{p.number} {p.title.slice(0, 40)}
                        </a>
                        <p className="text-[11px] text-faint">{p.author}</p>
                      </Td>
                      <Td>
                        <Badge tone={p.state === "open" ? "success" : p.state === "merged" ? "info" : "neutral"}>{p.state}</Badge>
                      </Td>
                      <Td className="text-xs text-muted">{timeAgo(p.updatedAt)}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
              <Card title="Releases" pad={false}>
                {git.data!.data.releases.length ? (
                  <Table head={["Tag", "Published"]}>
                    {git.data!.data.releases.map((r) => (
                      <tr key={r.tag}>
                        <Td>
                          <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-ink hover:text-primary">
                            {r.tag}
                          </a>
                        </Td>
                        <Td className="text-xs text-muted">{formatDateTime(r.publishedAt)}</Td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <div className="p-3">
                    <EmptyState title="No releases" />
                  </div>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
