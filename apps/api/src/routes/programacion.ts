/**
 * Legacy Liquidsoap / ProgramacionBlock (C3).
 * El path de producto es ScheduleBlock (`/api/schedule` + apply-active / tick).
 * Estas rutas alimentan M3U Liquidsoap (opt-in); no escriben la cola de estación del encoder.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, ROLES_PROGRAMACION_DELETE, ROLES_SCHEDULE_WRITE } from "../lib/auth.js";
import { isSqliteDatabaseUrl } from "../lib/db-dialect.js";
import { resolveAssetFilePath } from "../lib/media-path.js";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Postgres: TIME como `Date` UTC; SQLite standalone: texto `HH:MM` / `HH:MM:SS`. */
function formatHora(d: Date | string): string {
  if (typeof d === "string") {
    const t = d.trim();
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
    if (!m) return t;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = m[3] ? Number(m[3]) : 0;
    if (ss === 0) return `${pad2(hh)}:${pad2(mm)}`;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  }
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  if (s === 0) return `${pad2(h)}:${pad2(m)}`;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function parseHora(s: string): Date {
  const t = s.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) throw new Error("hora inválida");
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) throw new Error("hora fuera de rango");
  return new Date(Date.UTC(1970, 0, 1, hh, mm, ss));
}

function weekdayLongEsCo(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CO", { weekday: "long", timeZone }).format(now);
}

