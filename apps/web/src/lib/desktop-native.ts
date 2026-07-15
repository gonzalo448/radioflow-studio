import { DND_NATIVE_PATHS_MIME, LOCAL_AUDIO_EXT_RE } from "./local-audio-import";

export function isRadioflowDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.radioflow?.nativeFs);
}

/** Abre la carpeta de datos de la app de escritorio. */
export async function openAppDataFolder(): Promise<{ ok: boolean; path?: string; message?: string }> {
  const open = window.radioflow?.paths?.openUserDataFolder;
  if (open) {
    const res = await open();
    if (res.error) return { ok: false, path: res.path, message: res.error };
    return { ok: true, path: res.path };
  }
  const userData = window.radioflow?.paths?.userData;
  if (userData) {
    const path = await userData();
    return {
      ok: false,
      path,
      message: `Datos de la aplicación: ${path}\nActualice RadioFlow Desktop para abrir la carpeta desde el menú.`,
    };
  }
  return {
    ok: false,
    message: "Abra RadioFlow Studio desde la aplicación instalada en su equipo.",
  };
}

export function parseNativePathsDrag(e: React.DragEvent): string[] | null {
  let raw = "";
  try {
    raw = e.dataTransfer.getData(DND_NATIVE_PATHS_MIME);
  } catch {
    /* ignore */
  }
  if (!raw) raw = e.dataTransfer.getData("text/plain");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { paths?: string[] };
    if (!Array.isArray(j.paths) || !j.paths.every((x) => typeof x === "string")) return null;
    return j.paths;
  } catch {
    return null;
  }
}

export async function filesFromAbsolutePaths(paths: string[]): Promise<File[]> {
  const fsApi = window.radioflow?.nativeFs;
  if (!fsApi) throw new Error("Explorador nativo no disponible");
  const parts = await fsApi.filesFromPaths(paths);
  return parts.map((x) => {
    let bytes: Uint8Array;
    if (x.data instanceof Uint8Array) bytes = x.data;
    else if (Array.isArray(x.data)) bytes = Uint8Array.from(x.data);
    else if (x.data && typeof x.data === "object" && "type" in x.data && (x.data as { type?: string }).type === "Buffer") {
      bytes = Uint8Array.from((x.data as unknown as { data: number[] }).data);
    } else {
      bytes = new Uint8Array(x.data as ArrayBuffer);
    }
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new File([copy], x.name, { type: "application/octet-stream" });
  });
}

export function isNativeAudioPath(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  return LOCAL_AUDIO_EXT_RE.test(base);
}

/** Diálogo nativo de archivos de audio (solo Electron). Devuelve File[] listos para importar. */
export async function openNativeAudioPaths(): Promise<File[]> {
  const fsApi = window.radioflow?.nativeFs;
  if (!fsApi?.openAudioDialog) return [];
  const paths = await fsApi.openAudioDialog();
  if (!paths.length) return [];
  return filesFromAbsolutePaths(paths);
}
