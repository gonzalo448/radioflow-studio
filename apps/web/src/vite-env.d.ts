/// <reference types="vite/client" />

interface ImportMetaEnv {
 readonly VITE_API_ORIGIN?: string;
 /** En build escritorio (`file://`) usar HashRouter. */
 readonly VITE_HASH_ROUTER?: string;
 /** Prefill login (build escritorio / estación local). */
 readonly VITE_LOCAL_DEFAULT_EMAIL?: string;
 readonly VITE_LOCAL_DEFAULT_PASSWORD?: string;
 /** Build escritorio con API embebida (SQLite): omite la pantalla de conexión y fija el origen del API. */
 readonly VITE_EMBEDDED_STANDALONE?: string;
 /** Instalador.exe para clientes (producto solo escritorio, sin panel web). */
 readonly VITE_DESKTOP_PRODUCT?: string;
 /** URL pública del instalable (NSIS/portable/dmg/AppImage); muestra botón “Descargar cliente” en la web. */
 readonly VITE_DESKTOP_DOWNLOAD_URL?: string;
}

interface ImportMeta {
 readonly env: ImportMetaEnv;
}
