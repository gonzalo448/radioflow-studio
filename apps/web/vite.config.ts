import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// En Electron (`file://`) las URLs absolutas `/assets/...` apuntan al disco raíz y la UI queda en blanco.
export default defineConfig(({ mode }) => {
  const buildStamp = new Date().toISOString();

  return {
    base: mode === "desktop" ? "./" : "/",
    define:
      mode === "desktop"
        ? {
            "import.meta.env.VITE_BUILD_STAMP": JSON.stringify(buildStamp),
            "import.meta.env.VITE_DESKTOP_PRODUCT": JSON.stringify("true"),
            "import.meta.env.VITE_EMBEDDED_STANDALONE": JSON.stringify("true"),
            "import.meta.env.VITE_HASH_ROUTER": JSON.stringify("true"),
            "import.meta.env.VITE_API_ORIGIN": JSON.stringify(
              `http://127.0.0.1:${process.env.RADIOFLOW_API_PORT || "4000"}`,
            ),
            "import.meta.env.VITE_LOCAL_DEFAULT_EMAIL": JSON.stringify(
              process.env.VITE_LOCAL_DEFAULT_EMAIL ?? "",
            ),
            "import.meta.env.VITE_LOCAL_DEFAULT_PASSWORD": JSON.stringify(
              process.env.VITE_LOCAL_DEFAULT_PASSWORD ?? "",
            ),
          }
        : {},
    plugins: [react()],
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
    server: {
      host: process.env.VITE_EMBEDDED_STANDALONE === "true" ? "127.0.0.1" : true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api/ws": {
          target: process.env.VITE_API_ORIGIN ?? "http://127.0.0.1:4000",
          changeOrigin: true,
          ws: true,
        },
        "/api": {
          target: process.env.VITE_API_ORIGIN ?? "http://127.0.0.1:4000",
          changeOrigin: true,
        },
        /** Stream AzuraCast same-origin (evita CORS del CDN que solo permite rr.emitir.online). */
        "/azura-proxy": {
          target: "https://azura.radioritmonline.com",
          changeOrigin: true,
          secure: true,
          timeout: 0,
          proxyTimeout: 0,
          rewrite: (path) => path.replace(/^\/azura-proxy/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Icy-MetaData", "0");
            });
            proxy.on("proxyRes", (proxyRes) => {
              // El CDN manda ACAO de rr.emitir.online; en same-origin no hace falta y confunde.
              delete proxyRes.headers["access-control-allow-origin"];
              delete proxyRes.headers["access-control-allow-credentials"];
            });
          },
        },
        /** Icecast LAN de la estación RadioFlow Studio (mini PC). */
        "/icecast-lan": {
          target: "http://192.168.1.26:8150",
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
          rewrite: (path) => path.replace(/^\/icecast-lan/, "") || "/radio.mp3",
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("Icy-MetaData", "0");
            });
          },
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("react-dom") || id.includes("/react/")) return "vendor-react";
            if (id.includes("react-router")) return "vendor-router";
          },
        },
      },
    },
  };
});
