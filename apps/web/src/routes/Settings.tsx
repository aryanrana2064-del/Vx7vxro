import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { OwnerInfo, SessionInfo } from "@vxqor/shared";
import { Badge, Button, Card, CopyField, Input, PageHeader, Skeleton, Table, Td, useToast } from "../components/ui";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { formatDateTime, timeAgo } from "../lib/format";

export function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useQuery({ queryKey: ["session"], queryFn: () => apiGet<{ owner: OwnerInfo }>("/v1/auth/session") });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => apiGet<{ sessions: SessionInfo[] }>("/v1/auth/sessions") });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState("");

  const changePw = useMutation({
    mutationFn: () => apiPost("/v1/auth/password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: () => {
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast("success", "Password changed — other sessions revoked");
    },
    onError: (e) => setPwError(e instanceof ApiError ? e.message : "Failed"),
  });

  const startMfa = useMutation({
    mutationFn: () => apiPost<{ secret: string; otpauthUrl: string }>("/v1/auth/mfa/setup"),
    onSuccess: (res) => setMfaSecret(res),
  });
  const confirmMfa = useMutation({
    mutationFn: () => apiPost<{ recoveryCodes: string[] }>("/v1/auth/mfa/confirm", { code: mfaCode }),
    onSuccess: (res) => {
      setRecoveryCodes(res.recoveryCodes);
      setMfaSecret(null);
      setMfaCode("");
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["system-state"] });
      toast("success", "MFA enabled — store your recovery codes now");
    },
    onError: (e) => toast("danger", e instanceof ApiError ? e.message : "Invalid code"),
  });
  const disableMfa = useMutation({
    mutationFn: () => apiPost("/v1/auth/mfa/disable", { password: disablePw }),
    onSuccess: () => {
      setDisablePw("");
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["system-state"] });
      toast("warn", "MFA disabled");
    },
    onError: (e) => toast("danger", e instanceof ApiError ? e.message : "Failed"),
  });
  const regenerate = useMutation({
    mutationFn: () => apiPost<{ recoveryCodes: string[] }>("/v1/auth/mfa/recovery-codes/regenerate", { password: disablePw }),
    onSuccess: (res) => {
      setRecoveryCodes(res.recoveryCodes);
      toast("success", "Recovery codes regenerated");
    },
    onError: (e) => toast("danger", e instanceof ApiError ? e.message : "Failed"),
  });
  const revokeSession = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/auth/sessions/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const revokeOthers = useMutation({
    mutationFn: () => apiPost("/v1/auth/sessions/revoke-others"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast("success", "Other sessions revoked");
    },
  });

  if (session.isLoading) return <Skeleton className="h-64 w-full" />;
  const owner = session.data!.owner;

  return (
    <>
      <PageHeader title="Settings" subtitle={`Owner account ${owner.email}`} actions={owner.mfaEnabled ? <Badge tone="success">MFA enabled</Badge> : <Badge tone="warn">MFA not enrolled</Badge>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Change password" subtitle="Rotates the password hash and revokes all other sessions">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setPwError(null);
              if (pw.newPassword !== pw.confirm) return setPwError("Passwords do not match");
              changePw.mutate();
            }}
          >
            <Input label="Current password" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <Input label="New password" type="password" autoComplete="new-password" required minLength={12} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <Input label="Confirm new password" type="password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            {pwError ? <p role="alert" className="text-xs text-danger">{pwError}</p> : null}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={changePw.isPending}>
                Update password
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Multifactor authentication" subtitle="TOTP authenticator app + single-use recovery codes">
          {recoveryCodes ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-warn">Store these codes offline. Each works once and is stored only as a hash.</p>
              <CopyField value={recoveryCodes.join("\n")} secret />
              <Button size="sm" onClick={() => setRecoveryCodes(null)}>
                Done
              </Button>
            </div>
          ) : mfaSecret ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted">Add this secret to your authenticator app, then enter a 6-digit code to confirm.</p>
              <CopyField value={mfaSecret.secret} secret />
              <Input label="Confirmation code" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button onClick={() => setMfaSecret(null)}>Cancel</Button>
                <Button variant="primary" loading={confirmMfa.isPending} onClick={() => confirmMfa.mutate()}>
                  Enable MFA
                </Button>
              </div>
            </div>
          ) : owner.mfaEnabled ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted">MFA is active. Re-authenticate with your password to regenerate recovery codes or disable MFA.</p>
              <Input label="Account password" type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
                  Regenerate recovery codes
                </Button>
                <Button variant="danger" onClick={() => disableMfa.mutate()} loading={disableMfa.isPending}>
                  Disable MFA
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => startMfa.mutate()} loading={startMfa.isPending}>
                Enroll MFA
              </Button>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Active sessions"
          subtitle="Sessions expire after 12 hours and rotate on authentication"
          pad={false}
          actions={
            <Button size="sm" variant="danger" onClick={() => revokeOthers.mutate()} loading={revokeOthers.isPending}>
              Revoke others
            </Button>
          }
        >
          {sessions.data?.sessions.length ? (
            <Table head={["Created", "Last seen", "IP", "User agent", ""]}>
              {sessions.data!.sessions.map((s) => (
                <tr key={s.id}>
                  <Td className="text-xs text-muted">{formatDateTime(s.createdAt)}</Td>
                  <Td className="text-xs text-muted">{timeAgo(s.lastSeenAt)}</Td>
                  <Td className="font-mono text-xs text-muted">{s.lastSeenIp ?? "—"}</Td>
                  <Td className="max-w-[260px] truncate text-xs text-muted">{s.userAgent ?? "—"}</Td>
                  <Td>
                    {s.current ? (
                      <Badge tone="success">current</Badge>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => revokeSession.mutate(s.id)}>
                        Revoke
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Skeleton className="m-3 h-16 w-full" />
          )}
        </Card>
      </div>
    </>
  );
}
