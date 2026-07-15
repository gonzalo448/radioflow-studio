import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Role } from "@prisma/client";
import type { Env } from "../config.js";
import { resolveLiquidsoapAudioPath } from "../lib/resolve-liquidsoap-audio-path.js";
import { prisma } from "../db.js";
import { optionalAuth, requireRoles, requireUser } from "../lib/auth.js";

const ADMIN: Role[] = ["admin"];

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  return requireRoles(request, reply, ADMIN);
}

const eventoBody = z.object({
  dia: z.string().min(1).max(20),
  hora: z.string().min(1).max(5),
  ruta_audio: z.string().min(1),
  descripcion: z.string().optional().nullable(),
});

const eventoListSchema = {
  tags: ["eventos"],
  summary: "Listar eventos programados",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          dia: { type: "string" },
          hora: { type: "string" },
          ruta_audio: { type: "string" },
          descripcion: { type: "string", nullable: true },
        },
      },
    },
    503: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

const eventoCreateSchema = {
  tags: ["eventos"],
  summary: "Crear evento (admin)",
  security: [{ bearerAuth: [] }],
  body: {
    type: "object",
    required: ["dia", "hora", "ruta_audio"],
    properties: {
      dia: { type: "string" },
      hora: { type: "string" },
      ruta_audio: { type: "string" },
      descripcion: { type: "string", nullable: true },
    },
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "number" },
        dia: { type: "string" },
        hora: { type: "string" },
        ruta_audio: { type: "string" },
        descripcion: { type: "string", nullable: true },
      },
    },
    400: { type: "object", properties: { error: { type: "string" } } },
    503: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

const eventoActualSchema = {
  tags: ["eventos"],
  summary: "Eventos vigentes para el instante actual (Liquidsoap)",
  description: "Query `format=json` (defecto) o `format=m3u`. Sin autenticación.",
  querystring: {
    type: "object",
    properties: {
      format: { type: "string", enum: ["json", "m3u"] },
    },
  },
  response: {
    200: {
      description: "JSON array de eventos o cuerpo M3U (texto)",
    },
    503: { type: "object", properties: { error: { type: "string" } } },
  },
} as const;

function toEventoRow(e: {
  id: number;
  dia: string;
  hora: string;
  rutaAudio: string;
  descripcion: string | null;
}) {
  return {
    id: e.id,
    dia: e.dia,
    hora: e.hora,
    ruta_audio: e.rutaAudio,
    descripcion: e.descripcion,
  };
}

export const eventosRoutes: FastifyPluginAsync<{ env: Env }> = async (app, _opts) => {
  app.addHook("preHandler", async (request) => optionalAuth(request, _opts.env));

  /** Liquidsoap: eventos con `dia` + `hora` exactos al reloj local del servidor (como el CRA). */
  app.get("/eventos/actual", { schema: eventoActualSchema }, async (request, reply) => {
    const q = request.query as { format?: string };
    const format = (q.format || "json").toLowerCase();
    const now = new Date();
    const diaSemana = now.toLocaleDateString("es-CO", { weekday: "long" }).toLowerCase();
    const horaActual = now.toTimeString().slice(0, 5);

    try {
      const rows = await prisma.evento.findMany({
        where: { dia: diaSemana, hora: horaActual },
        orderBy: { id: "asc" },
      });

      if (format === "m3u") {
        if (rows.length === 0) {
          return reply.type("audio/x-mpegurl").header("Cache-Control", "no-store").send("#EXTM3U\n");
        }
        const paths = rows
          .map((e) => resolveLiquidsoapAudioPath(e.rutaAudio, _opts.env))
          .filter((p): p is string => Boolean(p));
        const contenido =
          paths.length === 0
            ? "#EXTM3U\n"
            : `#EXTM3U\n${paths.join("\n")}\n`;
        return reply.type("audio/x-mpegurl").header("Cache-Control", "no-store").send(contenido);
      }

      return rows.map(toEventoRow);
    } catch {
      return reply.status(503).send({ error: "Error al obtener eventos" });
    }
  });

  /** Listado: cualquier usuario autenticado (solo lectura). Alta/edición/borrado: solo admin. */
  app.get("/eventos", { schema: eventoListSchema }, async (request, reply) => {
    if (!requireUser(request, reply)) return;
    try {
      const rows = await prisma.evento.findMany({ orderBy: [{ dia: "asc" }, { hora: "asc" }] });
      return rows.map(toEventoRow);
    } catch {
      return reply.status(503).send({ error: "Error al obtener eventos" });
    }
  });

  app.post("/eventos", { schema: eventoCreateSchema }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    let body: z.infer<typeof eventoBody>;
    try {
      body = eventoBody.parse(request.body);
    } catch {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    try {
      const row = await prisma.evento.create({
        data: {
          dia: body.dia,
          hora: body.hora,
          rutaAudio: body.ruta_audio,
          descripcion: body.descripcion ?? null,
        },
      });
      return reply.status(201).send(toEventoRow(row));
    } catch {
      return reply.status(503).send({ error: "Error al crear evento" });
    }
  });

  app.put<{ Params: { id: string } }>("/eventos/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id < 1) return reply.status(400).send({ error: "id inválido" });
    let body: z.infer<typeof eventoBody>;
    try {
      body = eventoBody.parse(request.body);
    } catch {
      return reply.status(400).send({ error: "Datos incompletos" });
    }
    try {
      const row = await prisma.evento.update({
        where: { id },
        data: {
          dia: body.dia,
          hora: body.hora,
          rutaAudio: body.ruta_audio,
          descripcion: body.descripcion ?? null,
        },
      });
      return toEventoRow(row);
    } catch {
      return reply.status(404).send({ error: "Evento no encontrado" });
    }
  });

  app.delete<{ Params: { id: string } }>("/eventos/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id < 1) return reply.status(400).send({ error: "id inválido" });
    try {
      await prisma.evento.delete({ where: { id } });
      return { mensaje: "Evento eliminado" };
    } catch {
      return reply.status(404).send({ error: "Evento no encontrado" });
    }
  });
};
