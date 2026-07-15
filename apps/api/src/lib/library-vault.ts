import fs from "node:fs";
import path from "node:path";
import type { Env } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "./app-error.js";
import { isPathInsideRoot, mediaRootAbs } from "./media-path.js";
import { isRemoteStreamPath } from "./remote-stream-path.js";

export type VaultAssetRef = { id: string; title: string; path: string };

/** Modo efectivo de ingesta (app instalada fuerza `copy`). */
export function libraryIngestMode(env: Env): "copy" | "register" {
  if (env.EMBEDDED_STANDALONE || env.BOOTSTRAP_LOCAL_ADMIN) return "copy";
  return env.LIBRARY_INGEST_MODE;
}

/** Rechaza registro de rutas / M3U “solo registrar” cuando la bóveda exige copia. */
export function assertRegisterIngestAllowed(env: Env): void {
  if (libraryIngestMode(env) === "copy") {
    throw new AppError(
      "En modo bóveda estricta solo puede ingresar música subiendo archivos (copia al servidor). El registro de rutas externas está desactivado.",
      { statusCode: 403, code: "VAULT_INGEST_COPY_ONLY" },
    );
  }
}

function vaultPathCandidate(storedPath: string, env: Env): string {
  const root = mediaRootAbs(env);
  return path.isAbsolute(storedPath) ? path.normalize(storedPath) : path.resolve(root, storedPath);
}

/** Valida que una ruta almacenada exista bajo MEDIA_ROOT (ingesta por registro). */
export function assertStoredPathInVault(storedPath: string, env: Env): void {
  const root = mediaRootAbs(env);
  const candidate = vaultPathCandidate(storedPath, env);
  if (!isPathInsideRoot(candidate, root)) {
    throw new AppError("La ruta debe estar dentro de MEDIA_ROOT.", {
      statusCode: 422,
      code: "VAULT_ASSET_NOT_PLAYABLE",
      details: { path: storedPath },
    });
  }
  if (!fs.existsSync(candidate)) {
    throw new AppError("No hay archivo en disco en esa ruta.", {
      statusCode: 422,
      code: "VAULT_FILE_MISSING",
      details: { path: storedPath },
    });
  }
}

/** Comprueba que un asset del catálogo sea reproducible desde la bóveda local. */
export function assertAssetPlayableInVault(asset: VaultAssetRef, env: Env): void {
  if (isRemoteStreamPath(asset.path)) return;

  const root = mediaRootAbs(env);
  const candidate = vaultPathCandidate(asset.path, env);

  if (!isPathInsideRoot(candidate, root)) {
    throw new AppError(
      `«${asset.title}» no está en la bóveda de medios (ruta fuera de MEDIA_ROOT). Suba el archivo o corrija la ruta en librería.`,
      {
        statusCode: 422,
        code: "VAULT_ASSET_NOT_PLAYABLE",
        details: { assetId: asset.id, path: asset.path },
      },
    );
  }

  if (!fs.existsSync(candidate)) {
    throw new AppError(
      `Falta el archivo de «${asset.title}» en la bóveda. Vuelva a subir la pista o quítela de la cola.`,
      {
        statusCode: 422,
        code: "VAULT_FILE_MISSING",
        details: { assetId: asset.id, path: asset.path },
      },
    );
  }
}

/** Valida en orden de playlist/cola que todos los assets existan en la bóveda. */
export async function assertAssetsPlayableInVault(assetIds: string[], env: Env): Promise<void> {
  if (assetIds.length === 0) return;

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, title: true, path: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));

  for (const id of assetIds) {
    const asset = byId.get(id);
    if (!asset) {
      throw new AppError("Pista no encontrada en la librería", {
        statusCode: 404,
        code: "ASSET_NOT_FOUND",
        details: { assetId: id },
      });
    }
    assertAssetPlayableInVault(asset, env);
  }
}
