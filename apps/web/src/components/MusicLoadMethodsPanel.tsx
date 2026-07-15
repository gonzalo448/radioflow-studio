import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ChangeEvent } from "react";
import {
  buildM3uPlaylist,
  parseM3uPlaylist,
  type ApiLibraryImportM3uResult,
  type M3uPlaylistEntry,
} from "@radioflow/shared";
import { apiFetch } from "../lib/api";
import { filesFromAbsolutePaths, isRadioflowDesktop } from "../lib/desktop-native";
import { isLocalAudioFile } from "../lib/local-audio-import";

function partitionM3uEntries(entries: M3uPlaylistEntry[]): {
  absoluteLocalPaths: string[];
  serverRelativeEntries: M3uPlaylistEntry[];
  remoteCount: number;
} {
  const absoluteLocalPaths: string[] = [];
  const serverRelativeEntries: M3uPlaylistEntry[] = [];
  let remoteCount = 0;
  for (const en of entries) {
    const p = en.path.trim();
    if (!p) continue;
    if (/^https?:\/\//i.test(p)) {
      remoteCount += 1;
      continue;
    }
    if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || (/^\//.test(p) && !p.startsWith("//"))) {
      absoluteLocalPaths.push(p);
    } else {
      serverRelativeEntries.push(en);
    }
  }
  return { absoluteLocalPaths, serverRelativeEntries, remoteCount };
}

function formatM3uResult(r: ApiLibraryImportM3uResult): string {
  return `+${r.created} nuevas · ${r.skippedExisting} ya en librería · ${r.skippedMissing} sin archivo · ${r.skippedRemote} URL omitidas`;
}

export type MusicLoadMethodsHandle = {
  openMultiFile: () => void;
  openFolder: () => void;
  openM3u: () => void;
};

export type MusicLoadMethodsPanelProps = {
  token: string | null;
  canWrite: boolean;
  busy: boolean;
  /** Subida al servidor (multipart). */
  onUploadLocalFiles: (files: File[]) => Promise<void>;
  /** Registrar entradas cuyo audio ya existe bajo MEDIA_ROOT (solo tiene sentido en Librería). */
  allowServerM3uRegister?: boolean;
  onAfterServerImport?: () => void;
};

/**
 * Formas típicas de ingresar música (similar a ): varios archivos, carpeta, lista M3U.
 */
