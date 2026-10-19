import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCw } from "lucide-react";
import { useState } from "react";
import { API_SCOPES } from "@vxqor/shared";
import { Badge, Button, Card, ConfirmDialog, CopyField, Dialog, EmptyState, Input, PageHeader, Skeleton, Table, Td, useToast } from "../components/ui";
import { apiGet, apiPost } from "../lib/api";
import { formatDateTime, timeAgo } from "../lib/format";

interface KeyMeta {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
}

export function ApiKeysPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useQuery({ queryKey: ["keys"], queryFn: () => apiGet<{ keys: KeyMeta[] }>("/v1/keys") });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<KeyMeta | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost<{ secret: string }>("/v1/keys", { name, scopes }),
    onSuccess: (res) => {
      setSecret(res.secret);
      qc.invalidateQueries({ queryKey: ["keys"] });
      setName("");
      setScopes([]);
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/keys/${id}/revoke`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      toast("success", "Key revoked");
    },
  });
  const rotate = useMutation({
    mutationFn: (id: string) => apiPost<{ secret: string }>(`/v1/keys/${id}/rotate`),
    onSuccess: (res) => {
      setSecret(res.secret);
      qc.invalidateQueries({ queryKey: ["keys"] });
      toast("success", "Key rotated — old secret revoked");
    },
  });

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle="Scoped server credentials. Hashed at rest, shown once, rotatable and revocable."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> Create key
          </Button>
        }
      />
      {keys.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : keys.data!.keys.length === 0 ? (
        <EmptyState title="No API keys" body="Create scoped keys for CI deployment recording, exports or read-only integrations. Keys never grant owner-session privileges." />
      ) : (
        <Card pad={false}>
          <Table head={["Name", "Prefix", "Scopes", "Created", "Last used", "Requests", "Expires", "Status", ""]}>
            {keys.data!.keys.map((k) => (
              <tr key={k.id} className="hover:bg-surface-2">
                <Td className="text-sm">{k.name}</Td>
                <Td className="font-mono text-xs text-muted">{k.prefix}…</Td>
                <Td className="max-w-[220px]">
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.slice(0, 3).map((s) => (
                      <Badge key={s} tone="info">
                        {s}
                      </Badge>
                    ))}
                    {k.scopes.length > 3 ? <Badge tone="neutral">+{k.scopes.length - 3}</Badge> : null}
                  </div>
                </Td>
                <Td className="text-xs text-muted">{formatDateTime(k.created_at)}</Td>
                <Td className="text-xs text-muted">{timeAgo(k.last_used_at)}</Td>
                <Td className="text-xs tabular-nums">{k.use_count}</Td>
                <Td className="text-xs text-muted">{k.expires_at ? formatDateTime(k.expires_at) : "never"}</Td>
                <Td>{k.revoked_at ? <Badge tone="danger">revoked</Badge> : k.expires_at && new Date(k.expires_at) < new Date() ? <Badge tone="warn">expired</Badge> : <Badge tone="success">active</Badge>}</Td>
                <Td>
                  <div className="flex gap-1">
                    {!k.revoked_at ? (
                      <>
                        <Button size="sm" onClick={() => rotate.mutate(k.id)} loading={rotate.isPending && rotate.variables === k.id}>
                          <RotateCw size={12} /> Rotate
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setRevoking(k)}>
                          Revoke
                        </Button>
                      </>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create API key" wide>
        {secret ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-warn">Copy this secret now — it is stored only as a hash and cannot be shown again.</p>
            <CopyField value={secret} secret />
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  setSecret(null);
                  setCreateOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input label="Key name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-deploy" />
            <fieldset className="grid grid-cols-2 gap-1.5 rounded-md border border-line p-3 md:grid-cols-3">
              <legend className="px-1 text-xs font-medium text-muted">Scopes</legend>
              {API_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
                  {s}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={create.isPending} disabled={scopes.length === 0}>
                Create key
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        title="Revoke key"
        danger
        confirmLabel="Revoke"
        body={<>Key <strong>{revoking?.name}</strong> stops working immediately. Integrations using it will fail.</>}
      />
    </>
  );
}
