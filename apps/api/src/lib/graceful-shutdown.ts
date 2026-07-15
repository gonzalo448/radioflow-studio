import type { FastifyInstance } from "fastify";
import type { Env } from "../config.js";
import type { PeriodicJobsHandle } from "./periodic-jobs.js";

export type GracefulShutdownOptions = {
  app: FastifyInstance;
  env: Env;
  getPeriodicJobs: () => PeriodicJobsHandle | null;
};

/**
 * Cierre ordenado: detiene timers, cierra Fastify/Redis y sale con gracia antes de forzar exit.
 */
export function registerGracefulShutdown({ app, env, getPeriodicJobs }: GracefulShutdownOptions): void {
  let closing = false;

  const shutdown = async (signal: string, exitCode = 0) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "Cerrando servidor…");

    getPeriodicJobs()?.stop();

    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, "Error al cerrar Fastify");
      exitCode = exitCode || 1;
    }

    const graceMs = env.SHUTDOWN_GRACE_MS;
    if (graceMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, graceMs));
    }

    app.log.info({ signal, exitCode }, "Apagado completo");
    process.exit(exitCode);
  };

  const onSignal = (signal: string) => {
    void shutdown(signal, 0).catch((err) => {
      app.log.error({ err, signal }, "Fallo en apagado ordenado");
      process.exit(1);
    });
  };

  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}
