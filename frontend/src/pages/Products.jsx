import { useEffect, useMemo, useState } from "react";
import { all, put, remove } from "@/lib/db";
import { money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { barcodeSvgMarkup, generateCode128Value } from "@/lib/print";
import { exportProducts } from "@/lib/csv";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Download, QrCode, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

const blank = (category, unit) => ({
  code: "", name: "", brand: "", category: category || "General",
  subcategory: "", photo: "", purchasePrice: 0, price: 0, mrp: 0, discount: 0, stock: 0, minStock: 5,
  maxStock: 0, unit: unit || "Piece", supplier: "", barcode: "", location: "",
  gst: 0, notes: "", description: "", variants: [], custom: {},
});

export default function Products() {
  const { can, refresh, template, units, settings, saveSettings } = useApp();
  const [items, setItems] = useState([]);
  const [term, setTerm] = useState("");
  const [cat, setCat] = useState("All");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const [calcQty, setCalcQty] = useState(1);
  const nav = useNavigate();
  const editable = can("products") || can("*");

  const categories = useMemo(
    () => [...new Set([...(Object.keys(template.categories || {})), ...items.map((i) => i.category).filter(Boolean)])],
    [template, items]
  );
  const brands = useMemo(() => [...new Set(items.map((i) => i.brand).filter(Boolean))], [items]);

  const load = async () => {
    try { setItems(await all("products")); } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    return items.filter(
      (p) =>
        (cat === "All" || p.category === cat) &&
        (!t || p.name.toLowerCase().includes(t) || String(p.code).toLowerCase().includes(t) ||
          String(p.barcode).includes(t) || String(p.brand || "").toLowerCase().includes(t))
    );
  }, [items, term, cat]);

  const perPage = 12;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const view = filtered.slice((page - 1) * perPage, page * perPage);

  const persistUnit = async (u) => {
    const cu = settings?.customUnits || [];
    if (!u || units.includes(u) || cu.includes(u)) return;
    try { await saveSettings({ ...settings, customUnits: [...cu, u] }); } catch { /* offline ok */ }
  };

  const save = async (e) => {
    e.preventDefault();
    const f = form;
    if (!f.code.trim() || !f.name.trim()) return toast.error("Product code and name are required");
    try {
      await put("products", {
        ...f,
        code: f.code.trim().toUpperCase(),
        purchasePrice: Number(f.purchasePrice) || 0,
        price: Number(f.price) || 0,
        stock: Number(f.stock) || 0,
        minStock: Number(f.minStock) || 0,
        maxStock: Number(f.maxStock) || 0,
        gst: Number(f.gst) || 0,
      });
      setForm(null);
      await load();
      refresh();
      toast.success("Product saved");
    } catch (e2) { toast.error(apiError(e2)); }
  };

  const del = async (p) => {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    try {
      await remove("products", p.id);
      await load();
      refresh();
      toast.success("Product deleted");
    } catch (e) { toast.error(apiError(e)); }
  };

  const openNew = () => {
    setForm({ ...blank(categories[0], template.defaultUnit || units[0]), barcode: generateCode128Value() });
    setCalcQty(1);
  };

  const calcTotal = (Number(calcQty) || 0) * (Number(form?.price) || 0);

  return (
    <div className="space-y-4" data-testid="products-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-slate-500">{items.length} products · {filtered.length} shown</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button data-testid="export-products-btn" onClick={exportProducts} className="btn-ghost"><Download size={15} /> Export CSV</button>
          <button data-testid="goto-quick-stock-btn" onClick={() => nav("/quick-stock")} className="btn-ghost">Quick Stock</button>
          <button data-testid="goto-import-btn" onClick={() => nav("/import-export")} className="btn-ghost">Import Stock</button>
          {editable && <button data-testid="add-product-btn" onClick={openNew} className="btn-gold"><Plus size={15} /> Add Product</button>}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input data-testid="product-search" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} placeholder="Search name / code / brand / barcode" className="flex-1 min-w-[200px] inp" />
        <select data-testid="category-filter" value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }} className="inp w-auto">
          {["All", ...categories].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th">
            <tr>
              <th className="text-left p-3">Code</th><th className="text-left p-3">Product</th>
              <th className="text-left p-3 hidden md:table-cell">Category</th>
              <th className="text-right p-3 hidden sm:table-cell">Cost</th>
              <th className="text-right p-3">Price</th><th className="text-right p-3">Stock</th>
              <th className="text-left p-3 hidden lg:table-cell">Barcode</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody data-testid="products-table">
            {view.map((p) => (
              <tr key={p.id} data-testid={`product-row-${p.code}`} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="p-3 font-mono text-xs">{p.code}</td>
                <td className="p-3 font-medium">
                  {p.name}
                  {p.brand && <span className="text-slate-400 font-normal"> · {p.brand}</span>}
                </td>
                <td className="p-3 hidden md:table-cell text-slate-500">{p.category}</td>
                <td className="p-3 text-right tabular-nums hidden sm:table-cell">{money(p.purchasePrice)}</td>
                <td className="p-3 text-right tabular-nums">{money(p.price)}</td>
                <td className={`p-3 text-right tabular-nums font-semibold ${p.stock <= p.minStock ? "text-rose-600" : ""}`}>{p.stock} <span className="text-[10px] font-normal text-slate-400">{p.unit}</span></td>
                <td className="p-3 hidden lg:table-cell"><span className="font-mono text-[11px] text-slate-500">{p.barcode}</span></td>
                <td className="p-3 text-right whitespace-nowrap">
                  {editable && <button data-testid={`edit-${p.code}`} onClick={() => { setForm({ ...blank(categories[0], units[0]), ...p, variants: p.variants || [], custom: p.custom || {} }); setCalcQty(1); }} className="icon-btn"><Pencil size={15} /></button>}
                  {editable && <button data-testid={`delete-${p.code}`} onClick={() => del(p)} className="icon-btn text-rose-600"><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
            {!view.length && <tr><td colSpan={8} className="p-8 text-center text-slate-400">No products found</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex justify-center gap-2">
          <button data-testid="prev-page" disabled={page === 1} onClick={() => setPage(page - 1)} className="btn-ghost disabled:opacity-40">Prev</button>
          <span className="text-sm py-2.5">Page {page} / {pages}</span>
          <button data-testid="next-page" disabled={page === pages} onClick={() => setPage(page + 1)} className="btn-ghost disabled:opacity-40">Next</button>
        </div>
      )}

      {form && (
        <div className="modal-bg">
          <form onSubmit={save} data-testid="product-form" className="modal max-w-2xl space-y-4">
            <h3 className="font-display text-lg font-semibold">{form.id ? "Edit" : "New"} Product</h3>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Product Name *"><input data-testid="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="inp" /></Field>
              <Field label="Product Code / SKU *"><input data-testid="p-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="inp" /></Field>

              <ComboAdd label="Brand" testid="p-brand" value={form.brand} options={brands} onChange={(v) => setForm({ ...form, brand: v })} />
              <ComboAdd label="Category" testid="p-category" value={form.category} options={categories} onChange={(v) => setForm({ ...form, category: v })} />
              <ComboAdd label="Unit" testid="p-unit" value={form.unit} options={units} onChange={(v) => setForm({ ...form, unit: v })} onAddPersist={persistUnit} />
              <Field label="Supplier"><input data-testid="p-supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="inp" /></Field>

              <Field label="Purchase Price"><input data-testid="p-purchase" type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} className="inp" /></Field>
              <Field label="Selling Price"><input data-testid="p-price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="inp" /></Field>
              <Field label="Tax / GST %"><input data-testid="p-gst" type="number" value={form.gst} onChange={(e) => setForm({ ...form, gst: e.target.value })} className="inp" /></Field>
              <div />

              <Field label="Minimum Stock"><input data-testid="p-minstock" type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} className="inp" /></Field>
              <Field label="Maximum Stock"><input data-testid="p-maxstock" type="number" value={form.maxStock} onChange={(e) => setForm({ ...form, maxStock: e.target.value })} className="inp" /></Field>

              <Field label="Barcode">
                <div className="flex gap-2">
                  <input data-testid="p-barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="inp" />
                  <button type="button" data-testid="generate-barcode" onClick={() => setForm({ ...form, barcode: generateCode128Value() })} className="border rounded-lg px-2 text-xs flex items-center gap-1 whitespace-nowrap"><QrCode size={14} /> Gen</button>
                </div>
              </Field>
              <Field label="Description"><input data-testid="p-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="inp" /></Field>
            </div>

            {form.id && (
              <p className="text-xs text-slate-500">Current stock: <b className="tabular-nums">{form.stock} {form.unit}</b> · change stock from <button type="button" onClick={() => { setForm(null); nav("/quick-stock"); }} className="text-[#b8892b] underline font-medium">Quick Stock Update</button></p>
            )}

            {form.barcode && <div className="border rounded-lg p-2 flex justify-center" dangerouslySetInnerHTML={{ __html: barcodeSvgMarkup(form.barcode) }} />}

            {/* Live Qty × Price = Total calculator */}
            <div data-testid="qty-price-total" className="rounded-2xl p-4 bg-gradient-to-br from-[#0b1120] via-[#101827] to-[#1c2740] text-white flex items-center justify-between gap-4 flex-wrap shadow-lg shadow-slate-900/20">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-semibold">Quantity</div>
                  <input data-testid="calc-qty" type="number" min="0" value={calcQty} onChange={(e) => setCalcQty(e.target.value)}
                    className="w-20 mt-1 bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-center text-xl font-bold tabular-nums text-white outline-none focus:border-[#d4a437]" />
                </div>
                <div className="text-slate-500 text-lg font-light pt-4">×</div>
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-semibold">Price / {form.unit || "Piece"}</div>
                  <div data-testid="calc-price" className="mt-1 py-1.5 text-xl font-bold tabular-nums text-white">{money(Number(form.price) || 0)}</div>
                </div>
                <div className="text-slate-500 text-lg font-light pt-4">=</div>
              </div>
              <div data-testid="calc-total-badge" className="w-24 h-24 rounded-full bg-gradient-to-br from-[#d4a437] to-[#f5c04a] flex flex-col items-center justify-center shadow-xl shadow-[#d4a437]/30 shrink-0">
                <div className="text-[9px] uppercase tracking-[0.12em] text-[#101827]/70 font-bold">Total</div>
                <div data-testid="calc-total" className="text-[#101827] font-bold tabular-nums text-lg leading-tight">{money(calcTotal)}</div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" data-testid="cancel-product" onClick={() => setForm(null)} className="btn-ghost">Cancel</button>
              <button data-testid="save-product" className="btn-gold">Save Product</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-xs text-slate-500">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

const ComboAdd = ({ label, value, options, onChange, onAddPersist, testid }) => {
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState("");
  const confirm = () => {
    const v = nv.trim();
    if (v) { onChange(v); onAddPersist?.(v); }
    setAdding(false); setNv("");
  };
  return (
    <Field label={label}>
      {adding ? (
        <div className="flex gap-1.5">
          <input data-testid={`${testid}-new`} autoFocus value={nv} onChange={(e) => setNv(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
            placeholder={`New ${label.toLowerCase()}…`} className="inp" />
          <button type="button" data-testid={`${testid}-confirm`} onClick={confirm} className="btn-gold px-2.5"><Check size={15} /></button>
          <button type="button" onClick={() => { setAdding(false); setNv(""); }} className="btn-ghost px-2.5"><X size={15} /></button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} className="inp">
            {value && !options.includes(value) && <option value={value}>{value}</option>}
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button type="button" data-testid={`${testid}-add-new`} onClick={() => setAdding(true)} className="btn-ghost px-2.5 whitespace-nowrap"><Plus size={14} /></button>
        </div>
      )}
    </Field>
  );
};
