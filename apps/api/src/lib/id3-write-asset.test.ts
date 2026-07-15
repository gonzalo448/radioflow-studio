import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseFile } from "music-metadata";
import NodeID3 from "node-id3";
import { describe, expect, it } from "vitest";
import {
  buildNodeId3Tags,
  isId3WritableExt,
  writeId3TagsToMp3File,
} from "./id3-write-asset.js";

describe("id3-write-asset (C4)", () => {
  it("solo .mp3 es escribible", () => {
    expect(isId3WritableExt("a.mp3")).toBe(true);
    expect(isId3WritableExt("A.MP3")).toBe(true);
    expect(isId3WritableExt("a.flac")).toBe(false);
    expect(isId3WritableExt("a.m4a")).toBe(false);
  });

  it("buildNodeId3Tags mapea campos de biblioteca", () => {
    const tags = buildNodeId3Tags({
      title: "  Hello  ",
      artist: "Artist",
      album: "Album",
      genre: "Rock",
      releaseYear: 2024,
      id3Comment: "Nota",
    });
    expect(tags.title).toBe("Hello");
    expect(tags.artist).toBe("Artist");
    expect(tags.album).toBe("Album");
    expect(tags.genre).toBe("Rock");
    expect(tags.year).toBe("2024");
    expect(tags.comment).toEqual({ language: "spa", text: "Nota" });
  });

  it("round-trip: write → music-metadata lee los mismos tags", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rf-id3-"));
    const mp3 = path.join(dir, "sample.mp3");
    const seed = NodeID3.create({ title: "Old", artist: "Seed" });
    await writeFile(mp3, seed);

    writeId3TagsToMp3File(mp3, {
      title: "Round Trip",
      artist: "RadioFlow",
      album: "C4",
      genre: "Test",
      releaseYear: 2026,
      id3Comment: "escrito por test",
    });

    const mm = await parseFile(mp3);
    expect(mm.common.title).toBe("Round Trip");
    expect(mm.common.artist).toBe("RadioFlow");
    expect(mm.common.album).toBe("C4");
    expect(mm.common.genre?.[0] ?? mm.common.genre).toEqual(expect.stringMatching(/Test/));
    expect(mm.common.year).toBe(2026);
    const comment = mm.common.comment;
    function commentPart(x: unknown): string {
      if (typeof x === "string") return x;
      if (x && typeof x === "object" && "text" in x) return String((x as { text: unknown }).text ?? "");
      return "";
    }
    const commentText = Array.isArray(comment)
      ? comment.map(commentPart).join("\n")
      : commentPart(comment);
    expect(commentText).toContain("escrito por test");
  });
});
