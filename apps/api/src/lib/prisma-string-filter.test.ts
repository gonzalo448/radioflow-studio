import { describe, expect, it, afterEach } from "vitest";
import { containsCi, equalsCi } from "./prisma-string-filter.js";
import { mediaAssetWhereFromLibraryFilters } from "./library-list-filters.js";

describe("prisma-string-filter", () => {
  const prev = process.env.DATABASE_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  });

  it("omite mode en SQLite", () => {
    process.env.DATABASE_URL = "file:C:/tmp/radioflow.db";
    expect(containsCi("plastico")).toEqual({ contains: "plastico" });
    expect(equalsCi("Salsa")).toEqual({ equals: "Salsa" });
  });

  it("incluye mode insensitive en Postgres", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/db";
    expect(containsCi("plastico")).toEqual({ contains: "plastico", mode: "insensitive" });
    expect(equalsCi("Salsa")).toEqual({ equals: "Salsa", mode: "insensitive" });
  });
});

describe("mediaAssetWhereFromLibraryFilters", () => {
  const prev = process.env.DATABASE_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  });

  it("busca por q sin mode en SQLite (evita 500)", () => {
    process.env.DATABASE_URL = "file:./radioflow.db";
    const where = mediaAssetWhereFromLibraryFilters({ q: "plastico" });
    expect(where.OR).toEqual([
      { title: { contains: "plastico" } },
      { artist: { contains: "plastico" } },
      { album: { contains: "plastico" } },
      { semanticNote: { contains: "plastico" } },
    ]);
  });
});
