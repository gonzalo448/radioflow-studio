export async function checkDesktopUpdates(): Promise<{
  status: string;
  version?: string;
  error?: string;
}> {
  const check = window.radioflow?.updates?.check;
  if (!check) {
    return { status: "unavailable" };
  }
  return check();
}

export async function toggleCabMeterHud(): Promise<boolean | null> {
  const toggle = window.radioflow?.cabMeter?.toggleHud;
  if (!toggle) return null;
  return toggle();
}

export async function isCabMeterHudVisible(): Promise<boolean | null> {
  const fn = window.radioflow?.cabMeter?.isHudVisible;
  if (!fn) return null;
  return fn();
}
