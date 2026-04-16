/**
 * Parser for Applied Biosystems ABIF binary files (.ab1, .fsa).
 *
 * The ABIF format stores Sanger sequencing and fragment analysis data.
 * File structure:
 *   - 128-byte header: "ABIF" magic, version, root directory entry
 *   - Directory entries: 28 bytes each, indexing tagged data elements
 *   - Data blocks: raw channel traces, metadata, dye info, etc.
 *
 * This parser operates on ArrayBuffer so it works in both browser and Node.
 */

const DIR_ENTRY_SIZE = 28;
const HEADER_SIZE = 128;
const INLINE_THRESHOLD = 4;

// --- Types ---

export interface DirectoryEntry {
  readonly tagName: string;
  readonly tagNumber: number;
  readonly elemType: number;
  readonly elemSize: number;
  readonly numElems: number;
  readonly dataSize: number;
  readonly dataOffset: number;
}

export interface AbifDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface AbifTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly hsecond: number;
}

export type AbifValue =
  | Int16Array
  | Int32Array
  | Uint16Array
  | Float32Array
  | Float64Array
  | Uint8Array
  | string
  | AbifDate
  | AbifTime
  | boolean;

// --- Parsing ---

const textDecoder = new TextDecoder("utf-8");

function decodeAscii(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function entryKey(tagName: string, tagNumber: number): string {
  return `${tagName}/${tagNumber}`;
}

function parseDirEntry(view: DataView, offset: number): DirectoryEntry {
  const tagBytes = new Uint8Array(view.buffer, view.byteOffset + offset, 4);
  return {
    tagName: decodeAscii(tagBytes),
    tagNumber: view.getInt32(offset + 4),
    elemType: view.getUint16(offset + 8),
    elemSize: view.getUint16(offset + 10),
    numElems: view.getInt32(offset + 12),
    dataSize: view.getInt32(offset + 16),
    dataOffset: view.getInt32(offset + 20),
  };
}

function getRawData(data: DataView, entry: DirectoryEntry): DataView {
  if (entry.dataSize <= INLINE_THRESHOLD) {
    // Data is stored inline in the offset field (big-endian packed).
    // Reconstruct the 4 bytes from the offset value, then take the first dataSize bytes.
    const buf = new ArrayBuffer(4);
    const tmp = new DataView(buf);
    tmp.setInt32(0, entry.dataOffset);
    return new DataView(buf, 0, entry.dataSize);
  }
  return new DataView(data.buffer, data.byteOffset + entry.dataOffset, entry.dataSize);
}

function readTypedArray(
  numElems: number,
  bytesPerElem: number,
  reader: (offset: number) => number,
  ArrayCtor: {
    new (length: number): Int16Array | Int32Array | Uint16Array | Float32Array | Float64Array;
  },
): Int16Array | Int32Array | Uint16Array | Float32Array | Float64Array {
  const arr = new ArrayCtor(numElems);
  for (let i = 0; i < numElems; i++) {
    arr[i] = reader(i * bytesPerElem);
  }
  return arr;
}

function decodeNumericEntry(raw: DataView, elemType: number, numElems: number): AbifValue | null {
  if (elemType === 3) return readTypedArray(numElems, 2, (o) => raw.getUint16(o), Uint16Array);
  if (elemType === 4) return readTypedArray(numElems, 2, (o) => raw.getInt16(o), Int16Array);
  if (elemType === 5) return readTypedArray(numElems, 4, (o) => raw.getInt32(o), Int32Array);
  if (elemType === 7) return readTypedArray(numElems, 4, (o) => raw.getFloat32(o), Float32Array);
  if (elemType === 8) return readTypedArray(numElems, 8, (o) => raw.getFloat64(o), Float64Array);
  return null;
}

function decodeStringEntry(raw: DataView, elemType: number): string | null {
  if (elemType === 18) {
    const length = raw.getUint8(0);
    return decodeAscii(new Uint8Array(raw.buffer, raw.byteOffset + 1, length));
  }
  if (elemType === 19) {
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return decodeAscii(bytes.subarray(0, end));
  }
  return null;
}

function decodeEntry(data: DataView, entry: DirectoryEntry): AbifValue {
  const raw = getRawData(data, entry);
  const { elemType, numElems } = entry;

  if (elemType === 1 || elemType === 2) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }

  const numeric = decodeNumericEntry(raw, elemType, numElems);
  if (numeric !== null) return numeric;

  const str = decodeStringEntry(raw, elemType);
  if (str !== null) return str;

  if (elemType === 10) {
    return { year: raw.getUint16(0), month: raw.getUint8(2), day: raw.getUint8(3) };
  }
  if (elemType === 11) {
    return {
      hour: raw.getUint8(0),
      minute: raw.getUint8(1),
      second: raw.getUint8(2),
      hsecond: raw.getUint8(3),
    };
  }
  if (elemType === 13) {
    return raw.getUint8(0) !== 0;
  }

  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

// --- Public API ---

export class AbifFile {
  readonly version: number;
  private readonly data: DataView;
  private readonly entries: Map<string, DirectoryEntry>;

  constructor(buffer: ArrayBuffer) {
    if (buffer.byteLength < HEADER_SIZE) {
      throw new Error(`File too small to be ABIF: ${buffer.byteLength} bytes`);
    }

    this.data = new DataView(buffer);

    const magic = decodeAscii(new Uint8Array(buffer, 0, 4));
    if (magic !== "ABIF") {
      throw new Error(`Not an ABIF file (magic: "${magic}")`);
    }

    this.version = this.data.getUint16(4);
    this.entries = new Map();

    const root = parseDirEntry(this.data, 6);
    for (let i = 0; i < root.numElems; i++) {
      const offset = root.dataOffset + i * DIR_ENTRY_SIZE;
      const entry = parseDirEntry(this.data, offset);
      this.entries.set(entryKey(entry.tagName, entry.tagNumber), entry);
    }
  }

  getEntry(tagName: string, tagNumber: number): DirectoryEntry | undefined {
    return this.entries.get(entryKey(tagName, tagNumber));
  }

  getAllEntries(): DirectoryEntry[] {
    return [...this.entries.values()];
  }

  getData(tagName: string, tagNumber: number): AbifValue {
    const entry = this.entries.get(entryKey(tagName, tagNumber));
    if (entry === undefined) {
      throw new Error(`Entry not found: ${tagName}/${tagNumber}`);
    }
    return decodeEntry(this.data, entry);
  }

  getDataOrNull(tagName: string, tagNumber: number): AbifValue | null {
    const entry = this.entries.get(entryKey(tagName, tagNumber));
    if (entry === undefined) {
      return null;
    }
    return decodeEntry(this.data, entry);
  }

  // --- Convenience getters ---

  private getStringOrNull(tagName: string, tagNumber: number): string | null {
    const value = this.getDataOrNull(tagName, tagNumber);
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return decodeAscii(value);
    return null;
  }

  private getFirstIntOrNull(tagName: string, tagNumber: number): number | null {
    const value = this.getDataOrNull(tagName, tagNumber);
    if (
      value instanceof Int16Array ||
      value instanceof Int32Array ||
      value instanceof Uint16Array
    ) {
      return value[0] ?? null;
    }
    return null;
  }

  private getFirstFloatOrNull(tagName: string, tagNumber: number): number | null {
    const value = this.getDataOrNull(tagName, tagNumber);
    if (
      value instanceof Int32Array ||
      value instanceof Float32Array ||
      value instanceof Float64Array
    ) {
      return value[0] ?? null;
    }
    return null;
  }

  get numDyes(): number {
    const value = this.getData("Dye#", 1);
    if (value instanceof Int16Array) return value[0] ?? 0;
    return 0;
  }

  get dyeNames(): string[] {
    const names: string[] = [];
    for (let i = 1; i <= this.numDyes; i++) {
      const name = this.getStringOrNull("DyeN", i);
      if (name !== null) names.push(name);
    }
    return names;
  }

  get dyeWavelengths(): number[] {
    const wavelengths: number[] = [];
    for (let i = 1; i <= this.numDyes; i++) {
      const wl = this.getFirstIntOrNull("DyeW", i);
      if (wl !== null) wavelengths.push(wl);
    }
    return wavelengths;
  }

  get numScans(): number | null {
    return this.getFirstFloatOrNull("SCAN", 1);
  }

  /**
   * DATA tag numbers for raw channels, ordered by dye index.
   * Raw channels have numElems === numScans. Typically DATA/1-4 for the
   * first 4 dyes and DATA/105+ for additional dyes (e.g. 5-dye .fsa files).
   */
  private get rawDataTags(): number[] {
    const nScans = this.numScans;
    if (nScans === null) {
      return Array.from({ length: this.numDyes }, (_, i) => i + 1);
    }
    const tags: number[] = [];
    for (const entry of this.entries.values()) {
      if (entry.tagName === "DATA" && entry.numElems === nScans) {
        tags.push(entry.tagNumber);
      }
    }
    tags.sort((a, b) => a - b);
    return tags.slice(0, this.numDyes);
  }

  /** Raw fluorescence data keyed by dye index (1-based). */
  get rawChannels(): Map<number, Int16Array> {
    const channels = new Map<number, Int16Array>();
    const tags = this.rawDataTags;
    for (let i = 0; i < tags.length; i++) {
      const tagNum = tags[i];
      if (tagNum !== undefined) {
        const value = this.getData("DATA", tagNum);
        if (value instanceof Int16Array) {
          channels.set(i + 1, value);
        }
      }
    }
    return channels;
  }

  /** Analyzed/sized channel data (DATA entries not matching raw scan count). */
  get analyzedChannels(): Map<number, Int16Array> | null {
    const rawTagSet = new Set(this.rawDataTags);
    const channels = new Map<number, Int16Array>();
    for (const entry of this.entries.values()) {
      if (entry.tagName === "DATA" && !rawTagSet.has(entry.tagNumber)) {
        const value = decodeEntry(this.data, entry);
        if (value instanceof Int16Array) {
          channels.set(entry.tagNumber, value);
        }
      }
    }
    return channels.size > 0 ? channels : null;
  }

  get sampleName(): string | null {
    return this.getStringOrNull("SpNm", 1);
  }

  get well(): string | null {
    return this.getStringOrNull("TUBE", 1);
  }

  get machineName(): string | null {
    return this.getStringOrNull("MCHN", 1);
  }

  get machineModel(): string | null {
    return this.getStringOrNull("MODL", 1);
  }

  get runStartDate(): AbifDate | null {
    const value = this.getDataOrNull("RUND", 1);
    return isAbifDate(value) ? value : null;
  }

  get runStopDate(): AbifDate | null {
    const value = this.getDataOrNull("RUND", 2);
    return isAbifDate(value) ? value : null;
  }

  get runStartTime(): AbifTime | null {
    const value = this.getDataOrNull("RUNT", 1);
    return isAbifTime(value) ? value : null;
  }

  get runStopTime(): AbifTime | null {
    const value = this.getDataOrNull("RUNT", 2);
    return isAbifTime(value) ? value : null;
  }

  get dyeSetName(): string | null {
    return this.getStringOrNull("DySN", 1);
  }

  get softwareVersion(): string | null {
    return this.getStringOrNull("SVER", 1);
  }

  get injectionVoltage(): number | null {
    return this.getFirstFloatOrNull("InVt", 1);
  }

  get injectionTime(): number | null {
    return this.getFirstFloatOrNull("InSc", 1);
  }

  get plateType(): string | null {
    return this.getStringOrNull("PTYP", 1);
  }

  get runName(): string | null {
    return this.getStringOrNull("RunN", 1);
  }

  get lane(): number | null {
    return this.getFirstIntOrNull("LANE", 1);
  }

  get sizeStandard(): string | null {
    return this.getStringOrNull("GTyp", 1);
  }
}

// --- Type guards ---

function isAbifDate(value: AbifValue | null): value is AbifDate {
  return value !== null && typeof value === "object" && "year" in value && "month" in value;
}

function isAbifTime(value: AbifValue | null): value is AbifTime {
  return value !== null && typeof value === "object" && "hour" in value && "minute" in value;
}
