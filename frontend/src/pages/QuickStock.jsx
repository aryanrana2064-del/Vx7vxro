import { useEffect, useMemo, useState } from "react";
import { all } from "@/lib/db";
import { adjustStock, money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Search, Plus, Minus, PackageCheck, ScanLine } from "lucide-react";

export default function QuickStock() {
  const { can, refresh, settings } = useApp();
  const [products, setProducts] = useState([]);
  const [term, setTerm] = useState("");
  const [sel, setSel] = useState(null);
  const [qty, setQty] = useState(1);
  const [type, setType] = useState("in");
  const [reason, setReason] = useState("Manual Adjustment");
  const [busy, setBusy] = useState(false);

  const load = async () => { try { setProducts(await all("products")); } catch (e) { toast.error(apiError(e)); } };
  useEffect(() => { load(); }, []);

  const matches = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return products.filter((p) =>
      p.name.toLowerCase().includes(t) || String(p.code).toLowerCase().includes(t) || String(p.barcode || "").includes(t)
    ).slice(0, 8);
  }, [term, products]);

  const pick = (p) => { setSel(p); setTerm(""); setQty(1); };

  const newStock = sel ? (Number(sel.stock) || 0) + (type === "in" ? 1 : -1) * (Number(qty) || 0) : 0;
  const canAdjust = can("stock_adjust") || can("*");

  const apply = async () => {
    if (!sel) return toast.error("Select a product first");
    if (!canAdjust) return toast.error("You do not have permission to adjust stock");
    if (!(Number(qty) > 0)) return toast.error("Enter a quantity greater than 0");
    setBusy(true);
    try {
      const updated = await adjustStock({ productId: sel.id, qty: Number(qty), type, reason });
      setSel(updated);
      await load();
      refresh();
      toast.success(`${sel.name}: stock ${type === "in" ? "increased" : "reduced"} to ${updated.stock}`);
      setQty(1);
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl" data-testid="quick-stock-page">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Quick Stock Update</h1>
        <p className="text-sm text-slate-500">Find a product and add or subtract stock instantly — no full edit needed.</p>
      </div>

      <div className="card p-4 relative">
        <label className="text-xs text-slate-500">Search by name, code or barcode</label>
        <div className="relative mt-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input data-testid="qs-search" autoFocus value={term} onChange={(e) => setTerm(e.target.value)}
            placeholder="Scan or type to search…" className="inp pl-9 py-3" />
        </div>
        {matches.length > 0 && (
          <div data-testid="qs-suggestions" className="absolute z-10 left-4 right-4 mt-1 bg-white border rounded-xl shadow-lg max-h-72 overflow-auto">
            {matches.map((p) => (
              <button key={p.id} data-testid={`qs-pick-${p.code}`} onClick={() => pick(p)}
                className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex justify-between text-sm border-b border-slate-50 last:border-0">
                <span className="truncate pr-2">{p.name} <span className="text-slate-400">· {p.code}</span></span>
                <span className="tabular-nums whitespace-nowrap">stock {p.stock} {p.unit}</span>
              </button>
            ))}
          </div>
        )}
        {term.trim() && matches.length === 0 && (
          <div className="mt-2 text-sm text-slate-400 flex items-center gap-1.5"><ScanLine size={14} /> No product matches "{term.trim()}"</div>
        )}
      </div>

      {sel && (
        <div className="card p-5 space-y-4" data-testid="qs-adjust-panel">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-display text-lg font-semibold">{sel.name}</div>
              <div className="text-xs text-slate-500 font-mono">{sel.code} · {sel.barcode || "no barcode"}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Current Stock</div>
              <div data-testid="qs-current-stock" className="font-display text-2xl font-bold tabular-nums">{sel.stock} <span className="text-sm font-normal text-slate-400">{sel.unit}</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button data-testid="qs-type-in" onClick={() => setType("in")} className={`py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${type === "in" ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white border-slate-300 hover:bg-slate-50"}`}><Plus size={16} /> Add Stock</button>
            <button data-testid="qs-type-out" onClick={() => setType("out")} className={`py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${type === "out" ? "bg-rose-500 border-rose-500 text-white" : "bg-white border-slate-300 hover:bg-slate-50"}`}><Minus size={16} /> Reduce Stock</button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Quantity</span>
              <div className="flex items-center gap-2 mt-1">
                <button type="button" onClick={() => setQty((q) => Math.max(0, Number(q) - 1))} className="w-11 h-11 border rounded-lg flex items-center justify-center"><Minus size={16} /></button>
                <input data-testid="qs-qty" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="inp py-3 text-center tabular-nums flex-1" />
                <button type="button" onClick={() => setQty((q) => Number(q) + 1)} className="w-11 h-11 border rounded-lg flex items-center justify-center"><Plus size={16} /></button>
              </div>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Reason</span>
              <select data-testid="qs-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="inp py-3 mt-1">
                {["Manual Adjustment", "New Stock Received", "Opening Stock", "Damaged Stock", "Lost", "Found", "Stock Count Correction"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">New stock after update</span>
            <span data-testid="qs-new-stock" className={`font-display text-xl font-bold tabular-nums ${newStock < 0 ? "text-rose-600" : "text-slate-900"}`}>{newStock} {sel.unit}</span>
          </div>
          {newStock < 0 && !settings?.allowNegativeStock && <p className="text-xs text-rose-600">This would make stock negative. Enable "Allow Negative Stock" in Settings or reduce the quantity.</p>}

          <button data-testid="qs-apply" onClick={apply} disabled={busy} className="btn-gold w-full justify-center py-3.5 text-base"><PackageCheck size={18} /> {busy ? "Saving…" : "Apply Stock Update"}</button>
        </div>
      )}
    </div>
  );
}
