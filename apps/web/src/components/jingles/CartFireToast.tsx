import { useEffect, useState } from "react";
import type { CartFireEventDetail } from "../../lib/cart-fire-prefs";

const HIDE_MS = 2800;

/** Toast breve al disparar cart wall (hotkey o página). */
export function CartFireToast() {
  const [detail, setDetail] = useState<CartFireEventDetail | null>(null);

  useEffect(() => {
    let hideTimer: number | undefined;
    const onFire = (ev: Event) => {
      const d = (ev as CustomEvent<CartFireEventDetail>).detail;
      if (!d) return;
      setDetail(d);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setDetail(null), HIDE_MS);
    };
    window.addEventListener("radioflow-cart-fired", onFire);
    return () => {
      window.removeEventListener("radioflow-cart-fired", onFire);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!detail) return null;

  const text = detail.ok
    ? `Cart ${detail.pageKey}${detail.slotKey}${detail.label ? ` · ${detail.label}` : ""}${
        detail.playNow ? " · al aire" : " · en cola"
      }`
    : `Cart ${detail.pageKey}${detail.slotKey}: ${detail.error ?? "error"}`;

  return (
    <div
      className={`cart-fire-toast${detail.ok ? "" : " cart-fire-toast--error"}`}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
