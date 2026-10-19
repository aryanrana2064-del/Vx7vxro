import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Copy, Info, Loader2, X, XCircle } from "lucide-react";

/* ---------- primitives ---------- */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; loading?: boolean }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none select-none";
  const sizes = size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-primary text-[#081018] hover:bg-primary-hover",
    secondary: "bg-surface-2 text-ink border border-line hover:border-line-strong hover:bg-surface-3",
    ghost: "text-muted hover:text-ink hover:bg-surface-2",
    danger: "bg-[#3a1519] text-danger border border-[#5c262c] hover:bg-[#4a1a20]",
  };
  return (
    <button className={cx(base, sizes, variants[variant], className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Input({ label, hint, error, className, id, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string | null }) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={cx(
          "h-9 rounded-md border bg-surface-2 px-3 text-sm text-ink placeholder:text-faint transition-colors duration-150",
          error ? "border-danger" : "border-line hover:border-line-strong focus:border-primary",
          className,
        )}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  );
}

export function Select({ label, className, children, id, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={selectId} className="text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <select id={selectId} className={cx("h-9 rounded-md border border-line bg-surface-2 px-2.5 text-sm text-ink hover:border-line-strong", className)} {...rest}>
        {children}
      </select>
    </div>
  );
}

export function Textarea({ label, className, id, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const auto = useId();
  const areaId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={areaId} className="text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <textarea id={areaId} className={cx("rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink font-mono text-xs", className)} {...rest} />
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-faint">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "success" | "warn" | "danger" | "info";

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-surface-2 text-muted border-line",
    success: "bg-[#12261a] text-success border-[#1f4029]",
    warn: "bg-[#2b2109] text-warn border-[#4d3a12]",
    danger: "bg-[#3a1519] text-danger border-[#5c262c]",
    info: "bg-[#12233a] text-primary border-[#1f3a5c]",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>{children}</span>;
}

export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-faint",
    success: "bg-success",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-primary",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("h-2 w-2 rounded-full", colors[tone])} aria-hidden />
      {label ? <span className="text-xs text-muted">{label}</span> : null}
    </span>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "up":
    case "ready":
    case "resolved":
    case "pass":
    case "connected":
    case "ok":
      return "success";
    case "degraded":
    case "warn":
    case "acknowledged":
    case "investigating":
    case "building":
    case "queued":
      return "warn";
    case "down":
    case "fail":
    case "error":
    case "detected":
    case "critical":
      return "danger";
    default:
      return "neutral";
  }
}

/* ---------- table ---------- */

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td className={cx("px-3 py-2 align-middle text-ink", className)} colSpan={colSpan}>
      {children}
    </td>
  );
}

/* ---------- states ---------- */

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
      <div className="text-faint">{icon ?? <Info size={20} aria-hidden />}</div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {body ? <div className="max-w-md text-xs leading-relaxed text-muted">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-[#5c262c] bg-[#201012] px-6 py-8 text-center">
      <XCircle size={20} className="text-danger" aria-hidden />
      <p className="text-sm text-danger">{message}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("vx-skeleton rounded", className)} aria-hidden />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ---------- dialog ---------- */

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx("vx-enter w-full rounded-lg border border-line bg-surface shadow-xl shadow-black/40", wide ? "max-w-2xl" : "max-w-md")}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink">
            <X size={15} />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = "Confirm", danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="text-sm text-muted">{body}</div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/* ---------- drawer ---------- */

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={title} className="vx-enter absolute right-0 top-0 h-full w-full max-w-lg overflow-y-auto border-l border-line bg-surface p-4 shadow-2xl shadow-black/50">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close panel" className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink">
            <X size={15} />
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}

/* ---------- tabs ---------- */

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-150",
            active === t.id ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- pagination ---------- */

export function Pagination({ page, perPage, total, onPage }: { page: number; perPage: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
      <span>
        {total} items · page {page}/{pages}
      </span>
      <div className="flex gap-1">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ---------- copy field ---------- */

export function CopyField({ value, secret }: { value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
      <code className="flex-1 truncate font-mono text-xs text-ink">{secret ? value : value}</code>
      <button
        aria-label="Copy to clipboard"
        className="rounded p-1 text-faint hover:bg-surface-3 hover:text-ink"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/* ---------- toasts ---------- */

interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<(tone: Tone, message: string) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const icons = useMemo(
    () => ({
      success: <Check size={14} className="text-success" />,
      danger: <XCircle size={14} className="text-danger" />,
      warn: <AlertTriangle size={14} className="text-warn" />,
      info: <Info size={14} className="text-primary" />,
      neutral: <Info size={14} className="text-muted" />,
    }),
    [],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="vx-enter pointer-events-auto flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 shadow-lg shadow-black/40">
            {icons[t.tone]}
            <span className="flex-1 text-xs text-ink">{t.message}</span>
            <button aria-label="Dismiss" className="text-faint hover:text-ink" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- error boundary ---------- */

import { Component, type ErrorInfo } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("vxqor ui error", error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return <ErrorState message={`Interface error: ${this.state.error.message}`} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
