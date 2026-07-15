const DEFAULT_LABELS = [
  "Personalizado 1",
  "Personalizado 2",
  "Personalizado 3",
  "Personalizado 4",
  "Personalizado 5",
] as const;

export function parseLibraryCustomFieldLabels(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [...DEFAULT_LABELS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_LABELS];
    const labels = parsed
      .slice(0, 5)
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .map((v, i) => v || (DEFAULT_LABELS[i] ?? `Personalizado ${i + 1}`));
    while (labels.length < 5) {
      labels.push(DEFAULT_LABELS[labels.length] ?? `Personalizado ${labels.length + 1}`);
    }
    return labels;
  } catch {
    return [...DEFAULT_LABELS];
  }
}

export function serializeLibraryCustomFieldLabels(labels: string[]): string {
  const out = labels.slice(0, 5).map((l, i) => {
    const t = l.trim();
    return t || DEFAULT_LABELS[i];
  });
  while (out.length < 5) out.push(DEFAULT_LABELS[out.length]);
  return JSON.stringify(out);
}

export const LIBRARY_CUSTOM_FIELD_KEYS = [
  "customField1",
  "customField2",
  "customField3",
  "customField4",
  "customField5",
] as const;

export type LibraryCustomFieldKey = (typeof LIBRARY_CUSTOM_FIELD_KEYS)[number];
