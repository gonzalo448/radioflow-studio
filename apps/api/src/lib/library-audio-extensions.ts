/** Extensiones de audio reconocidas al escanear carpetas (alineado con el panel web). */
export const LIBRARY_AUDIO_EXT = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
  ".ogg",
  ".opus",
  ".wma",
  ".aif",
  ".aiff",
]);

export function isLibraryAudioFilename(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return LIBRARY_AUDIO_EXT.has(ext);
}
