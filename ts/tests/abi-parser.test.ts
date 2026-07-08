import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../src/abi-parser.ts";

const HEADER_PLUS_ONE_ENTRY = 128 + 28;

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

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

  it("rejects a truncated file where directory extends past end", () => {
    // Valid ABIF header but truncated so the directory doesn't fit
    const truncated = buffer.slice(0, 256);
    expect(() => new AbifFile(truncated)).toThrow("Malformed ABIF: directory extends past");
  });

  it("reports malformed data when entry data extends past end of file", () => {
    // Create a minimal valid ABIF with one directory entry pointing past the end
    const buf = new ArrayBuffer(HEADER_PLUS_ONE_ENTRY);
    const view = new DataView(buf);
    // Magic
    writeAscii(view, 0, "ABIF");
    // Version
    view.setUint16(4, 101);
    // Root dir entry at offset 6: tagName="tdir", tagNumber=1, elemType=1023,
    // elemSize=28, numElems=1, dataSize=28, dataOffset=128
    writeAscii(view, 6, "tdir");
    view.setInt32(10, 1); // tagNumber
    view.setUint16(14, 1023); // elemType
    view.setUint16(16, 28); // elemSize
    view.setInt32(18, 1); // numElems = 1 entry
    view.setInt32(22, 28); // dataSize
    view.setInt32(26, 128); // dataOffset = right after header

    // One directory entry at offset 128: DATA/1 with dataOffset pointing past end
    writeAscii(view, 128, "DATA");
    view.setInt32(132, 1); // tagNumber
    view.setUint16(136, 4); // elemType = short
    view.setUint16(138, 2); // elemSize
    view.setInt32(140, 100); // numElems
    view.setInt32(144, 200); // dataSize = 200 bytes
    view.setInt32(148, 99999); // dataOffset = way past end

    const abi = new AbifFile(buf);
    expect(() => abi.getData("DATA", 1)).toThrow("Malformed ABIF: data for DATA/1");
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

  it("returns 0 numDyes and empty collections when Dye# tag is absent", () => {
    // Minimal valid ABIF with no directory entries
    const buf = new ArrayBuffer(HEADER_PLUS_ONE_ENTRY);
    const view = new DataView(buf);
    writeAscii(view, 0, "ABIF");
    view.setUint16(4, 101);
    writeAscii(view, 6, "tdir");
    view.setInt32(10, 1);
    view.setUint16(14, 1023);
    view.setUint16(16, 28);
    view.setInt32(18, 0); // numElems = 0 entries
    view.setInt32(22, 0);
    view.setInt32(26, 128);

    const empty = new AbifFile(buf);
    expect(empty.numDyes).toBe(0);
    expect(empty.dyeNames).toEqual([]);
    expect(empty.rawChannels.size).toBe(0);
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

describe("files with analyzed channels at DATA/9-12 (LIZ 500 regression)", () => {
  // Files processed by the sequencer's analysis software carry baseline-corrected
  // channels at DATA/9-12 and DATA/205 that share the raw scan length. A naive
  // "lowest DATA tags matching numScans" heuristic grabs DATA/9-12 ahead of the
  // real 5th raw channel (DATA/105, the LIZ size standard), so the standard never
  // shows. Reported by users viewing LIZ 500 .fsa files processed by the service.
  const lizFixture = readFileSync(
    resolve(import.meta.dirname, "fixtures/LIZ500_analyzed_C4_A02.fsa"),
  );
  const lizBuffer = lizFixture.buffer.slice(
    lizFixture.byteOffset,
    lizFixture.byteOffset + lizFixture.byteLength,
  );
  const abi = new AbifFile(lizBuffer);

  it("is a 5-dye G5 file with a LIZ channel and analyzed data present", () => {
    expect(abi.numDyes).toBe(5);
    expect(abi.dyeNames).toEqual(["6-FAM", "VIC", "NED", "PET", "LIZ"]);
    // Sanity: the analyzed channels that used to shadow the raw LIZ channel exist.
    expect(abi.getEntry("DATA", 9)?.numElems).toBe(abi.numScans);
  });

  it("maps the 5th raw channel to the LIZ trace at DATA/105, not analyzed DATA/9", () => {
    const nScans = abi.numScans;
    const ch5 = abi.rawChannels.get(5);
    const liz = abi.getData("DATA", 105);
    const analyzed9 = abi.getData("DATA", 9);
    expect(ch5).toBeDefined();
    expect(ch5?.length).toBe(nScans);
    // Channel 5 must be the raw LIZ data (DATA/105), not the analyzed 6-FAM (DATA/9).
    expect(Array.from(ch5 ?? [])).toEqual(Array.from(liz as Int16Array));
    expect(Array.from(ch5 ?? [])).not.toEqual(Array.from(analyzed9 as Int16Array));
  });

  it("exposes exactly 5 raw channels keyed 1-5", () => {
    expect([...abi.rawChannels.keys()]).toEqual([1, 2, 3, 4, 5]);
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
