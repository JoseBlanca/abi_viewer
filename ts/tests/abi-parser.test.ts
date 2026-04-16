import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../src/abi-parser.ts";

const fixtureBuffer = readFileSync(resolve(import.meta.dirname, "fixtures/DANI_NOV_A11.fsa"));
const buffer = fixtureBuffer.buffer.slice(
  fixtureBuffer.byteOffset,
  fixtureBuffer.byteOffset + fixtureBuffer.byteLength,
);

describe("AbifFile constructor", () => {
  it("rejects a buffer that is too small", () => {
    expect(() => new AbifFile(new ArrayBuffer(10))).toThrow("too small");
  });

  it("rejects a buffer with wrong magic", () => {
    const bad = new ArrayBuffer(128);
    const view = new DataView(bad);
    view.setUint8(0, 0x58); // 'X'
    expect(() => new AbifFile(bad)).toThrow("Not an ABIF file");
  });

  it("parses version from the header", () => {
    const abi = new AbifFile(buffer);
    expect(abi.version).toBe(101);
  });

  it("parses all 88 directory entries", () => {
    const abi = new AbifFile(buffer);
    expect(abi.getAllEntries().length).toBe(88);
  });
});

describe("metadata", () => {
  const abi = new AbifFile(buffer);

  it("reads sample name", () => {
    expect(abi.sampleName).toBe("DANI_NOV");
  });

  it("reads well", () => {
    expect(abi.well).toBe("A11");
  });

  it("reads machine name", () => {
    expect(abi.machineName).toBe("ABI3130-1583-016");
  });

  it("reads machine model", () => {
    expect(abi.machineModel).toBe("3100");
  });

  it("reads software version", () => {
    expect(abi.softwareVersion).toBe("4.0");
  });

  it("reads plate type", () => {
    expect(abi.plateType).toBe("96-Well");
  });

  it("reads run name", () => {
    expect(abi.runName).toBe("Run_ABI3130_2020-01-14_10-32_3666");
  });

  it("reads lane", () => {
    expect(abi.lane).toBe(1);
  });
});

describe("run dates and times", () => {
  const abi = new AbifFile(buffer);

  it("reads run start date", () => {
    expect(abi.runStartDate).toEqual({ year: 2020, month: 1, day: 14 });
  });

  it("reads run stop date", () => {
    expect(abi.runStopDate).toEqual({ year: 2020, month: 1, day: 14 });
  });

  it("reads run start time", () => {
    const t = abi.runStartTime;
    expect(t).not.toBeNull();
    expect(t?.hour).toBe(10);
    expect(t?.minute).toBe(32);
    expect(t?.second).toBe(57);
  });

  it("reads run stop time", () => {
    const t = abi.runStopTime;
    expect(t).not.toBeNull();
    expect(t?.hour).toBe(11);
    expect(t?.minute).toBe(26);
    expect(t?.second).toBe(55);
  });
});

describe("dye information", () => {
  const abi = new AbifFile(buffer);

  it("reads number of dyes", () => {
    expect(abi.numDyes).toBe(5);
  });

  it("reads dye names", () => {
    expect(abi.dyeNames).toEqual(["6-FAM", "VIC", "NED", "PET", "LIZ"]);
  });

  it("reads dye wavelengths", () => {
    expect(abi.dyeWavelengths).toEqual([522, 554, 575, 595, 655]);
  });

  it("reads dye set name", () => {
    expect(abi.dyeSetName).toBe("G5");
  });
});

describe("instrument settings", () => {
  const abi = new AbifFile(buffer);

  it("reads injection voltage", () => {
    expect(abi.injectionVoltage).toBe(1600);
  });

  it("reads injection time", () => {
    expect(abi.injectionTime).toBe(15);
  });

  it("reads number of scans", () => {
    expect(abi.numScans).toBe(8959);
  });
});

describe("raw channel data", () => {
  const abi = new AbifFile(buffer);

  it("returns 5 raw channels keyed by dye index", () => {
    const channels = abi.rawChannels;
    expect(channels.size).toBe(5);
    expect([...channels.keys()]).toEqual([1, 2, 3, 4, 5]);
  });

  it("raw channels have 8959 data points each", () => {
    for (const [, data] of abi.rawChannels) {
      expect(data.length).toBe(8959);
    }
  });

  it("channel 1 (6-FAM) has expected range", () => {
    const ch1 = abi.rawChannels.get(1);
    expect(ch1).toBeDefined();
    if (ch1) {
      let min = ch1[0] ?? 0;
      let max = ch1[0] ?? 0;
      for (const v of ch1) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(min).toBe(-652);
      expect(max).toBe(8841);
    }
  });

  it("correctly identifies DATA/105 as the 5th raw channel", () => {
    // DATA/105 is the raw LIZ channel, not DATA/5 (which is analyzed data).
    // Verify channel 5 has the full scan count, not the analyzed count.
    const ch5 = abi.rawChannels.get(5);
    expect(ch5).toBeDefined();
    expect(ch5?.length).toBe(8959);
  });
});

describe("analyzed channel data", () => {
  const abi = new AbifFile(buffer);

  it("returns analyzed channels separate from raw", () => {
    const analyzed = abi.analyzedChannels;
    expect(analyzed).not.toBeNull();
    if (analyzed) {
      // DATA/5-8 are analyzed (636 points each)
      expect(analyzed.has(5)).toBe(true);
      expect(analyzed.has(8)).toBe(true);
      const data5 = analyzed.get(5);
      expect(data5?.length).toBe(636);
    }
  });
});

describe("getData type decoding", () => {
  const abi = new AbifFile(buffer);

  it("decodes pString (type 18)", () => {
    const value = abi.getData("DyeN", 1);
    expect(value).toBe("6-FAM");
  });

  it("decodes cString (type 19)", () => {
    const value = abi.getData("PTYP", 1);
    expect(value).toBe("96-Well");
  });

  it("decodes short array (type 4)", () => {
    const value = abi.getData("DATA", 1);
    expect(value).toBeInstanceOf(Int16Array);
  });

  it("decodes date (type 10)", () => {
    const value = abi.getData("RUND", 1);
    expect(value).toEqual({ year: 2020, month: 1, day: 14 });
  });

  it("decodes time (type 11)", () => {
    const value = abi.getData("RUNT", 1);
    expect(value).toHaveProperty("hour", 10);
    expect(value).toHaveProperty("minute", 32);
  });

  it("throws for nonexistent entries", () => {
    expect(() => abi.getData("NOPE", 999)).toThrow("Entry not found");
  });

  it("returns null for nonexistent entries via getDataOrNull", () => {
    expect(abi.getDataOrNull("NOPE", 999)).toBeNull();
  });
});
