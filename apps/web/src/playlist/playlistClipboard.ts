export type PlaylistClipEntry = { itemId: string; assetId: string };

export type PlaylistClipboard = {
  mode: "copy" | "cut";
  sourcePlaylistId: string;
  entries: PlaylistClipEntry[];
};

let buffer: PlaylistClipboard | null = null;

export function setPlaylistClipboard(next: PlaylistClipboard | null): void {
  buffer = next;
}

export function getPlaylistClipboard(): PlaylistClipboard | null {
  return buffer;
}
