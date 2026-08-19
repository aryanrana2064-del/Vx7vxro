import { useEffect, useMemo, useState } from "react";
import { all } from "@/lib/db";
import { createReturn, money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { printReturnReceipt } from "@/lib/print";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { RotateCcw, Printer, Search } from "lucide-react";

const MODES = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];

export default function Returns() {
  const { settings, refresh, can } = useApp();
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [list, setList] = useState([]);
  const [mode, setMode] = useState("bill"); // "bill" | "manual"
  const [saleTerm, setSaleTerm] = useState("");
  const [sale, setSale] = useState(null);
  const [lines, setLines] = useState([]); // {productId,name,code,price,maxQty,qty,checked}
  const [refundMode, setRefundMode] = useState("Cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // manual mode
  const [mrow, setMrow] = useState({ productId: "", qty: 1, price: 0 });

  const editable = can("returns") || can("*");

  const load = async () => {
    setProducts(await all("products"));
    setSales((await all("sales")).filter((s) => s.status !== "void").sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setList((await all("returns")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };
  useEffect(() => { load(); }, []);

  const saleMatches = useMemo(() => {
    const t = saleTerm.trim().toLowerCase();
    if (!t) return sales.slice(0, 6);
    return sales.filter((s) => String(s.invoiceNo).toLowerCase().includes(t) || String(s.customerName || "").toLowerCase().includes(t)).slice(0, 8);
  }, [saleTerm, sales]);

  const pickSale = (s) => {
    setSale(s);
    setSaleTerm("");
    setLines((s.items || []).map((i) => ({
      productId: i.productId, name: i.name, code: i.code, price: i.price,
      maxQty: i.qty, qty: i.qty, checked: false, quickBill: i.quickBill,
    })));
  };

  const refundTotal = useMemo(
    () => lines.filter((l) => l.checked).reduce((s, l) => s + l.price * (Number(l.qty) || 0), 0),
    [lines]
  );

  const submitBill = async () => {
    const chosen = lines.filter((l) => l.checked && Number(l.qty) > 0);
    if (!sale) return toast.error("Select a bill to refund against");
    if (!chosen.length) return toast.error("Tick at least one item to return");
    for (const l of chosen) if (Number(l.qty) > l.maxQty) return toast.error(`${l.name}: cannot return more than ${l.maxQty}`);
    setBusy(true);
    try {
      const ret = await createReturn({
        kind: "sale", refId: sale.id, refundMode, note,
        items: chosen.map((l) => ({ productId: l.quickBill ? "" : l.productId, name: l.name, code: l.code, qty: Number(l.qty), price: Number(l.price) })),
      });
      toast.success(`Refund ${ret.returnNo} saved · ${money(ret.total)} · stock restored`);
      printReturnReceipt(ret, settings);
      setSale(null); setLines([]); setNote("");
      await load(); refresh();
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };

  const submitManual = async () => {
    const p = products.find((x) => x.id === mrow.productId);
    if (!p) return toast.error("Select a product");
    setBusy(true);
    try {
      const ret = await createReturn({ kind: "sale", refundMode, note, items: [{ productId: p.id, name: p.name, code: p.code, qty: Number(mrow.qty), price: Number(mrow.price || p.price) }] });
      toast.success(`Refund ${ret.returnNo} saved · stock restored`);
      printReturnReceipt(ret, settings);
      setMrow({ productId: "", qty: 1, price: 0 });
      await load(); refresh();
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="returns-page">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Returns &amp; Refunds</h1>
        <p className="text-sm text-slate-500">Refund items from a past bill — stock is added back automatically and a return receipt is printed.</p>
      </div>

      <div className="flex gap-2">
        {[["bill", "Refund from a Bill"], ["manual", "Quick Return"]].map(([k, l]) => (
          <button key={k} data-testid={`return-mode-${k}`} onClick={() => setMode(k)} className={`px-3.5 py-2 rounded-lg text-sm border transition-all ${mode === k ? "bg-[#101827] text-white border-[#101827]" : "bg-white border-slate-300 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>

      {mode === "bill" && editable && (
        <div className="card p-4 space-y-4" data-testid="refund-from-bill">
          {!sale ? (
            <div className="relative">
              <label className="text-xs text-slate-500">Find bill by invoice no. or customer</label>
              <div className="relative mt-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input data-testid="r-sale-search" value={saleTerm} onChange={(e) => setSaleTerm(e.target.value)} placeholder="e.g. INV-0001 or customer name" className="inp pl-9 py-3" />
              </div>
              <div className="mt-2 divide-y" data-testid="r-sale-list">
                {saleMatches.map((s) => (
                  <button key={s.id} data-testid={`r-sale-${s.invoiceNo}`} onClick={() => pickSale(s)} className="w-full text-left py-2.5 flex justify-between text-sm hover:bg-slate-50 px-1 rounded">
                    <span><b>{s.invoiceNo}</b> · {s.customerName || "Walk-in"} <span className="text-slate-400">· {new Date(s.createdAt).toLocaleDateString("en-IN")}</span></span>
                    <span className="tabular-nums">{money(s.total)}</span>
                  </button>
                ))}
                {!saleMatches.length && <div className="text-sm text-slate-400 py-3">No bills found</div>}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold">{sale.invoiceNo} · {sale.customerName || "Walk-in"}</div>
                  <div className="text-xs text-slate-500">{new Date(sale.createdAt).toLocaleString("en-IN")} · Bill total {money(sale.total)}</div>
                </div>
                <button data-testid="r-change-bill" onClick={() => { setSale(null); setLines([]); }} className="btn-ghost py-1.5 text-xs">Change bill</button>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="th"><tr>
                    <th className="p-2.5 text-left">Return</th><th className="p-2.5 text-left">Item</th>
                    <th className="p-2.5 text-right">Sold Qty</th><th className="p-2.5 text-right">Return Qty</th>
                    <th className="p-2.5 text-right">Price</th><th className="p-2.5 text-right">Refund</th></tr></thead>
                  <tbody data-testid="r-lines">
                    {lines.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2.5"><input data-testid={`r-check-${i}`} type="checkbox" checked={l.checked} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))} className="w-4 h-4 accent-[#d4a437]" /></td>
                        <td className="p-2.5">{l.name} <span className="text-slate-400 text-xs">{l.code}</span></td>
                        <td className="p-2.5 text-right tabular-nums text-slate-500">{l.maxQty}</td>
                        <td className="p-2.5 text-right"><input data-testid={`r-qty-${i}`} type="number" min="0" max={l.maxQty} value={l.qty} disabled={!l.checked} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} className="w-16 border rounded px-2 py-1 text-right tabular-nums disabled:opacity-40" /></td>
                        <td className="p-2.5 text-right tabular-nums">{money(l.price)}</td>
                        <td className="p-2.5 text-right tabular-nums font-medium">{l.checked ? money(l.price * (Number(l.qty) || 0)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-xs text-slate-500">Refund Mode</span>
                  <select data-testid="r-refund-mode" value={refundMode} onChange={(e) => setRefundMode(e.target.value)} className="inp mt-1">{MODES.map((m) => <option key={m}>{m}</option>)}</select>
                </label>
                <label className="block"><span className="text-xs text-slate-500">Note (optional)</span>
                  <input data-testid="r-note" value={note} onChange={(e) => setNote(e.target.value)} className="inp mt-1" placeholder="Reason / detail" />
                </label>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 p-3">
                <span className="text-sm text-slate-500">Total Refund</span>
                <span data-testid="r-refund-total" className="font-display text-xl font-bold tabular-nums text-[#b8892b]">{money(refundTotal)}</span>
              </div>

              <button data-testid="r-submit-bill" onClick={submitBill} disabled={busy} className="btn-gold w-full justify-center py-3.5"><RotateCcw size={16} /> {busy ? "Processing…" : "Process Refund & Print Receipt"}</button>
            </>
          )}
        </div>
      )}

      {mode === "manual" && editable && (
        <div className="card p-4 grid sm:grid-cols-4 gap-3 items-end" data-testid="manual-return">
          <label className="block"><span className="text-xs text-slate-500">Product</span>
            <select data-testid="r-product" value={mrow.productId} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); setMrow({ ...mrow, productId: e.target.value, price: p ? p.price : 0 }); }} className="inp mt-1">
              <option value="">Select…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{`${p.name} (${p.stock})`}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs text-slate-500">Qty</span><input data-testid="r-qty" type="number" value={mrow.qty} onChange={(e) => setMrow({ ...mrow, qty: e.target.value })} className="inp mt-1" /></label>
          <label className="block"><span className="text-xs text-slate-500">Refund each</span><input data-testid="r-price" type="number" value={mrow.price} onChange={(e) => setMrow({ ...mrow, price: e.target.value })} className="inp mt-1" /></label>
          <button data-testid="r-submit" onClick={submitManual} disabled={busy} className="btn-gold justify-center">Save Return</button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr><th className="text-left p-3">Return No</th><th className="text-left p-3">Bill</th><th className="text-left p-3">Date</th><th className="text-left p-3">Items</th><th className="text-right p-3">Refund</th><th className="p-3"></th></tr></thead>
          <tbody data-testid="returns-table">
            {list.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-medium">{r.returnNo || "—"}</td>
                <td className="p-3 text-slate-500">{r.invoiceNo || "—"}</td>
                <td className="p-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString("en-IN")}</td>
                <td className="p-3">{(r.items || []).map((i) => `${i.name} × ${i.qty}`).join(", ")}</td>
                <td className="p-3 text-right tabular-nums">{money(r.total)}</td>
                <td className="p-3 text-right"><button data-testid={`r-print-${r.returnNo}`} onClick={() => printReturnReceipt(r, settings)} className="icon-btn" title="Print return receipt"><Printer size={15} /></button></td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No returns yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