function minutesSinceMidnightInZone(now: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(now);
  const hh = Number(parts.find((x) => x.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((x) => x.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

/** Igual que el CRA sin `PROGRAMACION_TZ`: `es-CO` + hora local del proceso. Con TZ: mismo día/hora en esa zona IANA. */
function actualProgramacionClock(now: Date): { dia: string; minutos: number } {
  const tz = process.env.PROGRAMACION_TZ?.trim();
  if (tz) {
    return {
      dia: weekdayLongEsCo(now, tz).toLowerCase(),
      minutos: minutesSinceMidnightInZone(now, tz),
    };
  }
  const hm = now.toTimeString().slice(0, 5);
  const [hh, mm] = hm.split(":").map(Number);
  return {
    dia: now.toLocaleDateString("es-CO", { weekday: "long" }).toLowerCase(),
    minutos: hh * 60 + mm,
  };
}

function blockStartMinutesFromDb(hora: Date | string): number {
  if (typeof hora === "string") {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hora.trim());
    if (!m) return 0;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  return hora.getUTCHours() * 60 + hora.getUTCMinutes();
}

function horaDbValue(parsed: Date): Date | string {
  return isSqliteDatabaseUrl() ? formatHora(parsed) : parsed;
}

const createBody = z.object({
  dia: z.string().min(1),
  hora: z.string().min(1),
  duracion: z.coerce.number().int().positive(),
  playlist_id: z.string().min(1),
});

const updateBody = z.object({
  dia: z.string().min(1),
  hora: z.string().min(1),
  duracion: z.coerce.number().int().positive(),
  playlist_id: z.string().min(1),
});

function toRowResponse(p: {
  id: number;
  dia: string;
  hora: Date | string;
  duracion: number;
  playlistId: string | null;
  usuarioId: string | null;
  creado: Date;
}) {
  return {
    id: p.id,
    dia: p.dia,
    hora: formatHora(p.hora),
    duracion: p.duracion,
    playlist_id: p.playlistId,
    usuario_id: p.usuarioId,
    creado: p.creado.toISOString(),
  };
}

export const programacionRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, opts.env));

  app.get("/programacion", async (_request, reply) => {
    try {
      const rows = await prisma.programacionBlock.findMany({
        orderBy: [{ dia: "asc" }, { hora: "asc" }],
        include: {
          playlist: { select: { name: true } },
          user: { select: { displayName: true, email: true, role: true } },
        },
      });
      return rows.map((p) => ({
        id: p.id,
        dia: p.dia,
        hora: formatHora(p.hora),
        duracion: p.duracion,
        playlist_id: p.playlistId,
        usuario_id: p.usuarioId,
        playlist: p.playlist?.name ?? null,
        usuario: p.user?.displayName ?? p.user?.email ?? null,
        rol: p.user?.role ?? null,
      }));
    } catch {
      return reply.status(503).send({ error: "Error al obtener programación" });
    }
  });

  /** Listado para streaming/Liquidsoap: mismos campos que el CRA (`nombre`, `canciones` = rutas en BD). */
  app.get("/programacion/stream", async (_request, reply) => {
    try {
      const rows = await prisma.programacionBlock.findMany({
        where: { playlistId: { not: null } },
        orderBy: [{ dia: "asc" }, { hora: "asc" }],
        include: {
          playlist: {
            include: {
              items: { orderBy: { position: "asc" }, include: { asset: { select: { path: true } } } },
            },
          },
        },
      });
      return rows
        .filter((p): p is typeof p & { playlist: NonNullable<typeof p.playlist> } => Boolean(p.playlist))
        .map((p) => ({
          dia: p.dia,
          hora: formatHora(p.hora),
          duracion: p.duracion,
          playlist_id: p.playlistId!,
          nombre: p.playlist.name,
          canciones: p.playlist.items
            .filter((it) => (it.kind === "track" || it.kind === "voicetrack") && it.asset)
            .map((it) => it.asset!.path),
        }));
    } catch {
      return reply.status(503).send({ error: "Error al obtener programación" });
    }
  });

  /**
   * M3U dinámico para Liquidsoap (`input.http`, `playlist`, etc.): una URL por línea con ruta absoluta
   * bajo MEDIA_ROOT (mismo criterio que los .m3u generados para Liquidsoap). Requiere que el proceso
   * de audio comparta filesystem con la API o monte la misma ruta.
   */
  app.get("/programacion/stream.m3u", async (_request, reply) => {
    const env = opts.env;
    try {
      const rows = await prisma.programacionBlock.findMany({
        where: { playlistId: { not: null } },
        orderBy: [{ dia: "asc" }, { hora: "asc" }],
        include: {
          playlist: {
            include: {
              items: { orderBy: { position: "asc" }, include: { asset: { select: { path: true } } } },
            },
          },
        },
      });
      const lines: string[] = ["#EXTM3U"];
      for (const p of rows) {
        if (!p.playlist) continue;
        for (const it of p.playlist.items) {
          if (it.kind !== "track" && it.kind !== "voicetrack") continue;
          if (!it.asset) continue;
          const abs = resolveAssetFilePath(it.asset.path, env);
          if (!abs) continue;
          lines.push(abs.split("\\").join("/"));
        }
      }
      const body = lines.length > 1 ? `${lines.join("\n")}\n` : "#EXTM3U\n";
      return reply
        .header("Content-Type", "audio/x-mpegurl; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(body);
    } catch {
      return reply.status(503).send({ error: "Error al obtener programación" });
    }
  });

  /**
   * Bloque vigente ahora (CRA): `format` query (`json` por defecto, `m3u` para lista).
   * Sin `PROGRAMACION_TZ`: mismo criterio que Express (`toLocaleDateString("es-CO")` + `toTimeString().slice(0,5)` local).
   * Con `PROGRAMACION_TZ`: día y hora en esa zona IANA.
   * Día en BD: igualdad con `.toLowerCase()` en ambos lados (como `WHERE p.dia = $1` con parámetro en minúsculas).
   * M3U por defecto: rutas como en BD (`canciones.join`); `absolute=1`: rutas absolutas bajo MEDIA_ROOT.
   */
  app.get("/programacion/actual", async (request, reply) => {
    const env = opts.env;
    const q = request.query as { format?: string; absolute?: string };
    const format = (q.format || "json").toLowerCase();
    const wantM3u = format === "m3u";
    const wantAbsolute = q.absolute === "1";
    const now = new Date();
    const { dia: diaSemana, minutos: ahora } = actualProgramacionClock(now);

    try {
      const rows = await prisma.programacionBlock.findMany({
        where: { playlistId: { not: null } },
        orderBy: [{ hora: "asc" }],
        include: {
          playlist: {
            include: {
              items: { orderBy: { position: "asc" }, include: { asset: { select: { path: true } } } },
            },
          },
        },
      });

      const forToday = rows.filter(
        (p) => p.playlist && p.dia.trim().toLowerCase() === diaSemana,
      );

      const bloque = forToday.find((p) => {
        const inicio = blockStartMinutesFromDb(p.hora);
        const fin = inicio + p.duracion;
        return ahora >= inicio && ahora < fin;
      });

      if (wantM3u) {
        if (!bloque?.playlist) {
          return reply
            .type("audio/x-mpegurl")
            .header("Cache-Control", "no-store")
            .send("#EXTM3U\n");
        }
        const rutas: string[] = [];
        for (const it of bloque.playlist.items) {
          if (it.kind !== "track" && it.kind !== "voicetrack") continue;
          if (!it.asset) continue;
          if (wantAbsolute) {
            const abs = resolveAssetFilePath(it.asset.path, env);
            if (abs) rutas.push(abs.split("\\").join("/"));
          } else {
            rutas.push(it.asset.path);
          }
        }
        const contenido = `#EXTM3U\n${rutas.join("\n")}`;
        return reply.type("audio/x-mpegurl").header("Cache-Control", "no-store").send(contenido);
      }

      if (!bloque?.playlist) {
        return { canciones: [] };
      }

      return {
        id: bloque.id,
        dia: bloque.dia,
        hora: formatHora(bloque.hora),
        duracion: bloque.duracion,
        playlist_id: bloque.playlistId!,
        nombre: bloque.playlist.name,
        canciones: bloque.playlist.items
          .filter((it) => (it.kind === "track" || it.kind === "voicetrack") && it.asset)
          .map((it) => it.asset!.path),
      };
    } catch {
      return reply.status(503).send({ error: "Error al obtener programación" });
    }
  });

  app.post("/programacion", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    let body: z.infer<typeof createBody>;
    try {
      body = createBody.parse(request.body);
    } catch {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    if (!body.dia || !body.hora || !body.duracion || !body.playlist_id) {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    let horaDate: Date;
    try {
      horaDate = parseHora(body.hora);
    } catch {
      return reply.status(400).send({ error: "hora inválida" });
    }
    try {
      const pl = await prisma.playlist.findUnique({ where: { id: body.playlist_id } });
      if (!pl) return reply.status(400).send({ error: "Playlist no encontrada" });
      const uid = request.userId!;
      const row = await prisma.programacionBlock.create({
        data: {
          dia: body.dia,
          hora: horaDbValue(horaDate) as never,
          duracion: body.duracion,
          playlistId: body.playlist_id,
          usuarioId: uid,
        },
      });
      return reply.status(201).send(toRowResponse(row));
    } catch {
      return reply.status(503).send({ error: "Error al crear bloque de programación" });
    }
  });

  app.put<{ Params: { id: string } }>("/programacion/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_SCHEDULE_WRITE)) return;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id < 1) return reply.status(400).send({ error: "id inválido" });
    let body: z.infer<typeof updateBody>;
    try {
      body = updateBody.parse(request.body);
    } catch {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    let horaDate: Date;
    try {
      horaDate = parseHora(body.hora);
    } catch {
      return reply.status(400).send({ error: "hora inválida" });
    }
    try {
      const pl = await prisma.playlist.findUnique({ where: { id: body.playlist_id } });
      if (!pl) return reply.status(400).send({ error: "Playlist no encontrada" });
      const row = await prisma.programacionBlock.update({
        where: { id },
        data: {
          dia: body.dia,
          hora: horaDbValue(horaDate) as never,
          duracion: body.duracion,
          playlistId: body.playlist_id,
        },
      });
      return toRowResponse(row);
    } catch {
      return reply.status(404).send({ error: "Bloque no encontrado" });
    }
  });

  app.delete<{ Params: { id: string } }>("/programacion/:id", async (request, reply) => {
    if (!requireRoles(request, reply, ROLES_PROGRAMACION_DELETE)) return;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id < 1) return reply.status(400).send({ error: "id inválido" });
    try {
      await prisma.programacionBlock.delete({ where: { id } });
      return { mensaje: "Bloque eliminado" };
    } catch {
      return reply.status(404).send({ error: "Bloque no encontrado" });
    }
  });
};
