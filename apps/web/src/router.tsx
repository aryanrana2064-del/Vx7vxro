import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import type { SystemState } from "@vxqor/shared";
import { Navigate, createBrowserRouter, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary, Skeleton } from "./components/ui";
import { apiGet } from "./lib/api";
import { LoginPage, SetupPage } from "./routes/auth";

const OverviewPage = lazy(() => import("./routes/Overview").then((m) => ({ default: m.OverviewPage })));
const WebsitesPage = lazy(() => import("./routes/Websites").then((m) => ({ default: m.WebsitesPage })));
const WebsiteDetailPage = lazy(() => import("./routes/Websites").then((m) => ({ default: m.WebsiteDetailPage })));
const MonitoringPage = lazy(() => import("./routes/Monitoring").then((m) => ({ default: m.MonitoringPage })));
const IncidentsPage = lazy(() => import("./routes/Incidents").then((m) => ({ default: m.IncidentsPage })));
const AnalyticsPage = lazy(() => import("./routes/Analytics").then((m) => ({ default: m.AnalyticsPage })));
const PerformancePage = lazy(() => import("./routes/Performance").then((m) => ({ default: m.PerformancePage })));
const ErrorsPage = lazy(() => import("./routes/Errors").then((m) => ({ default: m.ErrorsPage })));
const GitActivityPage = lazy(() => import("./routes/GitActivity").then((m) => ({ default: m.GitActivityPage })));
const DeploymentsPage = lazy(() => import("./routes/Deployments").then((m) => ({ default: m.DeploymentsPage })));
const ApiExplorerPage = lazy(() => import("./routes/ApiExplorer").then((m) => ({ default: m.ApiExplorerPage })));
const SecurityEventsPage = lazy(() => import("./routes/Security").then((m) => ({ default: m.SecurityEventsPage })));
const SslDnsPage = lazy(() => import("./routes/Security").then((m) => ({ default: m.SslDnsPage })));
const AuditPage = lazy(() => import("./routes/Security").then((m) => ({ default: m.AuditPage })));
const ApiKeysPage = lazy(() => import("./routes/ApiKeys").then((m) => ({ default: m.ApiKeysPage })));
const IntegrationsPage = lazy(() => import("./routes/Integrations").then((m) => ({ default: m.IntegrationsPage })));
const ReportsPage = lazy(() => import("./routes/Reports").then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import("./routes/Settings").then((m) => ({ default: m.SettingsPage })));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const state = useQuery({ queryKey: ["system-state"], queryFn: () => apiGet<SystemState>("/v1/system/state") });
  if (state.isLoading) return <Skeleton className="h-full w-full" />;
  if (state.data?.bootstrapRequired) return <Navigate to="/setup" replace />;
  if (!state.data?.authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <ErrorBoundary>
      <AppShell>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>{children}</Suspense>
      </AppShell>
    </ErrorBoundary>
  );
}

function page(el: React.ReactNode) {
  return <RequireAuth>{el}</RequireAuth>;
}

export const router = createBrowserRouter([
  { path: "/setup", element: <SetupPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: page(<OverviewPage />) },
  { path: "/websites", element: page(<WebsitesPage />) },
  { path: "/websites/:id", element: page(<WebsiteDetailPage />) },
  { path: "/monitoring", element: page(<MonitoringPage />) },
  { path: "/incidents", element: page(<IncidentsPage />) },
  { path: "/analytics", element: page(<AnalyticsPage />) },
  { path: "/performance", element: page(<PerformancePage />) },
  { path: "/errors", element: page(<ErrorsPage />) },
  { path: "/git", element: page(<GitActivityPage />) },
  { path: "/deployments", element: page(<DeploymentsPage />) },
  { path: "/api-explorer", element: page(<ApiExplorerPage />) },
  { path: "/security", element: page(<SecurityEventsPage />) },
  { path: "/ssl-dns", element: page(<SslDnsPage />) },
  { path: "/audit", element: page(<AuditPage />) },
  { path: "/keys", element: page(<ApiKeysPage />) },
  { path: "/integrations", element: page(<IntegrationsPage />) },
  { path: "/reports", element: page(<ReportsPage />) },
  { path: "/settings", element: page(<SettingsPage />) },
  { path: "*", element: <Navigate to="/" replace /> },
]);
