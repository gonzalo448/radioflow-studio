#!/usr/bin/env node
/**
 * Libera puertos de desarrollo embebido (Vite + API SQLite) antes de `npm run dev`.
 * Evita "Port 5173 is already in use" tras cerrar Electron/concurrently sin matar hijos.
 */
import { execSync } from "node:child_process";

const PORTS = [5173, 4001];

function pidsListeningOn(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts.at(-1);
      if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

for (const port of PORTS) {
  for (const pid of pidsListeningOn(port)) {
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore" });
      console.log(`[free-dev-ports] puerto ${port}: proceso ${pid} terminado`);
    } catch {
      console.warn(`[free-dev-ports] no se pudo terminar PID ${pid} (puerto ${port})`);
    }
  }
}
