import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Bug,
  ChevronDown,
  FileDown,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Menu,
  Plug,
  Rocket,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  Globe,
  LogOut,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { SystemState } from "@vxqor/shared";
import { apiGet, apiPost } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Badge, StatusDot, cx } from "./ui";

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode }[] }[] = [
  {
    group: "Workspace",
    items: [
      { to: "/", label: "Overview", icon: <LayoutDashboard size={15} /> },
      { to: "/websites", label: "Websites", icon: <Globe size={15} /> },
      { to: "/monitoring", label: "Monitoring", icon: <Activity size={15} /> },
      { to: "/incidents", label: "Incidents", icon: <LifeBuoy size={15} /> },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { to: "/analytics", label: "Analytics", icon: <BarChart3 size={15} /> },
      { to: "/performance", label: "Performance", icon: <Activity size={15} /> },
      { to: "/errors", label: "Errors & Logs", icon: <Bug size={15} /> },
    ],
  },
  {
    group: "Development",
    items: [
      { to: "/git", label: "Git Activity", icon: <GitBranch size={15} /> },
      { to: "/deployments", label: "Deployments", icon: <Rocket size={15} /> },
      { to: "/api-explorer", label: "API Explorer", icon: <TerminalSquare size={15} /> },
    ],
  },
  {
    group: "Security",
    items: [
      { to: "/security", label: "Security Events", icon: <ShieldAlert size={15} /> },
      { to: "/ssl-dns", label: "SSL & DNS", icon: <ShieldCheck size={15} /> },
      { to: "/audit", label: "Audit Trail", icon: <ScrollText size={15} /> },
    ],
  },
  {
    group: "Management",
    items: [
      { to: "/keys", label: "API Keys", icon: <KeyRound size={15} /> },
      { to: "/integrations", label: "Integrations", icon: <Plug size={15} /> },
      { to: "/reports", label: "Reports & Exports", icon: <FileDown size={15} /> },
      { to: "/settings", label: "Settings", icon: <Settings size={15} /> },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const navigate = useNavigate();
  const state = useQuery({ queryKey: ["system-state"], queryFn: () => apiGet<SystemState>("/v1/system/state") });

  const logout = async () => {
    await apiPost("/v1/auth/logout");
    navigate("/login");
  };

  const sidebar = (
    <nav aria-label="Primary" className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <div className="flex items-center gap-2 px-1">
        <img src="/brand/monogram.jpg" alt="" className="h-7 w-7 rounded" />
        <span className="text-sm font-semibold tracking-[0.18em] text-ink">VXQOR</span>
      </div>
      {NAV.map((group) => (
        <div key={group.group}>
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{group.group}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-150",
                      isActive ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
                    )
                  }
                >
                  <span className="text-faint">{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto px-2 pb-2 text-[10px] leading-relaxed text-faint">
        Private owner-operated console.
        <br />
        Scheduler: {state.data?.scheduler.lastSuccessAt ? `last run ${timeAgo(state.data.scheduler.lastRunAt)}` : "not run yet"}
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setMobileOpen(false)}>
          <aside className="vx-enter h-full w-64 border-r border-line bg-surface">
            <button className="absolute right-3 top-3 text-faint" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
              <X size={16} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <button className="text-muted lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu size={17} />
          </button>
          <div className="flex flex-1 items-center gap-3">
            {state.data?.scheduler.stale ? (
              <Badge tone="warn">Scheduler stale — checks may be delayed</Badge>
            ) : state.data?.scheduler.lastSuccessAt ? (
              <StatusDot tone="success" label={`Monitoring active · ${timeAgo(state.data.scheduler.lastSuccessAt)}`} />
            ) : (
              <StatusDot tone="neutral" label="Scheduler has not run yet" />
            )}
          </div>
          <div className="relative">
            <button
              className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink hover:border-line-strong"
              onClick={() => setUserOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userOpen}
            >
              <span className="max-w-[180px] truncate">{state.data?.owner?.email ?? "owner"}</span>
              {state.data?.owner?.mfaEnabled ? <Badge tone="success">MFA</Badge> : null}
              <ChevronDown size={13} className="text-faint" />
            </button>
            {userOpen ? (
              <div role="menu" className="vx-enter absolute right-0 top-9 z-30 w-44 rounded-md border border-line bg-surface-2 py-1 shadow-lg shadow-black/40">
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-surface-3 hover:text-ink"
                  onClick={() => {
                    setUserOpen(false);
                    navigate("/settings");
                  }}
                >
                  <Settings size={13} /> Settings
                </button>
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-surface-3 hover:text-ink"
                  onClick={() => {
                    setUserOpen(false);
                    void logout();
                  }}
                >
                  <LogOut size={13} /> Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function RangeSelect({ value, onChange }: { value: string; onChange: (v: "24h" | "7d" | "30d" | "90d") => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Range
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "24h" | "7d" | "30d" | "90d")}
        className="h-8 rounded-md border border-line bg-surface-2 px-2 text-xs text-ink"
        aria-label="Time range"
      >
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
    </label>
  );
}

export const navIcons = { ListChecks };
