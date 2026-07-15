import { Prisma } from "@prisma/client";
import type { FastifyError } from "fastify";
import { ZodError } from "zod";
import { isAppError } from "./app-error.js";

export type MappedHttpError = {
  statusCode: number;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
};

/** Convierte errores conocidos en respuestas HTTP con mensaje útil (evita 500 genéricos). */
export function mapHttpError(error: unknown): MappedHttpError | null {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      error: error.message,
      code: error.code,
      details: error.details,
    };
  }

  if (error instanceof ZodError) {
    const first = error.issues[0];
    const detail = first?.message ? `: ${first.message}` : "";
    return { statusCode: 400, error: `Datos inválidos${detail}` };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2022") {
      return {
        statusCode: 503,
        error: "Base de datos desactualizada. Ejecute: npm run db:migrate",
      };
    }
  }

  const fastify = error as FastifyError;
  if (
    fastify &&
    typeof fastify === "object" &&
    typeof fastify.statusCode === "number" &&
    fastify.statusCode >= 400 &&
    fastify.statusCode < 600
  ) {
    return {
      statusCode: fastify.statusCode,
      error: fastify.message || "Error de solicitud",
    };
  }

  return null;
}
