import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../lib/api";
import { formatDateTime, timeAgo } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CopyField,
  Dialog,
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

interface Site {
  id: string;
  name: string;
  environment: string;
  trackingId: string;
  domains: string[];
  disabled: boolean;
  createdAt: string;
}

export function WebsitesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const remoteStatus = useQuery({ queryKey: ["remote-status"], queryFn: () => apiGet<{ configured: boolean; authOk: boolean | null; url: string | null }>("/v1/remote/status") });
  const useRemote = Boolean(remoteStatus.data?.configured && remoteStatus.data?.authOk === true);
  const sites = useQuery({
    queryKey: ["sites", useRemote],
    queryFn: () => apiGet<{ sites: Site[] }>(useRemote ? "/v1/remote/websites" : "/v1/sites"),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", environment: "production", domains: "" });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost(useRemote ? "/v1/remote/websites" : "/v1/sites", {
        name: form.name,
        environment: form.environment,
        domains: form.domains.split(/[\s,]+/).filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites"] });
      setCreateOpen(false);
      setForm({ name: "", environment: "production", domains: "" });
      toast("success", useRemote ? "Website saved to the Cloudflare vxqor-db registry" : "Website registered");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });

  return (
    <>
      <PageHeader
        title="Websites"
        subtitle="Registry of sites you are authorized to monitor and instrument."
        actions={
          <>
            {useRemote ? (
              <span title={remoteStatus.data?.url ?? undefined}>
                <Badge tone="info">Source: Cloudflare vxqor-db</Badge>
              </span>
            ) : remoteStatus.data?.configured ? (
              <Badge tone="warn">Remote registry unreachable — local registry</Badge>
            ) : (
              <Badge tone="neutral">Source: local registry</Badge>
            )}
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Register website
            </Button>
          </>
        }
      />
      {sites.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : sites.isError ? (
        <ErrorState message="Failed to load websites" onRetry={() => sites.refetch()} />
      ) : sites.data!.sites.length === 0 ? (
        <EmptyState
          title="No websites registered"
          body="Register each website you own or operate. Registration creates a public tracking identifier and allows monitors, analytics and security checks."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Register website
            </Button>
          }
        />
      ) : (
        <Card pad={false}>
          <Table head={["Name", "Environment", "Domains", "Tracking ID", "Status", "Created"]}>
            {sites.data!.sites.map((s) => (
              <tr key={s.id} className="hover:bg-surface-2">
                <Td>
                  <Link to={`/websites/${s.id}`} className="text-sm font-medium text-ink hover:text-primary">
                    {s.name}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={s.environment === "production" ? "info" : "neutral"}>{s.environment}</Badge>
                </Td>
                <Td className="max-w-[240px] truncate text-xs text-muted">{s.domains.join(", ")}</Td>
                <Td className="font-mono text-xs text-muted">{s.trackingId || "—"}</Td>
                <Td>{s.disabled ? <Badge tone="warn">disabled</Badge> : <StatusDot tone="success" label="active" />}</Td>
                <Td className="text-xs text-muted">{formatDateTime(s.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Register website">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <Input label="Display name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select label="Environment" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
          </Select>
          <Input label="Authorized domains" required placeholder="example.com, www.example.com" hint="Comma separated. Ingestion origins outside this list are rejected." value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} />
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Register
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function WebsiteDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: ["site", id],
    queryFn: () => apiGet<{ site: Site; monitors: Record<string, unknown>[]; incidents: Record<string, unknown>[]; deployments: Record<string, unknown>[] }>(`/v1/sites/${id}`),
  });
  const snippet = useQuery({ queryKey: ["snippet", id], queryFn: () => apiGet<{ snippet: string; scriptUrl: string }>(`/v1/sites/${id}/snippet`) });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({ name: "", domains: "", disabled: false });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/v1/sites/${id}?confirm=${id}`),
    onSuccess: () => {
      toast("success", "Website removed");
      qc.invalidateQueries({ queryKey: ["sites"] });
      navigate("/websites");
    },
  });

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/v1/sites/${id}`, {
        name: edit.name || undefined,
        domains: edit.domains ? edit.domains.split(/[\s,]+/).filter(Boolean) : undefined,
        disabled: edit.disabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site", id] });
      qc.invalidateQueries({ queryKey: ["sites"] });
      setEditOpen(false);
      toast("success", "Website updated");
    },
  });

  if (detail.isLoading) return <Skeleton className="h-64 w-full" />;
  if (detail.isError || !detail.data) return <ErrorState message="Website not found" />;
  const { site, monitors, incidents, deployments } = detail.data;

  return (
    <>
      <PageHeader
        title={site.name}
        subtitle={`${site.environment} · registered ${formatDateTime(site.createdAt)}`}
        actions={
          <>
            <Badge tone={site.disabled ? "warn" : "success"}>{site.disabled ? "disabled" : "active"}</Badge>
            <Button
              onClick={() => {
                setEdit({ name: site.name, domains: site.domains.join(", "), disabled: site.disabled });
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Remove
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tracking snippet" subtitle="Public identifier — safe to embed, grants no administrative access">
          {snippet.data ? (
            <div className="flex flex-col gap-3">
              <CopyField value={snippet.data.snippet} />
              <p className="text-[11px] leading-relaxed text-faint">
                Add the script tag to your pages. It reports pageviews, custom events, Core Web Vitals and uncaught errors. Measurement is affected by ad blockers, consent choices and bots — unique visitors are estimates.
              </p>
            </div>
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
        </Card>
        <Card title="Authorized domains" subtitle="Ingestion origin allowlist">
          <div className="flex flex-wrap gap-1.5">
            {site.domains.map((d) => (
              <Badge key={d} tone="neutral">
                {d}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={`Monitors (${monitors.length})`} pad={false}>
          {monitors.length ? (
            <Table head={["URL", "Status", "Last check"]}>
              {monitors.map((m) => (
                <tr key={String(m.id)}>
                  <Td className="max-w-[160px] truncate font-mono text-xs">{String(m.url)}</Td>
                  <Td>
                    <StatusDot tone={statusTone(String(m.status))} label={String(m.status)} />
                  </Td>
                  <Td className="text-xs text-muted">{timeAgo(m.last_check_at as string | null)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="No monitors" body={<span><Link to="/monitoring" className="text-primary underline">Add a monitor</Link> for this site.</span>} />
            </div>
          )}
        </Card>
        <Card title={`Incidents (${incidents.length})`} pad={false}>
          {incidents.length ? (
            <Table head={["Status", "Detected"]}>
              {incidents.slice(0, 10).map((i) => (
                <tr key={String(i.id)}>
                  <Td>
                    <Badge tone={statusTone(String(i.status))}>{String(i.status)}</Badge>
                  </Td>
                  <Td className="text-xs text-muted">{timeAgo(i.detected_at as string)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="No incidents" />
            </div>
          )}
        </Card>
        <Card title={`Deployments (${deployments.length})`} pad={false}>
          {deployments.length ? (
            <Table head={["Source", "Status", "When"]}>
              {deployments.slice(0, 10).map((d) => (
                <tr key={String(d.id)}>
                  <Td className="text-xs">{String(d.source)}</Td>
                  <Td>
                    <Badge tone={statusTone(String(d.status))}>{String(d.status)}</Badge>
                  </Td>
                  <Td className="text-xs text-muted">{timeAgo(d.created_at as string)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="No deployments" />
            </div>
          )}
        </Card>
      </div>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit website">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input label="Display name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Input label="Authorized domains" value={edit.domains} onChange={(e) => setEdit({ ...edit, domains: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={edit.disabled} onChange={(e) => setEdit({ ...edit, disabled: e.target.checked })} />
            Disable site (stops monitoring and ingestion)
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title="Remove website"
        danger
        confirmLabel="Remove permanently"
        body={
          <>
            This deletes <strong>{site.name}</strong> including monitors, results, incidents and analytics history. This cannot be undone.
          </>
        }
      />
    </>
  );
}
