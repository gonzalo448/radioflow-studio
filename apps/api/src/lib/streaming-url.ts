import type { StreamProtocol } from "@prisma/client";

/**
 * URL para FFmpeg `-f <formato>` hacia Icecast (compatible con la mayoría de despliegues).
 * Otros protocolos: documentar o extender según Shoutcast/AzuraCast del cliente.
 */
export function buildEncoderSourceUrl(params: {
  protocol: StreamProtocol;
  host: string;
  port: number;
  mountPath: string;
  sourceUser: string | null;
  sourcePassword: string;
  tls: boolean;
}): string {
  const user = params.sourceUser || "source";
  const pass = params.sourcePassword;
  const mount = params.mountPath.startsWith("/") ? params.mountPath : `/${params.mountPath}`;
  if (params.protocol === "icecast" || params.protocol === "azuracast") {
    const scheme = params.tls ? "icecasts" : "icecast";
    return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${params.host}:${params.port}${mount}`;
  }
  /* Shoutcast legacy: muchos usan el mismo esquema icecast:// con mount /1 — ajustar si tu servidor exige otro formato */
  return `icecast://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${params.host}:${params.port}${mount}`;
}
