import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ApiOpsAuthCleanupRefreshTokens,
  ApiOpsAuthRefreshChains,
  ApiOpsAuthRevokeRefreshChain,
  ApiOpsAuthRevokeRefreshToken,
  ApiOpsAuthUserSessions,
  ApiOpsMetrics,
  ApiOpsRateLimit,
} from "@radioflow/shared";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { apiUrl, appPublicOrigin } from "../lib/api-base";

export function SecurityOpsPage() {
  const { token, user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [ops, setOps] = useState<ApiOpsRateLimit | null>(null);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [opsWindow, setOpsWindow] = useState<number>(60);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsRefresh, setOpsRefresh] = useState(0);

  const [chains, setChains] = useState<ApiOpsAuthRefreshChains | null>(null);
  const [chainsError, setChainsError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<ApiOpsMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsFilter, setMetricsFilter] = useState("");
  const [metricsSort, setMetricsSort] = useState<"requests" | "p95" | "5xx">("requests");
  const [metricsSortDir, setMetricsSortDir] = useState<"desc" | "asc">("desc");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const [revokeChainId, setRevokeChainId] = useState("");
  const [revokeChainMsg, setRevokeChainMsg] = useState<string | null>(null);
  const [revokeChainBusy, setRevokeChainBusy] = useState(false);

  const [sessionsQ, setSessionsQ] = useState("");
  const [sessions, setSessions] = useState<ApiOpsAuthUserSessions | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [revokeTokenId, setRevokeTokenId] = useState("");
  const [revokeTokenMsg, setRevokeTokenMsg] = useState<string | null>(null);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  const canLoad = Boolean(token && isAdmin);
  const authz = useMemo(() => (token ? { token } : null), [token]);

  useEffect(() => {
    if (!canLoad || !token) {
      setOps(null);
      setOpsError(null);
      setChains(null);
      setChainsError(null);
      setMetrics(null);
      setMetricsError(null);
      return;
    }
    setOpsLoading(true);
    fetch(apiUrl(`/api/ops/rate-limit?window=${opsWindow}`), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = (await r.json()) as ApiOpsRateLimit;
        if (!r.ok) throw new Error("ops");
        return data;
      })
      .then((data) => {
        setOps(data);
        setOpsError(null);
      })
      .catch(() => setOpsError("No se pudieron cargar métricas (requiere admin)."))
      .finally(() => setOpsLoading(false));
  }, [canLoad, token, opsWindow, opsRefresh]);

  useEffect(() => {
    if (!canLoad || !token) return;
    fetch(apiUrl(`/api/ops/auth/refresh-chains?window=${opsWindow}`), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = (await r.json()) as ApiOpsAuthRefreshChains;
        if (!r.ok) throw new Error("chains");
        return data;
      })
      .then((data) => {
        setChains(data);
        setChainsError(null);
      })
      .catch(() => setChainsError("No se pudieron cargar métricas de cadenas de refresh."));
  }, [canLoad, token, opsWindow, opsRefresh]);

  useEffect(() => {
    if (!canLoad || !token) return;
    fetch(apiUrl(`/api/ops/metrics`), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = (await r.json()) as ApiOpsMetrics;
        if (!r.ok) throw new Error("metrics");
        return data;
      })
      .then((data) => {
        setMetrics(data);
        setMetricsError(null);
      })
      .catch(() => setMetricsError("No se pudieron cargar métricas HTTP."));
  }, [canLoad, token, opsRefresh]);

  async function onCopyPrometheusUrl() {
    const url = `${appPublicOrigin()}/api/ops/metrics/prometheus`;
    setCopyMsg(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("Copiado.");
      window.setTimeout(() => setCopyMsg(null), 1200);
    } catch {
      // fallback simple
      try {
        window.prompt("Copia la URL:", url);
      } finally {
        setCopyMsg("Copia manual.");
        window.setTimeout(() => setCopyMsg(null), 1500);
      }
    }
  }

  const shownRoutes = useMemo(() => {
    const rows = metrics?.routes ?? [];
    const q = metricsFilter.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.key.toLowerCase().includes(q)) : rows;
    const dir = metricsSortDir === "desc" ? -1 : 1;
    const val = (r: ApiOpsMetrics["routes"][number]) => {
      if (metricsSort === "requests") return r.requests;
      if (metricsSort === "5xx") return r.status["5xx"];
      return r.latencyMs.p95;
    };
    return [...filtered].sort((a, b) => (val(a) - val(b)) * dir);
  }, [metrics?.routes, metricsFilter, metricsSort, metricsSortDir]);

  async function onRevokeChain() {
    if (!authz) return;
    const id = revokeChainId.trim();
    if (!id) return;
    setRevokeChainBusy(true);
    setRevokeChainMsg(null);
    try {
      const res = await apiFetch<ApiOpsAuthRevokeRefreshChain>("/api/ops/auth/revoke-refresh-chain", {
        method: "POST",
        token: authz.token,
        body: JSON.stringify({ refreshTokenId: id }),
      });
      setRevokeChainMsg(`OK: root=${res.rootId} · revocados=${res.revoked}`);
      setOpsRefresh((n) => n + 1);
    } catch (err) {
      setRevokeChainMsg(err instanceof Error ? err.message : "No se pudo revocar la cadena");
    } finally {
      setRevokeChainBusy(false);
    }
  }

  async function onLoadSessions(e: FormEvent) {
    e.preventDefault();
    if (!authz) return;
    const q = sessionsQ.trim();
    if (!q) return;
    setSessions(null);
    setSessionsErr(null);
    try {
      const qs = q.includes("@") ? `email=${encodeURIComponent(q)}` : `userId=${encodeURIComponent(q)}`;
      const data = await apiFetch<ApiOpsAuthUserSessions>(`/api/ops/auth/user-sessions?${qs}`, { token: authz.token });
      setSessions(data);
    } catch (err) {
      setSessionsErr(err instanceof Error ? err.message : "No se pudieron cargar sesiones");
    }
  }

  async function onRevokeRefreshToken() {
    if (!authz) return;
    const id = revokeTokenId.trim();
    if (!id) return;
    setRevokeTokenMsg(null);
    try {
      const res = await apiFetch<ApiOpsAuthRevokeRefreshToken>("/api/ops/auth/revoke-refresh-token", {
        method: "POST",
        token: authz.token,
        body: JSON.stringify({ refreshTokenId: id }),
      });
      setRevokeTokenMsg(`OK: revocado ${res.refreshTokenId.slice(0, 8)}…`);
      if (sessions) setOpsRefresh((n) => n + 1);
    } catch (err) {
      setRevokeTokenMsg(err instanceof Error ? err.message : "No se pudo revocar");
    }
  }

  async function onCleanup() {
    if (!authz) return;
    setCleanupMsg(null);
    try {
      const res = await apiFetch<ApiOpsAuthCleanupRefreshTokens>("/api/ops/auth/cleanup-refresh-tokens", {
        method: "POST",
        token: authz.token,
        body: JSON.stringify({}),
      });
      setCleanupMsg(`OK: borrados=${res.deleted}`);
    } catch (err) {
      setCleanupMsg(err instanceof Error ? err.message : "No se pudo limpiar");
    }
  }

  const denied = !user ? "Inicia sesión." : !isAdmin ? "Solo admin." : null;

  return (
    <section className="card">
      <h1>Seguridad / Operaciones</h1>
      <p className="muted">Herramientas admin para diagnosticar y mitigar incidentes sin exponer secretos.</p>
      {denied && <p className="error">{denied}</p>}

      {isAdmin && (
        <div className="grid">
          <article className="tile">
            <h3>Métricas (auth, rate-limit)</h3>
            {opsError && <p className="error">{opsError}</p>}
            {ops && (
              <ul className="kv">
                <li>
                  <span>Ventana</span>
                  <span>
                    <select
                      className="select"
                      value={opsWindow}
                      onChange={(e) => setOpsWindow(Number(e.target.value))}
                      disabled={opsLoading}
                    >
                      <option value={15}>15m</option>
                      <option value={30}>30m</option>
                      <option value={60}>60m</option>
                    </select>{" "}
                    <button className="btn" type="button" disabled={opsLoading} onClick={() => setOpsRefresh((n) => n + 1)}>
                      Recargar
                    </button>
                  </span>
                </li>
                <li>
                  <span>Auth RL · Redis</span>
                  <span>
                    ok {ops.local.backend.redis.allowed} · 429 {ops.local.backend.redis.blocked}
                  </span>
                </li>
                <li>
                  <span>Auth RL · Memoria</span>
                  <span>
                    ok {ops.local.backend.memory.allowed} · 429 {ops.local.backend.memory.blocked}
                  </span>
                </li>
                <li>
                  <span>Refresh reuse (local)</span>
                  <span>{ops.refreshReuseDetections.local}</span>
                </li>
                {ops.refreshReuseDetections.global && (
                  <li>
                    <span>Refresh reuse (global {ops.refreshReuseDetections.global.windowMinutes}m)</span>
                    <span>{ops.refreshReuseDetections.global.total}</span>
                  </li>
                )}
                <li>
                  <span>Ops revocaciones (local)</span>
                  <span>{ops.opsRevocations.local}</span>
                </li>
                {ops.opsRevocations.global && (
                  <li>
                    <span>Ops revocaciones (global {ops.opsRevocations.global.windowMinutes}m)</span>
                    <span>{ops.opsRevocations.global.total}</span>
                  </li>
                )}
                {chainsError && (
                  <li>
                    <span>Cadenas refresh</span>
                    <span className="error">{chainsError}</span>
                  </li>
                )}
                {chains && (
                  <>
                    <li>
                      <span>Refresh chains · max depth</span>
                      <span>{chains.agg.maxDepth}</span>
                    </li>
                    <li>
                      <span>Refresh chains · avg depth</span>
                      <span>{chains.agg.avgDepth.toFixed(2)}</span>
                    </li>
                    <li>
                      <span>Refresh tokens activos</span>
                      <span>{chains.agg.activeTokens}</span>
                    </li>
                  </>
                )}
              </ul>
            )}
          </article>

          <article className="tile">
            <h3>Métricas HTTP (top rutas)</h3>
            <div className="muted" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <span>
                Export Prometheus: <code>/api/ops/metrics/prometheus</code>
              </span>
              <button className="btn" type="button" onClick={onCopyPrometheusUrl}>
                Copiar URL
              </button>
              {copyMsg ? <span className="muted">{copyMsg}</span> : null}
            </div>
            {metricsError && <p className="error">{metricsError}</p>}
            {metrics && (
              <ul className="kv">
                <li>
                  <span>Uptime (s)</span>
                  <span>{metrics.uptimeSeconds}</span>
                </li>
              </ul>
            )}
            {metrics && metrics.routes.length > 0 && (
              <div className="form inline-grid" style={{ marginTop: "0.5rem" }}>
                <label>
                  Filtro (método/ruta)
                  <input
                    value={metricsFilter}
                    onChange={(e) => setMetricsFilter(e.target.value)}
                    placeholder="Ej: GET /api/health…"
                  />
                </label>
                <label>
                  Orden
                  <span className="row">
                    <select
                      className="select"
                      value={metricsSort}
                      onChange={(e) => setMetricsSort(e.target.value as typeof metricsSort)}
                    >
                      <option value="requests">requests</option>
                      <option value="p95">p95</option>
                      <option value="5xx">5xx</option>
                    </select>
                    <select
                      className="select"
                      value={metricsSortDir}
                      onChange={(e) => setMetricsSortDir(e.target.value as typeof metricsSortDir)}
                    >
                      <option value="desc">desc</option>
                      <option value="asc">asc</option>
                    </select>
                  </span>
                </label>
              </div>
            )}
            {metrics && shownRoutes.length > 0 && (
              <ul className="list">
                {shownRoutes.slice(0, 20).map((r) => (
                  <li key={r.key}>
                    <div>
                      <strong>{r.key}</strong>{" "}
                      <span className="muted">
                        req {r.requests} · 2xx {r.status["2xx"]} · 4xx {r.status["4xx"]} · 5xx {r.status["5xx"]}
                      </span>
                    </div>
                    <div className="muted">
                      lat(ms): p50 <code>{r.latencyMs.p50}</code> · p95 <code>{r.latencyMs.p95}</code> · avg{" "}
                      <code>{r.latencyMs.avg}</code>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="tile">
            <h3>Acciones: revocar por id</h3>
            <div className="form inline-grid">
              <label>
                Revocar cadena (refreshTokenId)
                <div className="row">
                  <input
                    value={revokeChainId}
                    onChange={(e) => setRevokeChainId(e.target.value)}
                    placeholder="refreshTokenId…"
                    disabled={revokeChainBusy}
                  />
                  <button className="btn" type="button" onClick={onRevokeChain} disabled={revokeChainBusy || !revokeChainId.trim()}>
                    Revocar cadena
                  </button>
                </div>
              </label>
              {revokeChainMsg && <p className={revokeChainMsg.startsWith("OK") ? "" : "error"}>{revokeChainMsg}</p>}
              <label>
                Revocar token (refreshTokenId)
                <div className="row">
                  <input
                    value={revokeTokenId}
                    onChange={(e) => setRevokeTokenId(e.target.value)}
                    placeholder="refreshTokenId…"
                  />
                  <button className="btn" type="button" onClick={onRevokeRefreshToken} disabled={!revokeTokenId.trim()}>
                    Revocar token
                  </button>
                </div>
              </label>
              {revokeTokenMsg && <p className={revokeTokenMsg.startsWith("OK") ? "" : "error"}>{revokeTokenMsg}</p>}
              <button className="btn" type="button" onClick={onCleanup}>
                Ejecutar limpieza de refresh tokens
              </button>
              {cleanupMsg && <p className={cleanupMsg.startsWith("OK") ? "" : "error"}>{cleanupMsg}</p>}
            </div>
          </article>

          <article className="tile">
            <h3>Sesiones por usuario</h3>
            <form className="form inline-grid" onSubmit={onLoadSessions}>
              <label>
                userId o email
                <div className="row">
                  <input value={sessionsQ} onChange={(e) => setSessionsQ(e.target.value)} placeholder="userId o correo…" />
                  <button className="btn" type="submit" disabled={!sessionsQ.trim()}>
                    Cargar
                  </button>
                </div>
              </label>
            </form>
            {sessionsErr && <p className="error">{sessionsErr}</p>}
            {sessions && (
              <>
                <p className="muted">
                  {sessions.user.email} · <code>{sessions.user.role}</code>
                </p>
                <ul className="list">
                  {sessions.sessions.map((s) => (
                    <li key={s.id}>
                      <div>
                        <strong>{s.id.slice(0, 8)}…</strong>{" "}
                        <span className="muted">
                          expira: {new Date(s.expiresAt).toLocaleString()} · revocado:{" "}
                          {s.revokedAt ? new Date(s.revokedAt).toLocaleString() : "no"}
                        </span>
                      </div>
                      <div className="muted">
                        replaces: <code>{s.replacesId ? s.replacesId.slice(0, 8) + "…" : "—"}</code> · replacedBy:{" "}
                        <code>{s.replacedById ? s.replacedById.slice(0, 8) + "…" : "—"}</code>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

