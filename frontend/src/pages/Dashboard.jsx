import { useEffect, useState } from "react";
import { dashboardStats, money } from "@/lib/ops";
import { useApp } from "@/context/AppContext";
import { useNavigate } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, XAxis, Tooltip, CartesianGrid, YAxis } from "recharts";
import { TrendingUp, ShoppingBag, IndianRupee, Package, Layers, Wallet, AlertTriangle, Users, Receipt, Truck, Zap, CalendarCheck2, Sparkles, ArrowUpRight } from "lucide-react";

const TONES = {
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-100" },
  blue:    { bg: "bg-blue-50",    text: "text-blue-600",    ring: "ring-blue-100" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-600",   ring: "ring-amber-100" },
  slate:   { bg: "bg-slate-100",  text: "text-slate-600",   ring: "ring-slate-200" },
  rose:    { bg: "bg-rose-50",    text: "text-rose-600",    ring: "ring-rose-100" },
  violet:  { bg: "bg-violet-50",  text: "text-violet-600",  ring: "ring-violet-100" },
  sky:     { bg: "bg-sky-50",     text: "text-sky-600",     ring: "ring-sky-100" },
};

const KPI = ({ label, value, icon: Icon, tone = "slate", testid, delay = 0 }) => {
  const t = TONES[tone] || TONES.slate;
  return (
    <div
      data-testid={testid}
      className={`card card-hover p-4 rise ${["rise-1","rise-2","rise-3","rise-4","rise-5"][delay % 5]}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-slate-500">{label}</span>
        <span className={`stat-pill ${t.bg} ${t.text} ring-1 ${t.ring}`}>
          <Icon size={18} strokeWidth={2.2} />
        </span>
      </div>
      <div className="kpi-value">{value}</div>
    </div>
  );
};

const Panel = ({ title, subtitle, children, action, className = "" }) => (
  <div className={`card card-hover ${className}`}>
    <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
    <div className="px-5 pb-5">{children}</div>
  </div>
);

function TotalProductsRing({ count = 0, lowStock = 0, onClick }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    // Count-up animation whenever count changes (e.g., new product added -> tick refresh)
    const start = display;
    const end = Number(count) || 0;
    if (start === end) return;
    const dur = 700;
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const R = 74;
  const C = 2 * Math.PI * R;
  const target = Math.max(50, Math.ceil((Number(count) || 0) / 50) * 50);
  const pct = Math.min(1, (Number(count) || 0) / target);
  const good = Math.max(0, (Number(count) || 0) - (Number(lowStock) || 0));
  const goodPct = (Number(count) || 0) > 0 ? good / (Number(count) || 1) : 0;

  return (
    <button
      type="button"
      data-testid="total-products-ring"
      onClick={onClick}
      className="relative group focus:outline-none"
      title="Go to Products"
    >
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#d4a437]/25 to-blue-500/10 blur-2xl scale-110 opacity-70 group-hover:opacity-100 transition-opacity" />
      <svg width="188" height="188" viewBox="0 0 188 188" className="relative -rotate-90">
        <defs>
          <linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d4a437" />
            <stop offset="60%" stopColor="#f5c04a" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
          <linearGradient id="ringGood" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <circle cx="94" cy="94" r={R} stroke="rgba(255,255,255,0.08)" strokeWidth="10" fill="none" />
        <circle
          cx="94" cy="94" r={R}
          stroke="url(#ringG)"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${C}`}
          strokeDashoffset={`${C - C * pct}`}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.22,.61,.36,1)" }}
        />
        <circle
          cx="94" cy="94" r={R - 14}
          stroke="url(#ringGood)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * (R - 14)}`}
          strokeDashoffset={`${2 * Math.PI * (R - 14) * (1 - goodPct)}`}
          opacity="0.75"
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.22,.61,.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-300/80 font-semibold">Total Products</div>
        <div data-testid="ring-count" className="font-display text-4xl font-bold text-white tabular-nums leading-none mt-1">
          {display}
        </div>
        <div className="text-[10.5px] text-slate-400 mt-1.5 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          {good} in stock{lowStock > 0 && <span className="text-rose-300 ml-1">· {lowStock} low</span>}
        </div>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const { tick, shop } = useApp();
  const [s, setS] = useState(null);
  const nav = useNavigate();

  useEffect(() => { dashboardStats().then((d) => d && setS(d)).catch(() => {}); }, [tick]);
  if (!s) return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {Array.from({length:10}).map((_,i) => (
        <div key={i} className="card p-4 h-24 animate-pulse bg-slate-100" />
      ))}
    </div>
  );

  const totalCat = (s.categorySales || []).reduce((a, b) => a + b.amount, 0) || 1;

  return (
    <div className="space-y-6" data-testid="dashboard">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-[#0b1120] text-white p-6 sm:p-8 rise">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-blue-500/25 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-[#d4a437]/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300/90 tracking-wide">
              <Sparkles size={13} className="text-[#d4a437]" />
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold mt-1 tracking-tight">
              {shop?.businessName || "Your Shop"}<span className="text-[#d4a437]">.</span>
            </h1>
            <p className="text-sm text-slate-300/80 mt-1">
              {shop?.businessType || "Smart Business POS"} · Live sales, stock and cash flow at a glance
            </p>
            <div className="flex gap-2 flex-wrap mt-4">
              <button data-testid="dash-day-close" onClick={() => nav("/day-close")}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 backdrop-blur border border-white/15 px-4 py-2.5 text-sm font-medium transition-all">
                <CalendarCheck2 size={16} /> Day Closing
              </button>
              <button data-testid="dash-quick-bill" onClick={() => nav("/quick-bill")} className="btn-primary">
                <Zap size={16} className="text-[#d4a437]" /> Quick Bill
              </button>
              <button data-testid="dash-new-bill" onClick={() => nav("/billing")} className="btn-gold">
                New Bill <ArrowUpRight size={15} />
              </button>
            </div>
          </div>

          {/* Animated Total Products circle */}
          <TotalProductsRing count={s.totalProducts} lowStock={s.lowStockCount} onClick={() => nav("/products")} />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <KPI testid="stat-today-sales"    label="Today's Sales"        value={money(s.todaySales)}       icon={TrendingUp}   tone="emerald" delay={0}/>
        <KPI testid="stat-today-purchases" label="Today's Purchases"   value={money(s.todayPurchases)}   icon={ShoppingBag}  tone="blue"    delay={1}/>
        <KPI testid="stat-today-profit"    label="Today's Profit"      value={money(s.todayProfit)}      icon={IndianRupee}  tone="amber"   delay={2}/>
        <KPI testid="stat-products"        label="Total Products"      value={s.totalProducts}           icon={Package}      tone="violet"  delay={3}/>
        <KPI testid="stat-units"           label="Stock Units"         value={s.totalUnits}              icon={Layers}       tone="sky"     delay={4}/>
        <KPI testid="stat-stock-value"     label="Stock Value"         value={money(s.stockValue)}       icon={Wallet}       tone="slate"   delay={0}/>
        <KPI testid="stat-low-stock"       label="Low Stock"           value={s.lowStockCount}           icon={AlertTriangle} tone="rose"    delay={1}/>
        <KPI testid="stat-customers"       label="Customers"           value={s.customers}               icon={Users}        tone="blue"    delay={2}/>
        <KPI testid="stat-outstanding"     label="Cust. Outstanding"   value={money(s.outstanding)}      icon={Receipt}      tone="rose"    delay={3}/>
        <KPI testid="stat-supplier-outstanding" label="Supp. Outstanding" value={money(s.supplierOutstanding || 0)} icon={Truck} tone="sky" delay={4}/>
      </div>

      {/* Chart + Category */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2" title="Sales Overview" subtitle="Last 7 days">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[["Today", s.todaySales], ["Week", s.weekSales], ["Month", s.monthSales]].map(([k,v]) => (
              <div key={k} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                <div className="text-[10.5px] uppercase tracking-wide text-slate-500 font-semibold">{k}</div>
                <div className="font-display text-lg font-bold tabular-nums text-slate-900">{money(v)}</div>
              </div>
            ))}
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <AreaChart data={s.series} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4a437" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#d4a437" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#e2e8f0" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" />
                <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" width={50} />
                <Tooltip
                  cursor={{ stroke: "#94a3b8", strokeDasharray: 3 }}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 8px 24px -8px rgba(16,24,39,.15)" }}
                  formatter={(v) => money(v)}
                />
                <Area type="monotone" dataKey="sales" stroke="#d4a437" strokeWidth={2.5} fill="url(#gGold)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Sales by Category" subtitle="Top performing categories">
          <div className="space-y-3.5" data-testid="category-sales">
            {(s.categorySales || []).length === 0 && <div className="text-slate-400 text-sm">No sales yet</div>}
            {(s.categorySales || []).map((c) => {
              const pct = Math.max(4, Math.round((c.amount / totalCat) * 100));
              return (
                <div key={c.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="truncate pr-2 font-medium text-slate-700">{c.category}</span>
                    <span className="tabular-nums text-slate-500">{money(c.amount)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-2 rounded-full bg-gradient-to-r from-[#d4a437] to-[#f5c04a]" style={{ width: `${pct}%`, transition: "width .6s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
          <h4 className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-slate-500 mt-6 mb-2">Top Selling</h4>
          <div className="space-y-1.5 text-sm">
            {s.top.length === 0 && <div className="text-slate-400">No sales yet</div>}
            {s.top.map((t) => (
              <div key={t.name} className="flex justify-between items-center py-1 border-b border-slate-100 last:border-0">
                <span className="truncate pr-2">{t.name}</span>
                <span className="tabular-nums text-slate-500 text-xs bg-slate-100 rounded-full px-2 py-0.5">{t.qty}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Lists */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Low Stock" subtitle="Restock recommended">
          <div className="space-y-1.5 text-sm" data-testid="low-stock-list">
            {s.lowStock.length === 0 && <div className="text-slate-400">All good — inventory is healthy</div>}
            {s.lowStock.map((p) => (
              <div key={p.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                <span className="truncate pr-2">{p.name}</span>
                <span className="text-rose-600 tabular-nums font-semibold text-xs bg-rose-50 rounded-full px-2 py-0.5">{p.stock}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Recent Sales" subtitle="Latest invoices">
          <div className="space-y-1.5 text-sm" data-testid="recent-sales">
            {s.recentSales.map((x) => (
              <div key={x.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                <span className="truncate pr-2"><span className="font-medium">{x.invoiceNo}</span> <span className="text-slate-500">· {x.customerName || "Walk-in"}</span></span>
                <span className="tabular-nums font-semibold">{money(x.total)}</span>
              </div>
            ))}
            {!s.recentSales.length && <div className="text-slate-400">No sales yet</div>}
          </div>
        </Panel>
        <Panel title="Outstanding Customers" subtitle="Payments to collect">
          <div className="space-y-1.5 text-sm">
            {s.outstandingCustomers.map((c) => (
              <div key={c.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                <span>{c.name}</span>
                <span className="tabular-nums text-rose-600 font-semibold">{money(c.balance)}</span>
              </div>
            ))}
            {!s.outstandingCustomers.length && <div className="text-slate-400">Nothing pending — you're clear</div>}
          </div>
        </Panel>
      </div>

      <Panel title="Recent Purchases" subtitle="Latest supplier bills">
        <div className="space-y-1.5 text-sm">
          {s.recentPurchases.map((x) => (
            <div key={x.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
              <span className="truncate pr-2"><span className="font-medium">{x.purchaseNo}</span> <span className="text-slate-500">· {x.supplierName || "—"}</span></span>
              <span className="tabular-nums font-semibold">{money(x.total)}</span>
            </div>
          ))}
          {!s.recentPurchases.length && <div className="text-slate-400">No purchases yet</div>}
        </div>
      </Panel>
    </div>
  );
}
