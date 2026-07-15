export type MetricKey =
  | "http.requests.total"
  | "http.responses.2xx"
  | "http.responses.3xx"
  | "http.responses.4xx"
  | "http.responses.5xx"
  | "auth.register.ok"
  | "auth.register.conflict"
  | "auth.login.ok"
  | "auth.login.fail"
  | "auth.refresh.ok"
  | "auth.refresh.fail"
  | "auth.logout.ok"
  | "auth.logout.fail"
  | "auth.logoutAll.ok";

const counters = new Map<MetricKey, number>();

export function inc(key: MetricKey, by = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function snapshotCounters(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of counters) out[k] = v;
  return out;
}

type RouteKey = `${string} ${string}`; // "METHOD /path/:id"
type StatusClass = "2xx" | "3xx" | "4xx" | "5xx";

type LatencyAgg = {
  count: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  /** muestra acotada para percentiles aproximados */
  sampleMs: number[];
};

const MAX_SAMPLES_PER_ROUTE = 500;
const routes = new Map<RouteKey, { requests: number; status: Record<StatusClass, number>; latency: LatencyAgg }>();

function statusClass(code: number): StatusClass {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  return "5xx";
}

function pushSample(arr: number[], v: number): void {
  if (arr.length < MAX_SAMPLES_PER_ROUTE) {
    arr.push(v);
    return;
  }
  // Reservoir sampling (muy simple): reemplazo aleatorio
  const i = Math.floor(Math.random() * (arr.length + 1));
  if (i < arr.length) arr[i] = v;
}

export function observeRouteRequest(opts: { method: string; route: string }): void {
  const key = `${opts.method.toUpperCase()} ${opts.route}` as RouteKey;
  const existing = routes.get(key);
  if (existing) {
    existing.requests += 1;
    return;
  }
  routes.set(key, {
    requests: 1,
    status: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
    latency: { count: 0, sumMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0, sampleMs: [] },
  });
}

export function observeRouteResponse(opts: { method: string; route: string; statusCode: number; durationMs: number }): void {
  const key = `${opts.method.toUpperCase()} ${opts.route}` as RouteKey;
  let r = routes.get(key);
  if (!r) {
    observeRouteRequest({ method: opts.method, route: opts.route });
    r = routes.get(key)!;
  }
  r.status[statusClass(opts.statusCode)] += 1;
  const d = Math.max(0, Math.round(opts.durationMs));
  const lat = r.latency;
  lat.count += 1;
  lat.sumMs += d;
  lat.minMs = Math.min(lat.minMs, d);
  lat.maxMs = Math.max(lat.maxMs, d);
  pushSample(lat.sampleMs, d);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((p / 100) * (sortedAsc.length - 1))));
  return sortedAsc[idx] ?? 0;
}

export function snapshotRoutes(): Array<{
  key: string;
  requests: number;
  status: Record<StatusClass, number>;
  latencyMs: { count: number; avg: number; min: number; p50: number; p95: number; max: number };
}> {
  const out: Array<{
    key: string;
    requests: number;
    status: Record<StatusClass, number>;
    latencyMs: { count: number; avg: number; min: number; p50: number; p95: number; max: number };
  }> = [];

  for (const [key, r] of routes) {
    const sample = [...r.latency.sampleMs].sort((a, b) => a - b);
    const avg = r.latency.count > 0 ? r.latency.sumMs / r.latency.count : 0;
    out.push({
      key,
      requests: r.requests,
      status: { ...r.status },
      latencyMs: {
        count: r.latency.count,
        avg: Number(avg.toFixed(2)),
        min: Number.isFinite(r.latency.minMs) ? r.latency.minMs : 0,
        p50: percentile(sample, 50),
        p95: percentile(sample, 95),
        max: r.latency.maxMs,
      },
    });
  }

  out.sort((a, b) => b.requests - a.requests);
  return out;
}

function promEscapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

export function snapshotPrometheusText(): string {
  const lines: string[] = [];

  lines.push("# HELP radioflow_uptime_seconds Process uptime (seconds).");
  lines.push("# TYPE radioflow_uptime_seconds gauge");
  lines.push(`radioflow_uptime_seconds ${Math.floor(process.uptime())}`);

  lines.push("# HELP radioflow_counter Total counters (in-memory).");
  lines.push("# TYPE radioflow_counter counter");
  for (const [k, v] of counters) {
    lines.push(`radioflow_counter{key="${promEscapeLabelValue(k)}"} ${v}`);
  }

  lines.push("# HELP radioflow_http_route_requests_total HTTP requests per method+route.");
  lines.push("# TYPE radioflow_http_route_requests_total counter");
  lines.push("# HELP radioflow_http_route_responses_total HTTP responses per method+route+status_class.");
  lines.push("# TYPE radioflow_http_route_responses_total counter");
  lines.push("# HELP radioflow_http_route_latency_ms HTTP latency per method+route.");
  lines.push("# TYPE radioflow_http_route_latency_ms gauge");

  for (const [key, r] of routes) {
    const sp = key.indexOf(" ");
    const method = sp > 0 ? key.slice(0, sp) : "UNKNOWN";
    const route = sp > 0 ? key.slice(sp + 1) : key;

    lines.push(
      `radioflow_http_route_requests_total{method="${promEscapeLabelValue(method)}",route="${promEscapeLabelValue(route)}"} ${r.requests}`,
    );
    for (const cls of ["2xx", "3xx", "4xx", "5xx"] as const) {
      const val = r.status[cls] ?? 0;
      lines.push(
        `radioflow_http_route_responses_total{method="${promEscapeLabelValue(method)}",route="${promEscapeLabelValue(route)}",status_class="${cls}"} ${val}`,
      );
    }

    const sample = [...r.latency.sampleMs].sort((a, b) => a - b);
    const avg = r.latency.count > 0 ? r.latency.sumMs / r.latency.count : 0;
    const min = Number.isFinite(r.latency.minMs) ? r.latency.minMs : 0;
    const p50 = percentile(sample, 50);
    const p95 = percentile(sample, 95);
    const max = r.latency.maxMs;

    const base = `method="${promEscapeLabelValue(method)}",route="${promEscapeLabelValue(route)}"`;
    lines.push(`radioflow_http_route_latency_ms{${base},stat="count"} ${r.latency.count}`);
    lines.push(`radioflow_http_route_latency_ms{${base},stat="sum"} ${r.latency.sumMs}`);
    lines.push(`radioflow_http_route_latency_ms{${base},stat="avg"} ${Number(avg.toFixed(2))}`);
    lines.push(`radioflow_http_route_latency_ms{${base},stat="min"} ${min}`);
    lines.push(`radioflow_http_route_latency_ms{${base},stat="p50"} ${p50}`);
    lines.push(`radioflow_http_route_latency_ms{${base},stat="p95"} ${p95}`);
    lines.push(`radioflow_http_route_latency_ms{${base},stat="max"} ${max}`);
  }

  return lines.join("\n") + "\n";
}

