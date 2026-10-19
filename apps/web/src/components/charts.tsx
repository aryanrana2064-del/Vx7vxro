import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimePoint } from "@vxqor/shared";
import { formatTick } from "../lib/format";
import { EmptyState } from "./ui";

const AXIS = { stroke: "#6d7683", fontSize: 10 } as const;
const GRID = "#1d232c";

export function TimeSeriesChart({ data, range, unit, height = 220, color = "#5ea3f7" }: { data: TimePoint[]; range: string; unit?: string; height?: number; color?: string }) {
  if (data.length === 0) {
    return <EmptyState title="No data in this window" body="Once real events arrive they will be charted here. VXQOR never renders placeholder metrics." />;
  }
  const points = data.map((d) => ({ ...d, label: formatTick(d.ts, range) }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={32} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={46} />
          <Tooltip
            contentStyle={{ background: "#171c23", border: "1px solid #232a33", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "#9aa4b0" }}
            formatter={(value) => [`${value}${unit ?? ""}`, "value"]}
          />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.6} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarListChart({ data, unit, height = 220, color = "#5ea3f7" }: { data: { label: string; value: number }[]; unit?: string; height?: number; color?: string }) {
  if (data.length === 0) {
    return <EmptyState title="No data in this window" body="Aggregates appear once real measurements are ingested." />;
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={46} />
          <Tooltip cursor={{ fill: "#1d232c" }} contentStyle={{ background: "#171c23", border: "1px solid #232a33", borderRadius: 6, fontSize: 12 }} formatter={(value) => [`${value}${unit ?? ""}`, "value"]} />
          <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MetricTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "warn" | "danger" }) {
  const color = tone === "success" ? "text-success" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted">{sub}</p> : null}
    </div>
  );
}
