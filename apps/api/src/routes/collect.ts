import { Hono } from "hono";
import type { AppEnv } from "../env";
import { collectBatchSchema, collectErrorSchema, collectPerfSchema, TRACKING_SNIPPET_VERSION } from "@vxqor/shared";
import { sha256Hex } from "../lib/crypto";
import { newId } from "../lib/ids";
import { log } from "../lib/log";
import { checkRateLimit } from "../lib/ratelimit";
import { recordSecurityEvent } from "../lib/security";
import { dayKey, nowIso } from "../lib/time";
import { classifyReferrer, parseBrowser, parseDevice } from "../lib/ua";
import { clientIp } from "../middleware/auth";

export const collectRoutes = new Hono<{ Bindings: AppEnv }>();

const SNIPPET_JS = `/* VXQOR tracker v${TRACKING_SNIPPET_VERSION} */
(function(){
  var s=document.currentScript;
  if(!s)return;
  var id=s.getAttribute('data-vxqor')||s.src.split('/snippet/')[1].replace('.js','');
  var api=s.getAttribute('data-api')||(s.src.split('/v1/')[0]+'/v1');
  var consent=s.getAttribute('data-consent');
  var deployment=s.getAttribute('data-deployment')||window.__VXQOR_DEPLOYMENT__||null;
  var sid;
  try{sid=sessionStorage.getItem('vxq_sid');if(!sid){sid=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);sessionStorage.setItem('vxq_sid',sid);}}catch(e){sid='nosession';}
  function screen(){var w=innerWidth;return w<640?'mobile':w<1024?'tablet':'desktop';}
  function bucket(){return Math.floor(Date.now()/300000);}
  function send(path,payload){
    try{
      var body=JSON.stringify(payload);
      if(navigator.sendBeacon){navigator.sendBeacon(api+'/collect/'+id+'/'+path,new Blob([body],{type:'application/json'}));}
      else{fetch(api+'/collect/'+id+'/'+path,{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true});}
    }catch(e){}
  }
  function allowed(){
    if(!consent)return true;
    try{return !!window[consent]&&!!window[consent]();}catch(e){return false;}
  }
  function pageview(){
    if(!allowed())return;
    send('analytics',{v:1,type:'pageview',path:location.pathname+location.search.slice(0,300),referrer:document.referrer||undefined,session:sid,screen:screen(),dedupe:sid+':'+location.pathname+':'+bucket()});
  }
  window.vxqor={track:function(name,data){if(!allowed())return;send('analytics',{v:1,type:'custom',name:String(name).slice(0,100),path:location.pathname,session:sid,screen:screen(),dedupe:sid+':'+name+':'+bucket()});}};
  var lastPath=location.pathname;
  function spaWatch(){var p=history.pushState;history.pushState=function(){p.apply(this,arguments);if(location.pathname!==lastPath){lastPath=location.pathname;pageview();}};addEventListener('popstate',function(){if(location.pathname!==lastPath){lastPath=location.pathname;pageview();}});}
  function vitals(){
    if(!allowed())return;
    var metrics=[];
    function flush(){if(metrics.length){send('perf',{v:1,metrics:metrics,deployment:deployment||undefined});metrics=[];}}
    try{
      new PerformanceObserver(function(l){for(var e of l.getEntries()){if(e.name==='largest-contentful-paint'||e.entryType==='largest-contentful-paint')metrics.push({metric:'lcp',value:e.startTime,path:location.pathname,deployment:deployment||undefined});}}).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(function(l){for(var e of l.getEntries()){metrics.push({metric:'cls',value:e.value,path:location.pathname,deployment:deployment||undefined});}}).observe({type:'layout-shift',buffered:true});
      new PerformanceObserver(function(l){for(var e of l.getEntries()){metrics.push({metric:'inp',value:e.duration,path:location.pathname,deployment:deployment||undefined});}}).observe({type:'event',buffered:true,durationThreshold:40});
      new PerformanceObserver(function(l){for(var e of l.getEntries()){if(e.entryType==='paint')metrics.push({metric:e.name==='first-contentful-paint'?'fcp':'ttfb',value:e.startTime,path:location.pathname,deployment:deployment||undefined});}}).observe({type:'paint',buffered:true});
      new PerformanceObserver(function(l){for(var e of l.getEntries()){metrics.push({metric:'ttfb',value:e.responseEnd,path:location.pathname,deployment:deployment||undefined});}}).observe({type:'navigation',buffered:true});
    }catch(e){}
    setInterval(flush,5000);
    addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
  }
  function errors(){
    addEventListener('error',function(ev){if(!allowed())return;send('error',{v:1,category:'uncaught',message:String(ev.message||'unknown').slice(0,2000),stack:ev.error&&ev.error.stack?String(ev.error.stack).slice(0,8000):undefined,path:location.pathname,release:deployment||undefined});});
    addEventListener('unhandledrejection',function(ev){if(!allowed())return;send('error',{v:1,category:'unhandledrejection',message:String(ev.reason&&ev.reason.message||ev.reason||'unhandled rejection').slice(0,2000),path:location.pathname,release:deployment||undefined});});
  }
  pageview();spaWatch();vitals();errors();
})();
`;

