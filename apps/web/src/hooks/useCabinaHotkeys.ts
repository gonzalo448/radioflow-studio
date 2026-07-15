import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../lib/api";
import { eventMatchesHotkey, loadCabinaHotkeys } from "../lib/cabina-hotkeys";
import {
  JINGLE_PAGES,
  readActiveJinglePage,
  writeActiveJinglePage,
} from "../lib/jingle-page";
import { useStationAirPlayback } from "../station/StationAirPlaybackContext";
import { useStationLive } from "../station/StationLiveContext";

function cycleCartPage(delta: number): void {
  const cur = readActiveJinglePage();
  const idx = JINGLE_PAGES.indexOf(cur);
  const next = JINGLE_PAGES[(idx + delta + JINGLE_PAGES.length) % JINGLE_PAGES.length]!;
  writeActiveJinglePage(next);
}

/** Atajos de cabina en toda la app cuando no hay foco en campos de texto. */
export function useCabinaHotkeys() {
  const { token } = useAuth();
  const { refresh } = useStationLive();
  const { play, pause, getLeadAudio, setDockMuted, airAssetId } = useStationAirPlayback();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;

      const cfg = loadCabinaHotkeys();

      if (eventMatchesHotkey(e, cfg.play_pause) && airAssetId) {
        e.preventDefault();
        const elAudio = getLeadAudio();
        if (elAudio && !elAudio.paused) pause();
        else void play().catch(() => {});
        return;
      }

      if (eventMatchesHotkey(e, cfg.skip) && token) {
        e.preventDefault();
        void apiFetch("/api/station/skip", { method: "POST", token })
          .then(() => refresh())
          .catch(() => {});
        return;
      }

      if (eventMatchesHotkey(e, cfg.mute_dock)) {
        e.preventDefault();
        setDockMuted((m) => !m);
        return;
      }

      if (token) {
        if (eventMatchesHotkey(e, cfg.mode_auto)) {
          e.preventDefault();
          void apiFetch("/api/station", {
            method: "PATCH",
            token,
            body: JSON.stringify({ mode: "AUTO" }),
          }).then(() => refresh());
          return;
        }
        if (eventMatchesHotkey(e, cfg.mode_live_assist)) {
          e.preventDefault();
          void apiFetch("/api/station", {
            method: "PATCH",
            token,
            body: JSON.stringify({ mode: "LIVE_ASSIST" }),
          }).then(() => refresh());
          return;
        }
        if (eventMatchesHotkey(e, cfg.mode_live)) {
          e.preventDefault();
          void apiFetch("/api/station", {
            method: "PATCH",
            token,
            body: JSON.stringify({ mode: "LIVE" }),
          }).then(() => refresh());
          return;
        }
      }

      if (eventMatchesHotkey(e, cfg.cart_page_prev)) {
        e.preventDefault();
        cycleCartPage(-1);
        return;
      }
      if (eventMatchesHotkey(e, cfg.cart_page_next)) {
        e.preventDefault();
        cycleCartPage(1);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [airAssetId, getLeadAudio, pause, play, refresh, setDockMuted, token]);
}