export const MusicLoadMethodsPanel = forwardRef<MusicLoadMethodsHandle, MusicLoadMethodsPanelProps>(function MusicLoadMethodsPanel(
  {
  token,
  canWrite,
  busy,
  onUploadLocalFiles,
  allowServerM3uRegister = false,
  onAfterServerImport,
  },
  ref,
) {
  const multiRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const m3uRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    openMultiFile: () => multiRef.current?.click(),
    openFolder: () => folderRef.current?.click(),
    openM3u: () => m3uRef.current?.click(),
  }));

  const clearInput = (el: HTMLInputElement | null) => {
    if (el) el.value = "";
  };

  const postServerM3u = useCallback(
    async (content: string): Promise<ApiLibraryImportM3uResult> => {
      if (!token) throw new Error("Inicia sesión para importar en el servidor.");
      return apiFetch<ApiLibraryImportM3uResult>("/api/library/import/m3u", {
        method: "POST",
        token,
        body: JSON.stringify({ content }),
      });
    },
    [token],
  );

  const onMultiChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fl = e.target.files;
      clearInput(e.target);
      if (!canWrite || busy || !fl?.length) return;
      const files = Array.from(fl).filter((f) => isLocalAudioFile(f));
      if (!files.length) {
        setHint("No hay archivos de audio en la selección.");
        return;
      }
      setHint(null);
      await onUploadLocalFiles(files);
    },
    [busy, canWrite, onUploadLocalFiles],
  );

  const onFolderChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fl = e.target.files;
      clearInput(e.target);
      if (!canWrite || busy || !fl?.length) return;
      const files = Array.from(fl).filter((f) => isLocalAudioFile(f));
      if (!files.length) {
        setHint("La carpeta no tiene archivos de audio reconocidos en esta selección.");
        return;
      }
      setHint(null);
      await onUploadLocalFiles(files);
    },
    [busy, canWrite, onUploadLocalFiles],
  );

  const onM3uFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      clearInput(e.target);
      if (!canWrite || busy || !f) return;
      setHint(null);
      const text = await f.text();
      const entries = parseM3uPlaylist(text);
      const { absoluteLocalPaths, serverRelativeEntries, remoteCount } = partitionM3uEntries(entries);
      const parts: string[] = [];
      if (remoteCount) parts.push(`${remoteCount} URL(s) omitidas (no soportadas en esta importación).`);

      if (absoluteLocalPaths.length) {
        if (isRadioflowDesktop()) {
          const files = await filesFromAbsolutePaths(absoluteLocalPaths);
          const audio = files.filter((x) => isLocalAudioFile(x));
          if (audio.length) await onUploadLocalFiles(audio);
          parts.push(`${audio.length} archivo(s) subidos desde rutas locales del .m3u.`);
        } else {
          parts.push(
            "El .m3u contiene rutas absolutas de disco: abra RadioFlow en escritorio para subir esos archivos, o use rutas relativas al almacén del servidor.",
          );
        }
      }

      if (serverRelativeEntries.length) {
        if (!allowServerM3uRegister) {
          parts.push(
            `${serverRelativeEntries.length} entrada(s) con ruta relativa: use la Librería para registrarlas en el servidor sin copiar archivos.`,
          );
        } else if (!token) {
          parts.push("Inicia sesión para registrar rutas del .m3u en el servidor.");
        } else {
          try {
            const r = await postServerM3u(buildM3uPlaylist(serverRelativeEntries));
            parts.push(`Servidor: ${formatM3uResult(r)}`);
            onAfterServerImport?.();
          } catch (err) {
            parts.push(err instanceof Error ? err.message : "Error M3U servidor");
          }
        }
      }

      if (parts.length) setHint(parts.join(" "));
    },
    [allowServerM3uRegister, busy, canWrite, onAfterServerImport, onUploadLocalFiles, postServerM3u, token],
  );

  const onPasteSubmit = useCallback(async () => {
    const c = paste.trim();
    if (!c || !token || !allowServerM3uRegister) return;
    setHint(null);
    try {
      const r = await postServerM3u(c);
      setHint(formatM3uResult(r));
      setPaste("");
      onAfterServerImport?.();
    } catch (err) {
      setHint(err instanceof Error ? err.message : "Error al importar");
    }
  }, [allowServerM3uRegister, paste, postServerM3u, token, onAfterServerImport]);

  if (!canWrite) return null;

  return (
    <details className="music-load-methods">
      <summary className="music-load-methods-summary">
        Formas de cargar música (archivos múltiples, carpeta, .m3u — )
      </summary>
      <div className="music-load-methods-body">
        <p className="muted small">
          <strong>Varios archivos / carpeta:</strong> la emisora guarda una copia en su biblioteca (
          <code>uploads/</code> bajo <code>MEDIA_ROOT</code>). No se usan atajos a carpetas externas del disco.{" "}
          {allowServerM3uRegister ? (
            <>
              <strong>M3U en servidor:</strong> solo registra pistas cuyo archivo ya exista bajo{" "}
              <code>MEDIA_ROOT</code> (modo administrador).
            </>
          ) : (
            <>
              <strong>M3U con rutas del servidor:</strong> desactivado en modo bóveda estricta; suba los archivos o
              use rutas absolutas locales (app de escritorio).
            </>
          )}
        </p>
        <div className="row tight" style={{ flexWrap: "wrap", gap: "0.45rem", marginTop: "0.35rem" }}>
          <input
            ref={multiRef}
            type="file"
            multiple
            accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.wma,.aif,.aiff"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(ev) => void onMultiChange(ev)}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            {...({ webkitdirectory: "" } as Record<string, unknown>)}
            accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.wma,.aif,.aiff"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(ev) => void onFolderChange(ev)}
          />
          <input
            ref={m3uRef}
            type="file"
            accept=".m3u,.m3u8,audio/mpegurl,audio/x-mpegurl"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(ev) => void onM3uFile(ev)}
          />
          <button
            type="button"
            className="btn btn-compact"
            disabled={busy || !token}
            onClick={() => multiRef.current?.click()}
          >
            Elegir varios archivos…
          </button>
          <button
            type="button"
            className="btn btn-compact"
            disabled={busy || !token}
            onClick={() => folderRef.current?.click()}
            title="Importar todos los audios visibles bajo la carpeta elegida (navegador/Chromium)"
          >
            Elegir carpeta…
          </button>
          <button
            type="button"
            className="btn btn-compact ghost"
            disabled={busy || !token}
            onClick={() => m3uRef.current?.click()}
          >
            Archivo .m3u / .m3u8…
          </button>
        </div>
        {allowServerM3uRegister && token ? (
          <div className="music-load-m3u-paste mt">
            <label className="muted small" style={{ display: "block", marginBottom: "0.25rem" }}>
              Pegar contenido <code>.m3u</code> (registro en servidor, sin subir bytes)
            </label>
            <textarea
              className="music-load-m3u-textarea mono small"
              rows={4}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"#EXTM3U\n#EXTINF:123,Artista - Título\nuploads/mi-cancion.mp3"}
              spellCheck={false}
            />
            <button type="button" className="btn btn-compact mt" disabled={busy || !paste.trim()} onClick={() => void onPasteSubmit()}>
              Registrar en librería
            </button>
          </div>
        ) : null}
        {hint ? <p className="muted small mt">{hint}</p> : null}
      </div>
    </details>
  );
});
