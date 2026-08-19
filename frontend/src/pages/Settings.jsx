import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { apiError } from "@/lib/api";
import { KeyRound } from "lucide-react";

export default function Settings() {
  const { settings, saveSettings, meta, changePassword } = useApp();
  const [f, setF] = useState(settings || {});
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    try {
      await saveSettings({
        ...f,
        defaultTax: Number(f.defaultTax) || 0,
        minStock: Number(f.minStock) || 0,
        customUnits: f.customUnits || [],
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Could not save settings. Please check your connection.");
    }
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setF({ ...f, logo: r.result });
    r.readAsDataURL(file);
  };
  const onLogoAlt = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setF({ ...f, logoAlt: r.result });
    r.readAsDataURL(file);
  };

  const doChangePassword = async (e) => {
    e.preventDefault();
    if (pw.newPassword.length < 6) return toast.error("New password must be at least 6 characters");
    if (pw.newPassword !== pw.confirm) return toast.error("New password and confirmation do not match");
    setPwBusy(true);
    try {
      await changePassword(pw.currentPassword, pw.newPassword);
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      toast.success("Password changed successfully");
    } catch (e2) { toast.error(apiError(e2)); } finally { setPwBusy(false); }
  };

  const Section = ({ title, children }) => (
    <div className="card p-4 space-y-3">
      <h3 className="font-semibold text-sm uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
  const F = ({ label, children }) => (
    <label className="block"><span className="text-xs text-slate-500">{label}</span><div className="mt-1">{children}</div></label>
  );

  return (
    <div className="space-y-4 max-w-3xl" data-testid="settings-page">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>

      <form onSubmit={save} className="space-y-4">
        <Section title="Business">
          <F label="Business Name"><input data-testid="set-business" value={f.businessName || ""} onChange={(e) => setF({ ...f, businessName: e.target.value })} className="inp" /></F>
          <F label="Business Type">
            <select data-testid="set-business-type" value={f.businessType || "General Retail"} onChange={(e) => setF({ ...f, businessType: e.target.value })} className="inp">
              {(meta?.businessTypes || ["General Retail"]).map((t) => <option key={t}>{t}</option>)}
            </select>
          </F>
          <F label="Phone"><input data-testid="set-phone" value={f.phone || ""} onChange={(e) => setF({ ...f, phone: e.target.value })} className="inp" /></F>
          <F label="Address"><input data-testid="set-address" value={f.address || ""} onChange={(e) => setF({ ...f, address: e.target.value })} className="inp" /></F>
          <F label="GSTIN"><input data-testid="set-gst" value={f.gstin || ""} onChange={(e) => setF({ ...f, gstin: e.target.value })} className="inp" /></F>
          <div />
          <F label="Primary Logo (header, invoices)">
            <input data-testid="set-logo" type="file" accept="image/*" onChange={onLogo} className="text-sm" />
            {f.logo && <img src={f.logo} alt="logo" className="h-12 object-contain mt-2 rounded bg-white/50 border p-1" />}
          </F>
          <F label="Alternate / Watermark Logo (receipts)">
            <input data-testid="set-logo-alt" type="file" accept="image/*" onChange={onLogoAlt} className="text-sm" />
            {f.logoAlt && <img src={f.logoAlt} alt="alt logo" className="h-12 object-contain mt-2 rounded bg-white/50 border p-1" />}
          </F>
        </Section>

        <Section title="Billing">
          <F label="Invoice Prefix"><input data-testid="set-prefix" value={f.invoicePrefix || ""} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value })} className="inp" /></F>
          <F label="Default Tax %"><input data-testid="set-tax" type="number" value={f.defaultTax ?? 0} onChange={(e) => setF({ ...f, defaultTax: e.target.value })} className="inp" /></F>
          <F label="Default Payment Mode">
            <select data-testid="set-payment" value={f.defaultPayment || "Cash"} onChange={(e) => setF({ ...f, defaultPayment: e.target.value })} className="inp">
              {["Cash", "UPI", "Card", "Bank Transfer", "Credit", "Other"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </F>
          <F label="Auto Print after bill">
            <label className="flex items-center gap-2 text-sm mt-2"><input data-testid="set-autoprint" type="checkbox" checked={!!f.autoPrint} onChange={(e) => setF({ ...f, autoPrint: e.target.checked })} /> {f.autoPrint ? "ON" : "OFF"}</label>
          </F>
          <F label="Receipt Width">
            <select data-testid="set-receipt" value={f.receiptWidth || "80mm"} onChange={(e) => setF({ ...f, receiptWidth: e.target.value })} className="inp">
              <option value="58mm">58mm Thermal</option><option value="80mm">80mm Thermal</option>
            </select>
          </F>
        </Section>

        <Section title="Inventory">
          <F label="Default Minimum Stock"><input data-testid="set-minstock" type="number" value={f.minStock ?? 5} onChange={(e) => setF({ ...f, minStock: e.target.value })} className="inp" /></F>
          <F label="Allow Negative Stock">
            <label className="flex items-center gap-2 text-sm mt-2"><input data-testid="set-negative" type="checkbox" checked={!!f.allowNegativeStock} onChange={(e) => setF({ ...f, allowNegativeStock: e.target.checked })} /> {f.allowNegativeStock ? "Allowed" : "Blocked"}</label>
          </F>
        </Section>

        <Section title="Units">
          <F label="Custom Units (comma separated)">
            <input data-testid="set-custom-units" value={(f.customUnits || []).join(", ")}
              onChange={(e) => setF({ ...f, customUnits: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              placeholder="e.g. Tola, Roll, Bundle" className="inp" />
          </F>
          <F label="Standard Units"><input value={(meta?.units || []).join(", ")} readOnly className="inp bg-slate-50" /></F>
        </Section>

        <button data-testid="save-settings" className="btn-gold px-6 py-3">Save Settings</button>
      </form>

      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-slate-500 flex items-center gap-2"><KeyRound size={15} /> Change Password</h3>
        <form onSubmit={doChangePassword} className="grid sm:grid-cols-3 gap-3 items-end" data-testid="change-password-form">
          <F label="Current Password"><input data-testid="cp-current" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className="inp" /></F>
          <F label="New Password"><input data-testid="cp-new" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className="inp" /></F>
          <F label="Confirm New Password"><input data-testid="cp-confirm" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className="inp" /></F>
          <button data-testid="cp-submit" disabled={pwBusy} className="btn-dark sm:col-span-3 justify-center">{pwBusy ? "Updating…" : "Update Password"}</button>
        </form>
      </div>

      <p className="text-xs text-slate-500">Backup &amp; Restore is available in <b>Import / Export</b>. User permissions in <b>Users</b>. License details in <b>License</b>.</p>
    </div>
  );
}
