import { handleDtmfDigit } from "./dtmf-actions.js";

/** Dispara acción DTMF al avanzar desde un ítem de cola/lista con kind `dtmf`. */
export async function maybeTriggerQueueItemDtmf(item: {
  kind: string;
  label: string | null;
}): Promise<void> {
  if (item.kind !== "dtmf") return;
  const digit = item.label?.trim();
  if (!digit) return;
  try {
    await handleDtmfDigit(digit);
  } catch (err) {
    console.warn("[queue-dtmf]", err instanceof Error ? err.message : err);
  }
}
