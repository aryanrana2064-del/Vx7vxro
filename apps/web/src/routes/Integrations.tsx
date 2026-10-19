import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, ConfirmDialog, Input, PageHeader, Skeleton, statusTone, useToast } from "../components/ui";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "../lib/api";
import { timeAgo } from "../lib/format";

interface IntegrationState {
  encryptionConfigured: boolean;
  integrations: { kind: string; status: string; last_sync_at: string | null; last_error: string | null }[];
  alerts: { webhookConfigured: boolean; secretConfigured: boolean };
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const state = useQuery({ queryKey: ["integrations"], queryFn: () => apiGet<IntegrationState>("/v1/integrations") });
  const [github, setGithub] = useState({ token: "", repo: "", branch: "main" });
  const [vercel, setVercel] = useState({ token: "", projectId: "", teamId: "" });
  const [alerts, setAlerts] = useState({ webhookUrl: "", webhookSecret: "" });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });

  const saveGithub = useMutation({
    mutationFn: () => apiPut<{ status: string; lastError: string | null }>("/v1/integrations/github", { kind: "github", ...github }),
    onSuccess: (res) => {
      refresh();
      toast(res.status === "connected" ? "success" : "warn", `GitHub ${res.status}${res.lastError ? `: ${res.lastError}` : ""}`);
    },
    onError: (e) => toast("danger", e instanceof ApiError ? e.message : "Failed"),
  });
  const saveVercel = useMutation({
    mutationFn: () => apiPut<{ status: string; lastError: string | null }>("/v1/integrations/vercel", { kind: "vercel", token: vercel.token, projectId: vercel.projectId || undefined, teamId: vercel.teamId || undefined }),
    onSuccess: (res) => {
      refresh();
      toast(res.status === "connected" ? "success" : "warn", `Vercel ${res.status}${res.lastError ? `: ${res.lastError}` : ""}`);
    },
    onError: (e) => toast("danger", e instanceof ApiError ? e.message : "Failed"),
  });
  const saveAlerts = useMutation({
    mutationFn: () => apiPut<{ ok: boolean }>("/v1/integrations/alerts", { webhookUrl: alerts.webhookUrl, webhookSecret: alerts.webhookSecret || undefined }),
    onSuccess: () => {
      refresh();
      toast("success", "Alert configuration saved");
    },
  });
  const testAlerts = useMutation({
    mutationFn: () => apiPost<{ delivered: boolean; reason?: string }>("/v1/integrations/alerts/test"),
    onSuccess: (res) => toast(res.delivered ? "success" : "warn", res.delivered ? "Test alert delivered" : `Not delivered: ${res.reason}`),
  });
  const sync = useMutation({
    mutationFn: (kind: string) => apiPost(`/v1/integrations/${kind}/sync`),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["git"] });
      qc.invalidateQueries({ queryKey: ["deployments"] });
      toast("success", "Sync complete");
    },
    onError: (e) => toast("danger", e instanceof ApiError ? e.message : "Sync failed"),
  });
  const remove = useMutation({
    mutationFn: (kind: string) => apiDelete(`/v1/integrations/${kind}`),
    onSuccess: () => {
      refresh();
      toast("success", "Integration removed");
    },
  });

  if (state.isLoading) return <Skeleton className="h-64 w-full" />;
  const s = state.data!;
  const gh = s.integrations.find((i) => i.kind === "github");
  const vc = s.integrations.find((i) => i.kind === "vercel");

  return (
    <>
      <PageHeader title="Integrations" subtitle="Tokens are encrypted at rest (AES-256-GCM) server-side and never sent to the browser." />
      {!s.encryptionConfigured ? (
        <div className="mb-4 rounded-md border border-[#4d3a12] bg-[#2b2109] px-3 py-2 text-xs text-warn">
          VXQOR_ENCRYPTION_KEY is not configured on the API — integrations cannot store credentials until it is set.
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="GitHub"
          subtitle="Read-only repository metadata: commits, PRs, releases"
          actions={
            gh ? (
              <>
                <Badge tone={statusTone(gh.status)}>{gh.status}</Badge>
                <Button size="sm" onClick={() => sync.mutate("github")} loading={sync.isPending}>
                  Sync
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirmRemove("github")}>
                  Remove
                </Button>
              </>
            ) : undefined
          }
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveGithub.mutate();
            }}
          >
            <Input label="Repository (owner/repo)" required placeholder="acme/web" value={github.repo} onChange={(e) => setGithub({ ...github, repo: e.target.value })} />
            <Input label="Branch" value={github.branch} onChange={(e) => setGithub({ ...github, branch: e.target.value })} />
            <Input label="Fine-grained token" type="password" required placeholder="github_pat_…" hint="Contents: Read, Metadata: Read, Pull requests: Read" value={github.token} onChange={(e) => setGithub({ ...github, token: e.target.value })} />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saveGithub.isPending}>
                Validate & save
              </Button>
            </div>
          </form>
          {gh?.last_sync_at ? <p className="mt-2 text-[11px] text-faint">Last sync {timeAgo(gh.last_sync_at)}{gh.last_error ? ` · error: ${gh.last_error}` : ""}</p> : null}
        </Card>
        <Card
          title="Vercel"
          subtitle="Deployment timeline sync"
          actions={
            vc ? (
              <>
                <Badge tone={statusTone(vc.status)}>{vc.status}</Badge>
                <Button size="sm" onClick={() => sync.mutate("vercel")} loading={sync.isPending}>
                  Sync
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirmRemove("vercel")}>
                  Remove
                </Button>
              </>
            ) : undefined
          }
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveVercel.mutate();
            }}
          >
            <Input label="Project ID (optional)" value={vercel.projectId} onChange={(e) => setVercel({ ...vercel, projectId: e.target.value })} />
            <Input label="Team ID (optional)" value={vercel.teamId} onChange={(e) => setVercel({ ...vercel, teamId: e.target.value })} />
            <Input label="API token" type="password" required placeholder="vercel_…" value={vercel.token} onChange={(e) => setVercel({ ...vercel, token: e.target.value })} />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saveVercel.isPending}>
                Validate & save
              </Button>
            </div>
          </form>
          {vc?.last_sync_at ? <p className="mt-2 text-[11px] text-faint">Last sync {timeAgo(vc.last_sync_at)}{vc.last_error ? ` · error: ${vc.last_error}` : ""}</p> : null}
        </Card>
      </div>
      <div className="mt-4">
        <Card
          title="Alert notifications"
          subtitle="Webhook called on incident open/resolve, signed with HMAC-SHA256 when a secret is set"
          actions={
            <>
              <Badge tone={s.alerts.webhookConfigured ? "success" : "neutral"}>{s.alerts.webhookConfigured ? "configured" : "not configured"}</Badge>
              <Button size="sm" onClick={() => testAlerts.mutate()} loading={testAlerts.isPending} disabled={!s.alerts.webhookConfigured}>
                Send test
              </Button>
            </>
          }
        >
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveAlerts.mutate();
            }}
          >
            <Input label="Webhook URL" type="url" placeholder="https://hooks.example.com/vxqor" value={alerts.webhookUrl} onChange={(e) => setAlerts({ ...alerts, webhookUrl: e.target.value })} hint="Leave empty to disable alerts" />
            <Input label="Signing secret (optional)" type="password" value={alerts.webhookSecret} onChange={(e) => setAlerts({ ...alerts, webhookSecret: e.target.value })} />
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" variant="primary" loading={saveAlerts.isPending}>
                Save alert config
              </Button>
            </div>
          </form>
        </Card>
      </div>
      <ConfirmDialog open={Boolean(confirmRemove)} onClose={() => setConfirmRemove(null)} onConfirm={() => confirmRemove && remove.mutate(confirmRemove)} title="Remove integration" danger confirmLabel="Remove" body="Stored credentials are deleted. Synced history (deployments) is kept." />
    </>
  );
}
