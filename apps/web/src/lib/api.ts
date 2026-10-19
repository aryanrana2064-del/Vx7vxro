export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
  ) {
    super(typeof payload === "object" && payload && "error" in payload ? String((payload as { error: unknown }).error) : `HTTP ${status}`);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    credentials: "include",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, { error: res.status });
    return (await res.blob()) as T;
  }
  const text = await res.text();
  const payload = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const apiGet = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const apiPost = <T,>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const apiPatch = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const apiPut = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const apiDelete = <T,>(path: string) => api<T>(path, { method: "DELETE" });
