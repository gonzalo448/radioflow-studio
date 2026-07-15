export type NativeFsListEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
};

export type NativeFsRoot = { path: string; name: string };

export type NativeFsFilePart = { name: string; data: ArrayBuffer };

interface RadioflowNativeFs {
  listRoots: () => Promise<NativeFsRoot[]>;
  readDirectory: (dirPath: string) => Promise<NativeFsListEntry[]>;
  parentPath: (dirPath: string) => Promise<string | null>;
  filesFromPaths: (paths: string[]) => Promise<NativeFsFilePart[]>;
  /** Abre el diálogo nativo del sistema para elegir audio (multi). */
  openAudioDialog: () => Promise<string[]>;
  /** Carpeta del disco: devuelve rutas de audio encontradas (recursivo). */
  openAudioFolderDialog: () => Promise<string[]>;
  /** Diálogo nativo: solo la ruta de la carpeta elegida (locución horaria, etc.). */
  openDirectoryDialog: (opts?: { title?: string }) => Promise<string | null>;
  /** Diálogo nativo para elegir imagen (logo emisora). */
  openImageDialog: () => Promise<string | null>;
  /** Sube archivos por ruta absoluta vía API local (sin pasar binarios al renderer). */
  uploadPathsToLibrary: (payload: {
    paths: string[];
    folder?: string;
    token: string;
  }) => Promise<{ ids: string[]; errors: string[] }>;
}

interface RadioflowDesktopPaths {
  /** Datos de la app (`radioflow.db`, media, logs). */
  userData: () => Promise<string>;
  /** Abre la carpeta de datos en el explorador del sistema. */
  openUserDataFolder: () => Promise<{ path: string; error: string | null }>;
}

interface RadioflowShellBridge {
  openExternal: (url: string) => Promise<{ ok: boolean; error: string | null }>;
}

interface RadioflowNavigationBridge {
  onNavigate: (listener: (path: string) => void) => () => void;
}

export type CabMeterSample = {
  /** Pico suavizado 0..1 en el bus de cabina (Web Audio). */
  peak01: number;
  /** dBFS aproximado o null si está por debajo del ruido de piso numérico. */
  dbFs: number | null;
  /** Marca temporal estable en el renderer (`performance.now()`). */
  tMs: number;
};

interface RadioflowCabMeterBridge {
  /** Envíe muestras al proceso principal (throttle recomendado ~15–20 Hz). */
  pushSample: (sample: CabMeterSample) => void;
  /** Alterna ventana flotante VU (solo Electron). */
  toggleHud?: () => Promise<boolean>;
  isHudVisible?: () => Promise<boolean>;
}

export type RadioflowUpdateCheckResult = {
  status: string;
  version?: string;
  error?: string;
};

interface RadioflowUpdatesBridge {
  check: () => Promise<RadioflowUpdateCheckResult>;
}

export type RadioflowEncoderLocalStatus = {
  running: boolean;
  pid: number | null;
  error?: string;
};

export type RadioflowEncoderStartPayload = {
  token: string;
  apiOrigin?: string;
  /** Contraseña admin Icecast (metadatos /admin/metadata). Distinta de la fuente. */
  icecastAdminPassword?: string;
  icecastAdminUser?: string;
};

interface RadioflowEncoderBridge {
  start: (payload: RadioflowEncoderStartPayload) => Promise<RadioflowEncoderLocalStatus>;
  stop: () => Promise<RadioflowEncoderLocalStatus>;
  status: () => Promise<RadioflowEncoderLocalStatus>;
}

interface RadioflowCartHotkeysBridge {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  onKey: (listener: (key: string) => void) => () => void;
}

interface RadioflowDesktopBridge {
  readonly paths: RadioflowDesktopPaths;
  readonly shell?: RadioflowShellBridge;
  readonly navigation?: RadioflowNavigationBridge;
  readonly nativeFs: RadioflowNativeFs;
  /** Solo en app Electron: medición VU / bus cabina hacia el main (IPC). */
  readonly cabMeter?: RadioflowCabMeterBridge;
  readonly updates?: RadioflowUpdatesBridge;
  /** Arranque del encoder FFmpeg local (solo Electron). */
  readonly encoder?: RadioflowEncoderBridge;
  /** Teclas 1–0 globales para cart wall. */
  readonly cartHotkeys?: RadioflowCartHotkeysBridge;
}

declare global {
  interface Window {
    radioflow?: RadioflowDesktopBridge;
  }
}

export {};
