import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "./db";

describe("openDb", () => {
  it("opens a SQLite database in WAL mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "campground-api-"));
    const db = openDb(join(dir, "snapshots.db"));
    try {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      db.close();
    }
  });

  it("creates missing parent directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "campground-api-"));
    const db = openDb(join(dir, "nested/deeper/snapshots.db"));
    try {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      db.close();
    }
  });
});
