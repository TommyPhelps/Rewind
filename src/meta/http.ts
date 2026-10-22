// The one doorway to the internet. All lookups go through a Transport (in the desktop
// app: the Rust `http_request` command, which only allows Steam and IGDB hosts).
// This file adds per-host pacing, retries with back-off, and plain-language errors.
// Nothing here runs unless you start an import, add a game, run a sync, or ask Discover to
// look beyond your library.

export type NetErrorKind = "offline" | "timeout" | "rate_limited" | "auth" | "not_found" | "blocked" | "server" | "bad_response" | "cancelled";

export class NetError extends Error {
  kind: NetErrorKind;
  status: number | null;
  constructor(kind: NetErrorKind, message: string, status: number | null = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: [string, string][];
  body?: string;
  timeoutMs?: number;
}
export interface HttpResponse {
  status: number;
  body: string;
  retryAfter?: string | null;
}
export interface ArtFile {
  file: string; // relative to the app data folder: "artwork/…"
  bytes: number;
}
export interface Transport {
  request(r: HttpRequest): Promise<HttpResponse>;
  download(url: string, name: string): Promise<ArtFile>;
}

/** Turns a transport-level failure ("offline: …" from Rust, TypeError from fetch) into a NetError. */
export function toNetError(e: unknown): NetError {
  if (e instanceof NetError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const m = /^(offline|timeout|blocked|network|bad_response): ?(.*)$/s.exec(msg);
  if (m) {
    const kind = m[1] === "network" ? "offline" : (m[1] as NetErrorKind);
    return new NetError(kind, friendly(kind, m[2]));
  }
  const http = /^http (\d{3})/.exec(msg);
  if (http) return statusError(Number(http[1]), "");
  if (/failed to fetch|networkerror|load failed|econnrefused|enotfound|getaddrinfo/i.test(msg)) return new NetError("offline", friendly("offline"));
  return new NetError("server", msg);
}

function friendly(kind: NetErrorKind, detail = ""): string {
  switch (kind) {
    case "offline":
      return "Couldn't reach the internet. Everything already saved still works; try again when you're online.";
    case "timeout":
      return "The server took too long to answer. Try again in a minute.";
    case "rate_limited":
      return "The service asked REWIND to slow down. It will wait and carry on.";
    case "auth":
      return "The service refused the request. Check the key or ID under Connections.";
    case "blocked":
      return `Request blocked: ${detail}`;
    case "bad_response":
      return "The service sent something REWIND didn't understand.";
    case "not_found":
      return "Not found.";
    case "cancelled":
      return "Cancelled.";
    default:
      return detail || "The service had a problem. Try again later.";
  }
}

export function statusError(status: number, host: string): NetError {
  if (status === 429 || (status === 403 && host === "store.steampowered.com")) return new NetError("rate_limited", friendly("rate_limited"), status);
  if (status === 401 || status === 403) return new NetError("auth", friendly("auth"), status);
  if (status === 404) return new NetError("not_found", friendly("not_found"), status);
  if (status >= 500) return new NetError("server", `The service had a problem (HTTP ${status}). Try again later.`, status);
  return new NetError("bad_response", `Unexpected answer (HTTP ${status}).`, status);
}

/** Minimum gap between requests to each host, chosen to stay well inside published or observed limits. */
const SPACING_MS: Record<string, number> = {
  "store.steampowered.com": 1600, // ~200 requests / 5 minutes
  "api.steampowered.com": 350,
  "api.igdb.com": 300, // IGDB allows 4 requests / second
  "id.twitch.tv": 1000,
};
const DEFAULT_SPACING = 120; // image CDNs

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new NetError("cancelled", friendly("cancelled")));
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new NetError("cancelled", friendly("cancelled")));
      }, { once: true });
    }),
};

export class Net {
  private next = new Map<string, number>();
  private transport: Transport;
  private clock: Clock;
  constructor(transport: Transport, clock: Clock = realClock) {
    this.transport = transport;
    this.clock = clock;
  }

  private async pace(host: string, signal?: AbortSignal) {
    const gap = SPACING_MS[host] ?? DEFAULT_SPACING;
    const now = this.clock.now();
    const at = Math.max(now, this.next.get(host) ?? 0);
    this.next.set(host, at + gap);
    if (at > now) await this.clock.sleep(at - now, signal);
  }

  /** Holds every request to a host back (after a rate-limit answer). */
  private pause(host: string, ms: number) {
    this.next.set(host, Math.max(this.next.get(host) ?? 0, this.clock.now() + ms));
  }

  async request(r: HttpRequest, opts: { signal?: AbortSignal; retries?: number } = {}): Promise<HttpResponse> {
    const host = hostOf(r.url);
    let attempt = 0;
    const max = opts.retries ?? 2;
    for (;;) {
      if (opts.signal?.aborted) throw new NetError("cancelled", friendly("cancelled"));
      await this.pace(host, opts.signal);
      let res: HttpResponse;
      try {
        res = await this.transport.request(r);
      } catch (e) {
        const err = toNetError(e);
        if (err.kind === "timeout" && attempt < max) {
          attempt++;
          await this.clock.sleep(2000 * attempt, opts.signal);
          continue;
        }
        throw err;
      }
      if (res.status >= 200 && res.status < 300) return res;
      const err = statusError(res.status, host);
      if ((err.kind === "rate_limited" || err.kind === "server") && attempt < max) {
        attempt++;
        const ra = Number(res.retryAfter);
        const wait = err.kind === "rate_limited" ? (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 30_000 * attempt) : 3000 * attempt;
        this.pause(host, Math.min(wait, 5 * 60_000));
        continue;
      }
      throw err;
    }
  }

  async json<T>(r: HttpRequest, opts: { signal?: AbortSignal; retries?: number } = {}): Promise<T> {
    const res = await this.request(r, opts);
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new NetError("bad_response", friendly("bad_response"), res.status);
    }
  }

  async download(url: string, name: string, signal?: AbortSignal): Promise<ArtFile> {
    if (signal?.aborted) throw new NetError("cancelled", friendly("cancelled"));
    await this.pace(hostOf(url), signal);
    try {
      return await this.transport.download(url, name);
    } catch (e) {
      throw toNetError(e);
    }
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}
