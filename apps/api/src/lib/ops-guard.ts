import type { FastifyReply, FastifyRequest } from "fastify";

// Rate-limit básico para endpoints /ops/* (solo admin) para evitar scraping accidental.
// Se aplica por userId si existe; si no, por IP.
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweepAt = 0;

const WINDOW_MS = 10_000;
const MAX = 30; // 30 requests / 10s por admin
const SWEEP_EVERY_MS = 10_000;

function sweep(now: number): void {
  if (now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
  if (buckets.size > 5_000) buckets.clear();
}

function keyFor(req: FastifyRequest): string {
  const user = req.userId ? `u:${req.userId}` : null;
  const ip = req.ip ? `ip:${req.ip}` : "ip:unknown";
  return user ?? ip;
}

export function guardOpsRequest(request: FastifyRequest, reply: FastifyReply): boolean {
  const now = Date.now();
  sweep(now);
  const k = keyFor(request);
  let b = buckets.get(k);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(k, b);
  }
  b.count += 1;
  if (b.count > MAX) {
    const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    reply.header("Retry-After", String(retry));
    void reply.status(429).send({ error: "Demasiadas solicitudes a ops. Prueba más tarde." });
    return false;
  }
  return true;
}