async function loadSite(db: D1Database, trackingId: string) {
  return db
    .prepare("SELECT s.id, s.disabled_at FROM sites s WHERE s.tracking_id = ?")
    .bind(trackingId)
    .first<{ id: string; disabled_at: string | null }>();
}

async function siteDomains(db: D1Database, siteId: string): Promise<string[]> {
  const rows = await db.prepare("SELECT domain FROM site_domains WHERE site_id = ?").bind(siteId).all<{ domain: string }>();
  return rows.results.map((r) => r.domain);
}

function originAllowed(origin: string | null, domains: string[]): boolean {
  if (!origin) return true; // non-browser clients; documented limitation
  try {
    const host = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
    return domains.some((d) => host === d || host.endsWith(`.${d}`)) || host === "localhost";
  } catch {
    return false;
  }
}

/** Privacy-conscious visitor fingerprint: truncated IP + UA + site + day. Never stores raw IP. */
async function visitorHash(ip: string | null, ua: string, siteId: string): Promise<string> {
  let truncated = "unknown";
  if (ip) {
    if (ip.includes(":")) truncated = ip.split(":").slice(0, 3).join(":") + "::/48";
    else truncated = ip.split(".").slice(0, 3).join(".") + ".0/24";
  }
  return (await sha256Hex(`${truncated}|${ua.slice(0, 200)}|${siteId}|${dayKey(nowIso())}`)).slice(0, 32);
}

collectRoutes.get("/snippet/*", async (c) => {
  const trackingId = (c.req.path.split("/snippet/")[1] ?? "").replace(/\.js$/, "");
  const site = await loadSite(c.env.DB, trackingId);
  if (!site) return c.text("// VXQOR: unknown tracking id", 404);
  c.header("content-type", "application/javascript; charset=utf-8");
  c.header("cache-control", "public, max-age=300");
  c.header("access-control-allow-origin", "*");
  c.header("x-content-type-options", "nosniff");
  return c.text(SNIPPET_JS);
});

