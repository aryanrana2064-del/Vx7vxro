export function parseBrowser(ua: string): string {
  const s = ua.toLowerCase();
  if (!s) return "unknown";
  if (s.includes("edg/") || s.includes("edga/") || s.includes("edgios/")) return "edge";
  if (s.includes("opr/") || s.includes("opera")) return "opera";
  if (s.includes("samsungbrowser")) return "samsung-internet";
  if (s.includes("chrome") || s.includes("crios")) return "chrome";
  if (s.includes("firefox") || s.includes("fxios")) return "firefox";
  if (s.includes("safari")) return "safari";
  if (s.includes("bot") || s.includes("crawl") || s.includes("spider")) return "bot";
  return "other";
}

export function parseDevice(ua: string): "mobile" | "tablet" | "desktop" | "unknown" {
  const s = ua.toLowerCase();
  if (!s) return "unknown";
  if (s.includes("ipad") || (s.includes("android") && !s.includes("mobile"))) return "tablet";
  if (s.includes("mobile") || s.includes("iphone") || s.includes("android")) return "mobile";
  if (s.includes("windows") || s.includes("macintosh") || s.includes("linux") || s.includes("cros")) return "desktop";
  return "unknown";
}

const SEARCH_DOMAINS = ["google.", "bing.com", "duckduckgo.com", "search.yahoo", "baidu.com", "startpage.com", "ecosia.org"];
const SOCIAL_DOMAINS = [
  "facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "reddit.com",
  "tiktok.com", "youtube.com", "pinterest.com", "mastodon", "threads.net",
];

export interface ReferrerInfo {
  category: "direct" | "search" | "social" | "email" | "internal" | "other";
  domain: string | null;
}

export function classifyReferrer(referrer: string | undefined, siteDomains: string[]): ReferrerInfo {
  if (!referrer) return { category: "direct", domain: null };
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return { category: "direct", domain: null };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (siteDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { category: "internal", domain: host };
  }
  if (SEARCH_DOMAINS.some((d) => host === d.replace(/\.$/, "") || host.includes(d))) {
    return { category: "search", domain: host };
  }
  if (SOCIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return { category: "social", domain: host };
  const path = url.pathname + url.search;
  if (/(^|[?&/])(utm_source|ref|source)=([^&]*mail|newsletter)/i.test(path)) {
    return { category: "email", domain: host };
  }
  return { category: "other", domain: host };
}
