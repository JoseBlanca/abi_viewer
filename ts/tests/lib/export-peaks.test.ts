import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../../src/abi-parser.ts";
import { GS500_LIZ } from "../../src/domain/size-ladder.ts";
import { buildPeakCsv } from "../../src/lib/export-peaks.ts";

function loadAbif(file: string): AbifFile {
  const buf = readFileSync(resolve(import.meta.dirname, "../fixtures", file));
  const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new AbifFile(arr);
}

describe("buildPeakCsv", () => {
  it("emits just the header when no files are given", () => {
    const csv = buildPeakCsv([], 5, GS500_LIZ);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("sample,well,channel,scan,bp,height,prominence");
  });

  it("emits rows for every non-standard channel", () => {
    const abi = loadAbif("DANI_NOV_A11.fsa");
    const csv = buildPeakCsv([{ fileName: "DANI_NOV_A11.fsa", abif: abi }], 5, GS500_LIZ);
    const rows = csv.split("\n").slice(1);

    // The fixture has 5 dyes: 6-FAM, VIC, NED, PET, LIZ (LIZ = channel 5 = standard)
    // So rows should include peaks from 6-FAM, VIC, NED, PET but not LIZ
    const channels = new Set(rows.map((r) => r.split(",")[2]));
    expect(channels.has("6-FAM")).toBe(true);
    expect(channels.has("VIC")).toBe(true);
    expect(channels.has("NED")).toBe(true);
    expect(channels.has("PET")).toBe(true);
    expect(channels.has("LIZ")).toBe(false);
  });

  it("includes the standard channel when standardChannel is 0", () => {
    const abi = loadAbif("DANI_NOV_A11.fsa");
    const csv = buildPeakCsv([{ fileName: "DANI_NOV_A11.fsa", abif: abi }], 0, GS500_LIZ);
    const rows = csv.split("\n").slice(1);
    const channels = new Set(rows.map((r) => r.split(",")[2]));
    // With no standard selected, all 5 channels appear
    expect(channels.has("LIZ")).toBe(true);
  });

  it("fills the bp column when calibration succeeds", () => {
    const abi = loadAbif("DANI_NOV_A11.fsa");
    const csv = buildPeakCsv([{ fileName: "DANI_NOV_A11.fsa", abif: abi }], 5, GS500_LIZ);
    const rows = csv.split("\n").slice(1);
    const withBp = rows.filter((r) => {
      const parts = r.split(",");
      return parts[4] !== "";
    });
    expect(withBp.length).toBeGreaterThan(0);
  });

  it("leaves the bp column empty when calibration fails", () => {
    // A ladder with too few sizes to match (< the matcher's minimum) forces
    // calibration to fail, so no row gets a bp value.
    const tinyLadder = { name: "tiny", sizes: [100, 200, 300] };
    const abi = loadAbif("DANI_NOV_A11.fsa");
    const csv = buildPeakCsv([{ fileName: "DANI_NOV_A11.fsa", abif: abi }], 5, tinyLadder);
    const rows = csv.split("\n").slice(1);
    for (const row of rows) {
      const parts = row.split(",");
      expect(parts[4]).toBe("");
    }
  });

  it("leaves the bp column empty when no standard channel is selected", () => {
    const abi = loadAbif("DANI_NOV_A11.fsa");
    const csv = buildPeakCsv([{ fileName: "DANI_NOV_A11.fsa", abif: abi }], 0, GS500_LIZ);
    const rows = csv.split("\n").slice(1);
    for (const row of rows) {
      const parts = row.split(",");
      expect(parts[4]).toBe("");
    }
  });

  it("emits rows from multiple files", () => {
    const a11 = loadAbif("DANI_NOV_A11.fsa");
    const a12 = loadAbif("DANI_NOV_A12.fsa");
    const csv = buildPeakCsv(
      [
        { fileName: "DANI_NOV_A11.fsa", abif: a11 },
        { fileName: "DANI_NOV_A12.fsa", abif: a12 },
      ],
      5,
      GS500_LIZ,
    );
    const rows = csv.split("\n").slice(1);
    const a11Rows = rows.filter((r) => r.includes("A11"));
    const a12Rows = rows.filter((r) => r.includes("A12"));
    expect(a11Rows.length).toBeGreaterThan(0);
    expect(a12Rows.length).toBeGreaterThan(0);
  });

  it("produces ASCII output without a BOM", () => {
    const abi = loadAbif("DANI_NOV_A11.fsa");
    const csv = buildPeakCsv([{ fileName: "DANI_NOV_A11.fsa", abif: abi }], 5, GS500_LIZ);
    // No BOM at the start
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    // Header is plain ASCII
    const firstLine = csv.split("\n")[0] ?? "";
    for (let i = 0; i < firstLine.length; i++) {
      expect(firstLine.charCodeAt(i)).toBeLessThan(0x80);
    }
  });

  it("balances quotes in every row (no stray escapes)", () => {
    const abi = loadAbif("DANI_NOV_A11.fsa");
    const csv = buildPeakCsv([{ fileName: "DANI_NOV_A11.fsa", abif: abi }], 5, GS500_LIZ);
    for (const row of csv.split("\n")) {
      const quotes = (row.match(/"/g) || []).length;
      expect(quotes % 2).toBe(0);
    }
  });
});