collectRoutes.post("/collect/:trackingId/analytics", async (c) => {
  const trackingId = c.req.param("trackingId");
  const ip = clientIp(c);
  const site = await loadSite(c.env.DB, trackingId);
  if (!site || site.disabled_at) return c.json({ error: "unknown_site" }, 404);
  const limit = await checkRateLimit(c.env.DB, `collect:${trackingId}:${ip ?? "x"}`, 120, 60);
  if (!limit.allowed) {
    c.header("retry-after", String(limit.retryAfterSeconds));
    return c.json({ error: "rate_limited" }, 429);
  }
  const domains = await siteDomains(c.env.DB, site.id);
  const origin = c.req.header("origin") ?? null;
  if (!originAllowed(origin, domains)) {
    await recordSecurityEvent({ db: c.env.DB, kind: "ingestion_origin_rejected", severity: "warn", title: "Analytics ingestion from disallowed origin", detail: origin, siteId: site.id });
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = collectBatchSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid_payload", detail: parsed.error.issues[0]?.message }, 400);
  const ua = c.req.header("user-agent") ?? "";
  const vHash = await visitorHash(ip, ua, site.id);
  const country = (c.env as unknown as { cf?: { country?: string } }).cf?.country ?? null;
  let accepted = 0;
  let rejected = 0;
  for (const ev of parsed.data.events) {
    const ref = classifyReferrer(ev.referrer, domains);
    const dedupe = ev.dedupe ? (await sha256Hex(`${site.id}|${ev.dedupe}`)).slice(0, 40) : null;
    const sessionHash = (await sha256Hex(`${site.id}|${ev.session}`)).slice(0, 32);
    const res = await c.env.DB
      .prepare(
        "INSERT OR IGNORE INTO analytics_events (id, site_id, event_type, custom_name, session_hash, visitor_hash, path, referrer_category, referrer_domain, browser, device, country, dedupe_hash, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        newId("ae"),
        site.id,
        ev.type,
        ev.name ?? null,
        sessionHash,
        vHash,
        ev.path.slice(0, 2048),
        ref.category,
        ref.domain,
        parseBrowser(ua),
        ev.screen,
        country,
        dedupe,
        nowIso(),
      )
      .run();
    if ((res.meta.changes ?? 0) > 0) accepted += 1;
    else rejected += 1;
  }
  return c.json({ accepted, rejected });
});

collectRoutes.post("/collect/:trackingId/perf", async (c) => {
  const trackingId = c.req.param("trackingId");
  const ip = clientIp(c);
  const site = await loadSite(c.env.DB, trackingId);
  if (!site || site.disabled_at) return c.json({ error: "unknown_site" }, 404);
  const limit = await checkRateLimit(c.env.DB, `perf:${trackingId}:${ip ?? "x"}`, 60, 60);
  if (!limit.allowed) return c.json({ error: "rate_limited" }, 429);
  const raw = await c.req.json().catch(() => null);
  const parsed = collectPerfSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid_payload" }, 400);
  const ua = parsed.data.ua ?? c.req.header("user-agent") ?? "";
  let deploymentId: string | null = null;
  const deploymentLabel = parsed.data.metrics[0]?.deployment;
  if (deploymentLabel) {
    const dep = await c.env.DB.prepare("SELECT id FROM deployments WHERE provider_ref = ? OR commit_sha = ? LIMIT 1").bind(deploymentLabel, deploymentLabel).first<{ id: string }>();
    deploymentId = dep?.id ?? null;
  }
  for (const m of parsed.data.metrics) {
    await c.env.DB
      .prepare("INSERT INTO perf_events (id, site_id, metric, value, path, browser, device, deployment_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId("pe"), site.id, m.metric, m.value, m.path.slice(0, 2048), parseBrowser(ua), parseDevice(ua), deploymentId, nowIso())
      .run();
  }
  return c.json({ accepted: parsed.data.metrics.length });
});

collectRoutes.post("/collect/:trackingId/error", async (c) => {
  const trackingId = c.req.param("trackingId");
  const ip = clientIp(c);
  const site = await loadSite(c.env.DB, trackingId);
  if (!site || site.disabled_at) return c.json({ error: "unknown_site" }, 404);
  const limit = await checkRateLimit(c.env.DB, `err:${trackingId}:${ip ?? "x"}`, 30, 60);
  if (!limit.allowed) return c.json({ error: "rate_limited" }, 429);
  const raw = await c.req.json().catch(() => null);
  const parsed = collectErrorSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "invalid_payload" }, 400);
  const data = parsed.data;
  // Redact obvious secrets from messages/stacks before storage.
  const redact = (s: string) =>
    s
      .replace(/(authorization|cookie|set-cookie|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
  const message = redact(data.message).slice(0, 2000);
  const stack = data.stack ? redact(data.stack).slice(0, 8000) : null;
  const groupHash = (await sha256Hex(`${data.category}|${message.slice(0, 300)}|${data.path ?? ""}`)).slice(0, 40);
  const now = nowIso();
  const existing = await c.env.DB.prepare("SELECT id FROM error_events WHERE site_id = ? AND group_hash = ?").bind(site.id, groupHash).first<{ id: string }>();
  if (existing) {
    await c.env.DB.prepare("UPDATE error_events SET count = count + 1, last_seen_at = ?, stack = COALESCE(?, stack), correlation_id = COALESCE(?, correlation_id) WHERE id = ?").bind(now, stack, data.correlationId ?? null, existing.id).run();
  } else {
    await c.env.DB
      .prepare("INSERT INTO error_events (id, site_id, group_hash, category, message, stack, path, release_tag, correlation_id, first_seen_at, last_seen_at, count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open')")
      .bind(newId("err"), site.id, groupHash, data.category, message, stack, data.path ?? null, data.release ?? null, data.correlationId ?? null, now, now)
      .run();
  }
  return c.json({ accepted: 1 });
});

export const _collectLog = log;
