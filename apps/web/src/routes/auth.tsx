import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { SystemState } from "@vxqor/shared";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Button, Input, useToast } from "../components/ui";

function AuthFrame({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <div className="vx-enter w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/brand/wordmark.jpg" alt="VXQOR" className="h-16 w-auto rounded" />
        </div>
        <div className="rounded-lg border border-line bg-surface p-5">
          <h1 className="text-base font-semibold text-ink">{title}</h1>
          <p className="mb-4 mt-1 text-xs text-muted">{subtitle}</p>
          {children}
        </div>
        <p className="mt-3 text-center text-[11px] text-faint">Private console. No public registration exists.</p>
      </div>
    </div>
  );
}

export function SetupPage() {
  const state = useQuery({ queryKey: ["system-state"], queryFn: () => apiGet<SystemState>("/v1/system/state") });
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ bootstrapSecret: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.data && !state.data.bootstrapRequired) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError("Passwords do not match");
    setBusy(true);
    try {
      await apiPost("/v1/auth/bootstrap", { bootstrapSecret: form.bootstrapSecret, email: form.email, password: form.password });
      toast("success", "Owner account created");
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bootstrap failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Initialize owner account" subtitle="One-time bootstrap. The secret comes from your API environment (VXQOR_BOOTSTRAP_SECRET).">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input label="Bootstrap secret" type="password" autoComplete="off" required value={form.bootstrapSecret} onChange={(e) => setForm({ ...form, bootstrapSecret: e.target.value })} />
        <Input label="Owner email" type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password" type="password" autoComplete="new-password" required minLength={12} hint="Minimum 12 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Input label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" loading={busy}>
          Create owner account
        </Button>
      </form>
    </AuthFrame>
  );
}

export function LoginPage() {
  const state = useQuery({ queryKey: ["system-state"], queryFn: () => apiGet<SystemState>("/v1/system/state") });
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ email: "", password: "" });
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.data?.bootstrapRequired) return <Navigate to="/setup" replace />;
  if (state.data?.authenticated) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ mfaRequired: boolean; challenge?: string }>("/v1/auth/login", form);
      if (res.mfaRequired && res.challenge) {
        setChallenge(res.challenge);
      } else {
        toast("success", "Signed in");
        navigate("/");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost("/v1/auth/mfa/verify", { challenge, code });
      toast("success", "Signed in");
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title={challenge ? "Two-factor verification" : "Sign in"}
      subtitle={challenge ? "Enter a 6-digit authenticator code, or a single-use recovery code." : "Owner access only."}
    >
      {challenge ? (
        <form onSubmit={submitMfa} className="flex flex-col gap-3">
          <Input label="Code" autoFocus inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456 or ABCDE-FGHIJ" />
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" loading={busy}>
            Verify
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input label="Email" type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" loading={busy}>
            Sign in
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
