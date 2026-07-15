/** Prefijo en comentario ID3: `INTRO:artista` o `INTRO_FOR:artista`. */
const INTRO_COMMENT_RE = /^INTRO(?:_FOR)?:\s*(.+)$/i;

export function normalizeIntroMatchKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Extrae clave de emparejamiento desde comentario ID3 dedicado. */
export function introMatchKeyFromComment(comment: string | null | undefined): string | null {
  if (!comment?.trim()) return null;
  const m = comment.trim().match(INTRO_COMMENT_RE);
  if (!m?.[1]?.trim()) return null;
  const key = normalizeIntroMatchKey(m[1]);
  return key.length >= 2 ? key : null;
}

/** Lee TXXX:INTRO_FOR u otros user-defined en music-metadata. */
export function introMatchKeyFromMetadata(mm: {
  common: { comment?: unknown };
  native?: Record<string, unknown[]>;
}): string | null {
  const fromComment = introMatchKeyFromComment(
    Array.isArray(mm.common.comment)
      ? mm.common.comment.map(String).join("\n")
      : mm.common.comment != null
        ? String(mm.common.comment)
        : null,
  );
  if (fromComment) return fromComment;

  for (const entries of Object.values(mm.native ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const id = String((e as { id?: string }).id ?? "");
      const value = String((e as { value?: string }).value ?? "").trim();
      if (/INTRO_FOR/i.test(id) && value) {
        const key = normalizeIntroMatchKey(value);
        if (key.length >= 2) return key;
      }
    }
  }
  return null;
}
