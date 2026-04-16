import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("project setup", () => {
  it("reads a binary fixture file", () => {
    const buffer = readFileSync(resolve(fixturesDir, "DANI_NOV_A11.fsa"));

    expect(buffer.length).toBeGreaterThan(0);

    const magic = buffer.subarray(0, 4).toString("ascii");
    expect(magic).toBe("ABIF");
  });

  it("parses the ABIF header version", () => {
    const buffer = readFileSync(resolve(fixturesDir, "DANI_NOV_A11.fsa"));

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const version = view.getUint16(4);
    expect(version).toBe(101);
  });
});
