import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { api, apiError } from "@/lib/api";
import { toast } from "sonner";
import { Boxes, Loader2, ArrowLeft } from "lucide-react";

const FALLBACK_TYPES = ["General Retail", "Jewellery", "Garments & Fashion", "Footwear", "Grocery", "Electronics & Mobile", "Cosmetics", "Hardware", "Stationery & Books", "Gift & Lifestyle", "Other"];

export default function Login() {
  const { login, signupShop, forgotPassword, resetPassword } = useApp();
  const [tab, setTab] = useState("login");
  const [types, setTypes] = useState(FALLBACK_TYPES);
  const [f, setF] = useState({ email: "", password: "", businessName: "", businessType: "General Retail", ownerName: "", phone: "", address: "", gstin: "", securityHint: "", securityAnswer: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // forgot-password flow
  const [forgot, setForgot] = useState(null); // null | "email" | "reset"
  const [fp, setFp] = useState({ email: "", hint: "", answer: "", newPassword: "" });
  const setFpv = (k) => (e) => setFp({ ...fp, [k]: e.target.value });

  useEffect(() => { api.get("/templates").then((t) => t?.businessTypes && setTypes(t.businessTypes)).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      if (tab === "login") {
        const res = await login(f.email, f.password);
        nav(res.admin ? "/admin" : "/dashboard");
      } else {
        if (!f.securityHint.trim() || !f.securityAnswer.trim()) throw { response: { data: { detail: "Set a security hint and answer so you can recover your password later." } } };
        const data = await signupShop({
          businessName: f.businessName, businessType: f.businessType, ownerName: f.ownerName,
          email: f.email, password: f.password, phone: f.phone, address: f.address, gstin: f.gstin,
          securityHint: f.securityHint, securityAnswer: f.securityAnswer,
        });
        setNewKey(data.licenseKey);
        setTimeout(() => nav("/dashboard"), 1500);
      }
    } catch (e2) { setErr(apiError(e2)); } finally { setBusy(false); }
  };

  const lookupHint = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await forgotPassword(fp.email.trim());
      setFp({ ...fp, hint: r.hint || "(no hint text set)" });
      setForgot("reset");
    } catch (e2) { setErr(apiError(e2)); } finally { setBusy(false); }
  };

  const doReset = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await resetPassword(fp.email.trim(), fp.answer, fp.newPassword);
      setForgot(null);
      setTab("login");
      setF({ ...f, email: fp.email.trim(), password: "" });
      setErr(""); setFp({ email: "", hint: "", answer: "", newPassword: "" });
      toast.success("Password reset successful. Please sign in with your new password.");
    } catch (e2) { setErr(apiError(e2)); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#070c17] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-[#d4a437]/15 blur-3xl" />
      <div className="absolute -bottom-40 -right-24 w-[520px] h-[520px] rounded-full bg-blue-500/20 blur-3xl" />
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      <div className="w-full max-w-md bg-white/95 backdrop-blur-xl rounded-3xl p-8 shadow-[0_25px_80px_-20px_rgba(0,0,0,0.5)] relative border border-white/60 rise">
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#d4a437] to-[#f5c04a] flex items-center justify-center shadow-lg shadow-[#d4a437]/30">
            <Boxes className="text-[#0b1120]" size={20} strokeWidth={2.4} />
          </div>
          <div>
            <h1 className="font-brand text-2xl font-bold tracking-tight">VYRO VX7</h1>
            <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-semibold">Smart Business POS</div>
          </div>
        </div>

        {forgot ? (
          <div className="mt-4">
            <button onClick={() => { setForgot(null); setErr(""); }} className="text-xs text-slate-500 flex items-center gap-1 mb-3"><ArrowLeft size={13} /> Back to sign in</button>
            <h2 className="text-base font-semibold">Recover your password</h2>
            {forgot === "email" ? (
              <form onSubmit={lookupHint} className="space-y-3 mt-3">
                <p className="text-sm text-slate-500">Enter your account email — we'll show your security hint.</p>
                <input data-testid="fp-email" required type="email" value={fp.email} onChange={setFpv("email")} placeholder="Account email" className="inp py-3" />
                {err && <div data-testid="fp-error" className="text-sm text-rose-600">{err}</div>}
                <button data-testid="fp-lookup" disabled={busy} className="w-full btn-gold justify-center py-3">{busy && <Loader2 size={16} className="animate-spin" />} Show my hint</button>
              </form>
            ) : (
              <form onSubmit={doReset} className="space-y-3 mt-3">
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-amber-700">Your security hint</div>
                  <div data-testid="fp-hint" className="text-amber-900 font-medium mt-0.5">{fp.hint}</div>
                </div>
                <input data-testid="fp-answer" required value={fp.answer} onChange={setFpv("answer")} placeholder="Your security answer" className="inp py-3" />
                <input data-testid="fp-newpass" required type="password" value={fp.newPassword} onChange={setFpv("newPassword")} placeholder="New password (min 6 chars)" className="inp py-3" />
                {err && <div data-testid="fp-error" className="text-sm text-rose-600">{err}</div>}
                <button data-testid="fp-reset" disabled={busy} className="w-full btn-gold justify-center py-3">{busy && <Loader2 size={16} className="animate-spin" />} Reset Password</button>
              </form>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed mt-2">Billing, stock &amp; business management — built for every shop.</p>
            <div className="flex gap-1 mb-5 bg-slate-100 rounded-xl p-1">
              {[["login", "Sign In"], ["signup", "Create Shop Account"]].map(([k, l]) => (
                <button key={k} data-testid={`tab-${k}`} onClick={() => { setTab(k); setErr(""); }}
                  className={`flex-1 text-sm py-2.5 rounded-lg transition-all ${tab === k ? "bg-white shadow-sm font-semibold text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
              ))}
            </div>

            {newKey ? (
              <div className="text-center py-6" data-testid="signup-success">
                <p className="text-sm text-slate-600">Shop created! Your 14-day trial license key:</p>
                <p className="font-mono text-lg font-bold mt-2">{newKey}</p>
                <p className="text-xs text-slate-500 mt-3">Opening your dashboard…</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                {tab === "signup" && (
                  <>
                    <input data-testid="s-business" required value={f.businessName} onChange={set("businessName")} placeholder="Shop / Business name *" className="inp py-3" />
                    <label className="block">
                      <span className="text-xs text-slate-500">Select Your Business Type</span>
                      <select data-testid="s-business-type" value={f.businessType} onChange={set("businessType")} className="inp py-3 mt-1">
                        {types.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </label>
                    <input data-testid="s-owner" required value={f.ownerName} onChange={set("ownerName")} placeholder="Owner name *" className="inp py-3" />
                    <div className="grid grid-cols-2 gap-3">
                      <input data-testid="s-phone" value={f.phone} onChange={set("phone")} placeholder="Phone" className="inp py-3" />
                      <input data-testid="s-gstin" value={f.gstin} onChange={set("gstin")} placeholder="GSTIN" className="inp py-3" />
                    </div>
                    <input data-testid="s-address" value={f.address} onChange={set("address")} placeholder="Shop address" className="inp py-3" />
                  </>
                )}
                <input data-testid="login-email" required type="email" value={f.email} onChange={set("email")} placeholder="Email *" className="inp py-3" />
                <input data-testid="login-password" required type="password" value={f.password} onChange={set("password")} placeholder={tab === "signup" ? "Create password (min 6 chars) *" : "Password *"} className="inp py-3" />
                {tab === "signup" && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Password recovery</div>
                    <input data-testid="s-hint" required value={f.securityHint} onChange={set("securityHint")} placeholder="Security hint / question (e.g. First school?) *" className="inp py-2.5" />
                    <input data-testid="s-answer" required value={f.securityAnswer} onChange={set("securityAnswer")} placeholder="Security answer *" className="inp py-2.5" />
                    <p className="text-[11px] text-slate-400">You'll use this to recover your password later — works fully offline.</p>
                  </div>
                )}
                {err && <div data-testid="login-error" className="text-sm text-rose-600">{err}</div>}
                <button data-testid={tab === "login" ? "login-submit" : "signup-submit"} disabled={busy}
                  className="w-full bg-gradient-to-r from-[#d4a437] via-[#e8b747] to-[#d4a437] hover:brightness-105 text-[#101827] font-bold rounded-xl py-3.5 flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-[#d4a437]/30 transition-all">
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {tab === "login" ? "Sign In" : "Create Shop & Start Trial"}
                </button>
                {tab === "login" && (
                  <button type="button" data-testid="forgot-password" onClick={() => { setForgot("email"); setErr(""); setFp({ email: f.email, hint: "", answer: "", newPassword: "" }); }} className="w-full text-center text-sm text-slate-500 hover:text-slate-700 pt-1">
                    Forgot password?
                  </button>
                )}
              </form>
            )}

            <p className="text-xs text-slate-400 mt-5">
              Shop owners: create one account, then add your staff under <b>Users</b>. Platform admin? Sign in with your admin email — you'll land on{" "}
              <Link to="/admin" className="underline">/admin</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
