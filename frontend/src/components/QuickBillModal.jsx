import { useEffect, useMemo, useState } from "react";
import { X, Plus, Minus, Zap } from "lucide-react";
import { useApp, FALLBACK_UNITS } from "@/context/AppContext";
import { toast } from "sonner";

const uid = () => "QB-" + Math.random().toString(36).slice(2, 10).toUpperCase();

export default function QuickBillModal({ open, onClose, onAdd, prefillName = "" }) {
  const { units } = useApp();
  const unitList = units && units.length ? units : FALLBACK_UNITS;
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState(unitList[0] || "Piece");
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (open) {
      setName(prefillName || "");
      setPrice("");
      setUnit(unitList[0] || "Piece");
      setQty(1);
    }
  }, [open, prefillName]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => {
    const p = Number(price) || 0;
    const q = Number(qty) || 0;
    return Number.isFinite(p * q) ? p * q : 0;
  }, [price, qty]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault?.();
    const nm = String(name || "").trim();
    const p = Number(price);
    const q = Number(qty);
    if (!nm) return toast.error("Enter a product name");
    if (!Number.isFinite(p) || p < 0) return toast.error("Enter a valid price");
    if (!Number.isFinite(q) || q <= 0) return toast.error("Quantity must be greater than 0");
    onAdd({
      productId: uid(),
      quickBill: true,
      name: nm,
      code: "QB",
      unit,
      price: p,
      qty: q,
      purchasePrice: 0,
      stock: q, // display-only so cart controls don't complain
    });
    toast.success(`Added ${nm} to bill`);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3 sm:p-4" data-testid="quick-bill-modal">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 animate-[fadeIn_.15s_ease-out]">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Zap className="text-[#d4a437]" size={20} />
          <div>
            <div className="font-semibold tracking-tight">Quick Bill</div>
            <div className="text-[11px] text-slate-500">Sell a product without adding it to the catalog</div>
          </div>
          <button data-testid="quick-bill-close" onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500">Product Name *</label>
            <input
              data-testid="quick-bill-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Special Ring"
              className="inp py-3 mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Price ₹ *</label>
              <input
                data-testid="quick-bill-price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="inp py-3 mt-1 tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Unit</label>
              <select
                data-testid="quick-bill-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="inp py-3 mt-1"
              >
                {unitList.map((u) => (<option key={u} value={u}>{u}</option>))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Quantity</label>
            <div className="flex items-center gap-2 mt-1">
              <button type="button" data-testid="quick-bill-qty-minus" onClick={() => setQty((q) => Math.max(1, Number(q) - 1))} className="w-11 h-11 border border-slate-300 rounded-lg flex items-center justify-center hover:bg-slate-50"><Minus size={16} /></button>
              <input
                data-testid="quick-bill-qty"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="inp py-3 text-center tabular-nums flex-1"
              />
              <button type="button" data-testid="quick-bill-qty-plus" onClick={() => setQty((q) => Number(q) + 1)} className="w-11 h-11 border border-slate-300 rounded-lg flex items-center justify-center hover:bg-slate-50"><Plus size={16} /></button>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Item Total</span>
            <span className="text-lg font-bold tabular-nums" data-testid="quick-bill-total">
              ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <button
            type="submit"
            data-testid="quick-bill-add"
            className="w-full bg-[#d4a437] hover:bg-[#c1932c] text-[#101827] font-bold rounded-lg py-3.5 tracking-wide shadow-lg shadow-[#d4a437]/20 active:scale-[0.99] transition-all"
          >
            ADD TO BILL
          </button>
        </form>
      </div>
    </div>
  );
}
