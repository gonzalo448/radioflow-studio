import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { loadCartBrowserHotkeysEnabled } from "../lib/cart-hotkeys-prefs";
import {
  emitCartFireEvent,
  loadCartFirePlayNow,
} from "../lib/cart-fire-prefs";
import { isRadioflowDesktop } from "../lib/desktop-native";
import { readActiveJinglePage } from "../lib/jingle-page";
import type { ApiJingleFireResult, ApiJingleSlotsMap } from "@radioflow/shared";

const SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
const FIRE_DEBOUNCE_MS = 350;

/** Hotkeys cart 1–0 globales (Electron + navegador si está habilitado). */
export function useGlobalCartHotkeys() {
  const { token } = useAuth();
  const slotsRef = useRef<ApiJingleSlotsMap>({});
  const pageRef = useRef(readActiveJinglePage());
  const lastFireAtRef = useRef(0);
  const playNowRef = useRef(loadCartFirePlayNow());
  const [browserEnabled, setBrowserEnabled] = useState(loadCartBrowserHotkeysEnabled);

  const loadSlots = useCallback(async () => {
    try {
      pageRef.current = readActiveJinglePage();
      slotsRef.current = await apiFetch<ApiJingleSlotsMap>(
        `/api/jingles/slots?page=${encodeURIComponent(pageRef.current)}`,
      );
    } catch {
      slotsRef.current = {};
    }
  }, []);

  const fireSlot = useCallback(
    async (key: string) => {
      if (!token || !SLOT_KEYS.includes(key as (typeof SLOT_KEYS)[number])) return;
      const now = Date.now();
      if (now - lastFireAtRef.current < FIRE_DEBOUNCE_MS) return;
      lastFireAtRef.current = now;

      const pageKey = pageRef.current;
      const playNow = playNowRef.current;
      const entry = slotsRef.current[key as keyof ApiJingleSlotsMap];
      // Caché solo como hint: si parece vacía, reintentamos load una vez y luego API.
      if (!entry?.assetId) {
        await loadSlots();
        if (!slotsRef.current[key as keyof ApiJingleSlotsMap]?.assetId) {
          emitCartFireEvent({
            ok: false,
            slotKey: key,
            pageKey,
            error: `Sin audio en página ${pageKey}, tecla ${key}`,
            source: "hotkey",
          });
          return;
        }
      }

      try {
        const result = await apiFetch<ApiJingleFireResult>("/api/jingles/fire", {
          method: "POST",
          token,
          body: JSON.stringify({
            slotKey: key,
            pageKey,
            playNow,
            playNext: !playNow,
          }),
        });
        // Estado de cola vía WebSocket (StationLive) — sin GET /station extra (C5 latencia).
        emitCartFireEvent({
          ok: true,
          slotKey: key,
          pageKey,
          label: result.label,
          playNow: result.playNow,
          source: "hotkey",
        });
      } catch (err) {
        emitCartFireEvent({
          ok: false,
          slotKey: key,
          pageKey,
          error: err instanceof Error ? err.message : "No se pudo disparar el cart",
          source: "hotkey",
        });
      }
    },
    [loadSlots, token],
  );

  useEffect(() => {
    void loadSlots();
    const t = window.setInterval(() => void loadSlots(), 60_000);
    const onPage = () => void loadSlots();
    const onSlots = () => void loadSlots();
    const onPrefs = () => setBrowserEnabled(loadCartBrowserHotkeysEnabled());
    const onMode = () => {
      playNowRef.current = loadCartFirePlayNow();
    };
    window.addEventListener("radioflow-jingle-page", onPage);
    window.addEventListener("radioflow-jingle-slots-changed", onSlots);
    window.addEventListener("radioflow-cart-browser-hotkeys", onPrefs);
    window.addEventListener("radioflow-cart-fire-mode", onMode);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("radioflow-jingle-page", onPage);
      window.removeEventListener("radioflow-jingle-slots-changed", onSlots);
      window.removeEventListener("radioflow-cart-browser-hotkeys", onPrefs);
      window.removeEventListener("radioflow-cart-fire-mode", onMode);
    };
  }, [loadSlots]);

  useEffect(() => {
    if (!isRadioflowDesktop() || !token) return;
    const cart = window.radioflow?.cartHotkeys;
    if (!cart) return;
    void cart.enable();
    const unsub = cart.onKey((key) => {
      void fireSlot(key);
    });
    return () => {
      unsub();
      void cart.disable();
    };
  }, [fireSlot, token]);

  useEffect(() => {
    if (!token || !browserEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (window.location.pathname.replace(/\/$/, "").endsWith("/jingles")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      const k = e.key;
      if (SLOT_KEYS.includes(k as (typeof SLOT_KEYS)[number])) {
        e.preventDefault();
        void fireSlot(k);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browserEnabled, fireSlot, token]);
}
