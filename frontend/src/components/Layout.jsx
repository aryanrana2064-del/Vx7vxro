import { NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { dashboardStats } from "@/lib/ops";
import { toast } from "sonner";
import {
  LayoutDashboard, Zap, Package, Boxes, ShoppingCart, ReceiptText, Users, Truck,
  RotateCcw, BarChart3, QrCode, FileSpreadsheet, UserCog, ScrollText, Settings as Cog,
  KeyRound, Menu, X, LogOut, Wifi, WifiOff, CalendarCheck, PackagePlus, Bell, Sun, Moon,
} from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: null },
  { to: "/billing", label: "Billing", icon: Zap, perm: "billing", hot: true },
  { to: "/quick-bill", label: "Quick Bill", icon: Zap, perm: "billing" },
  { to: "/products", label: "Products", icon: Package, perm: null },
  { to: "/quick-stock", label: "Quick Stock Update", icon: PackagePlus, perm: "inventory" },
  { to: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory" },
  { to: "/purchases", label: "Purchases", icon: ShoppingCart, perm: "purchases" },
  { to: "/sales", label: "Sales", icon: ReceiptText, perm: "sales" },
  { to: "/customers", label: "Customers & Khata", icon: Users, perm: "customers" },
  { to: "/suppliers", label: "Suppliers", icon: Truck, perm: "suppliers" },
  { to: "/returns", label: "Returns", icon: RotateCcw, perm: "returns" },
  { to: "/reports", label: "Reports", icon: BarChart3, perm: "reports" },
  { to: "/day-close", label: "Day Closing", icon: CalendarCheck, perm: "reports" },
  { to: "/labels", label: "Barcode & Labels", icon: QrCode, perm: "labels" },
  { to: "/import-export", label: "Import / Export", icon: FileSpreadsheet, perm: "importexport" },
  { to: "/users", label: "Users & Permissions", icon: UserCog, perm: "settings" },
  { to: "/activity", label: "Activity Log", icon: ScrollText, perm: "activity" },
  { to: "/settings", label: "Settings", icon: Cog, perm: "settings" },
  { to: "/license", label: "License", icon: KeyRound, perm: "settings" },
];

export const Layout = ({ children }) => {
  const { user, shop, settings, logout, online, pending, can, tick } = useApp();
  const [open, setOpen] = useState(false);
  const [lowCount, setLowCount] = useState(0);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const alerted = useRef(false);
  const nav = useNavigate();

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("vyro_theme", next ? "dark" : "light");
  };

  const items = NAV.filter((n) => !n.perm || can(n.perm));

  useEffect(() => {
    let cancel = false;
    dashboardStats().then((d) => {
      if (cancel || !d) return;
      const n = Number(d.lowStockCount) || 0;
      setLowCount(n);
      if (n > 0 && !alerted.current) {
        alerted.current = true;
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) {
            const ac = new Ctx();
            const o = ac.createOscillator(); const g = ac.createGain();
            o.connect(g); g.connect(ac.destination);
            o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.05;
            o.start(); o.frequency.setValueAtTime(660, ac.currentTime + 0.12);
            o.stop(ac.currentTime + 0.24);
          }
        } catch { /* audio optional */ }
        toast.warning(`${n} product${n > 1 ? "s are" : " is"} low on stock`, {
          description: "Tap the bell or open Inventory to restock.",
          action: { label: "View", onClick: () => nav("/inventory") },
        });
      }
    }).catch(() => {});
    return () => { cancel = true; };
  }, [tick, nav]);

  const doLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] flex">
      {open && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        data-testid="sidebar"
        className={`fixed lg:static z-40 top-0 left-0 h-screen w-[260px] bg-[#101827] text-slate-300 flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/10 bg-gradient-to-br from-[#d4a437]/20 via-transparent to-blue-500/10">
          {settings?.logo ? (
            <img src={settings.logo} alt="logo" className="w-9 h-9 rounded-xl object-cover shadow-lg shadow-black/30 bg-white/10" />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#d4a437] to-[#f5c04a] flex items-center justify-center shadow-lg shadow-[#d4a437]/30">
              <Boxes className="text-[#0b1120]" size={18} strokeWidth={2.4} />
            </div>
          )}
          <div>
            <div className="text-white font-brand font-bold tracking-tight">VYRO VX7</div>
            <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{shop?.businessName || "Smart Business POS"}</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} data-testid="sidebar-close">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              data-testid={`nav-${n.to.slice(1)}`}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  isActive
                    ? "bg-[#d4a437] text-[#101827] font-semibold shadow-lg shadow-[#d4a437]/20"
                    : "hover:bg-white/5 hover:text-white hover:translate-x-0.5"
                }`
              }
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.hot && <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-white/10">F2</span>}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={doLogout}
          data-testid="logout-btn"
          className="m-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm bg-white/5 hover:bg-white/10"
        >
          <LogOut size={16} /> Logout
        </button>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <button className="lg:hidden" onClick={() => setOpen(true)} data-testid="sidebar-open">
            <Menu size={22} />
          </button>
          <div className="text-sm font-medium text-slate-700 truncate">
            {user?.name} <span className="text-slate-400">· {user?.role}</span>
          </div>
          <button
            data-testid="theme-toggle"
            onClick={toggleTheme}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="ml-auto p-2 rounded-full hover:bg-slate-100 transition-colors text-slate-500"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            data-testid="lowstock-bell"
            onClick={() => nav("/inventory")}
            title={lowCount > 0 ? `${lowCount} products low on stock` : "Stock healthy"}
            className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
          >
            <Bell size={18} className={lowCount > 0 ? "text-rose-500" : "text-slate-400"} />
            {lowCount > 0 && (
              <span data-testid="lowstock-count" className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{lowCount}</span>
            )}
          </button>
          <div
            data-testid="online-status"
            className={`text-xs px-2.5 py-1.5 rounded-full font-medium flex items-center gap-1.5 ${
              online ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {online ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span className="hidden sm:inline">{online ? "Online — Cloud synced" : "Offline — Working Locally"}</span>
          </div>
          {pending > 0 && (
            <div data-testid="pending-sync" className="text-xs px-2.5 py-1.5 rounded-full bg-sky-50 text-sky-700 font-medium">
              {pending} bill(s) to sync
            </div>
          )}
        </header>
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full animate-[fadeIn_.25s_ease-out]">{children}</main>
      </div>
    </div>
  );
};

export default Layout;
