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
  const dataEnd = entry.dataOffset + entry.dataSize;
  if (dataEnd > data.byteLength) {
    throw new Error(
      `Malformed ABIF: data for ${entry.tagName}/${entry.tagNumber} extends past end of file` +
        ` (need ${dataEnd} bytes, file is ${data.byteLength})`,
    );
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
    const length = Math.min(raw.getUint8(0), raw.byteLength - 1);
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
    const dirEnd = root.dataOffset + root.numElems * DIR_ENTRY_SIZE;
    if (dirEnd > buffer.byteLength) {
      throw new Error(
        `Malformed ABIF: directory extends past end of file (need ${dirEnd} bytes, file is ${buffer.byteLength})`,
      );
    }
    for (let i = 0; i < root.numElems; i++) {
      const offset = root.dataOffset + i * DIR_ENTRY_SIZE;
      const entry = parseDirEntry(this.data, offset);
      this.entries.set(entryKey(entry.tagName, entry.tagNumber), entry);
    }
  }

  /** Look up a directory entry by tag name and number. */
  getEntry(tagName: string, tagNumber: number): DirectoryEntry | undefined {
    return this.entries.get(entryKey(tagName, tagNumber));
  }

  /** Return all directory entries in the file. */
  getAllEntries(): DirectoryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Decode and return the value for a directory entry. Throws if not found.
   *
   * Return type depends on the entry's element type:
   *  - 1 (byte), 2 (char) → Uint8Array
   *  - 3 (word)            → Uint16Array
   *  - 4 (short)           → Int16Array
   *  - 5 (long)            → Int32Array
   *  - 7 (float)           → Float32Array
   *  - 8 (double)          → Float64Array
   *  - 10 (date)           → AbifDate
   *  - 11 (time)           → AbifTime
   *  - 13 (bool)           → boolean
   *  - 18 (pString)        → string
   *  - 19 (cString)        → string
   *  - other               → Uint8Array (raw bytes)
   */
  getData(tagName: string, tagNumber: number): AbifValue {
    const entry = this.entries.get(entryKey(tagName, tagNumber));
    if (entry === undefined) {
      throw new Error(`Entry not found: ${tagName}/${tagNumber}`);
    }
    return decodeEntry(this.data, entry);
  }

  /** Like {@link getData} but returns null instead of throwing when the entry is missing. */
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

  private getFirstNumberOrNull(tagName: string, tagNumber: number): number | null {
    const value = this.getDataOrNull(tagName, tagNumber);
    if (
      value instanceof Int16Array ||
      value instanceof Int32Array ||
      value instanceof Uint16Array ||
      value instanceof Float32Array ||
      value instanceof Float64Array
    ) {
      return value[0] ?? null;
    }
    return null;
  }

  get numDyes(): number {
    const value = this.getDataOrNull("Dye#", 1);
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
      const wl = this.getFirstNumberOrNull("DyeW", i);
      if (wl !== null) wavelengths.push(wl);
    }
    return wavelengths;
  }

  get numScans(): number | null {
    return this.getFirstNumberOrNull("SCAN", 1);
  }

  /**
   * DATA tag numbers for raw channels, ordered by dye index.
   *
   * Raw channels have numElems === numScans and live at canonical ABIF tag
   * numbers: DATA/1-4 for the first four dyes, then DATA/105, 106, 107… for the
   * fifth dye onward.
   *
   * Files that have been through analysis software (GeneMapper, the sequencer's
   * data collection, etc.) additionally carry analyzed/baseline-corrected
   * channels at DATA/9-12 and DATA/205+ — these share the raw scan length, so a
   * naive "lowest DATA tags matching numScans" heuristic wrongly grabs DATA/9-12
   * ahead of DATA/105 and drops the last raw dye (e.g. the LIZ size standard).
   */
  private get rawDataTags(): number[] {
    const nScans = this.numScans;
    // Canonical raw tag for the i-th dye (0-based): 1-4, then 105, 106, 107…
    const canonical = Array.from({ length: this.numDyes }, (_, i) => (i < 4 ? i + 1 : 101 + i));
    if (nScans === null) return canonical;

    const present = canonical.filter((tagNumber) => {
      const entry = this.entries.get(entryKey("DATA", tagNumber));
      return entry !== undefined && entry.numElems === nScans;
    });
    if (present.length === this.numDyes) return present;

    // Fallback for files that deviate from the canonical layout: take raw-length
    // DATA tags but skip the known analyzed ranges (9-12 and 205-299).
    const isAnalyzed = (t: number): boolean => (t >= 9 && t <= 12) || (t >= 205 && t <= 299);
    const tags: number[] = [];
    for (const entry of this.entries.values()) {
      if (entry.tagName === "DATA" && entry.numElems === nScans && !isAnalyzed(entry.tagNumber)) {
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
        const arr = toInt16Array(value);
        if (arr !== null) {
          channels.set(i + 1, arr);
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
        const arr = toInt16Array(value);
        if (arr !== null) {
          channels.set(entry.tagNumber, arr);
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
    return this.getFirstNumberOrNull("InVt", 1);
  }

  get injectionTime(): number | null {
    return this.getFirstNumberOrNull("InSc", 1);
  }

  get plateType(): string | null {
    return this.getStringOrNull("PTYP", 1);
  }

  get runName(): string | null {
    return this.getStringOrNull("RunN", 1);
  }

  get lane(): number | null {
    return this.getFirstNumberOrNull("LANE", 1);
  }

  get sizeStandard(): string | null {
    return this.getStringOrNull("GTyp", 1);
  }
}

// --- Helpers ---

function toInt16Array(value: AbifValue): Int16Array | null {
  if (value instanceof Int16Array) return value;
  if (
    value instanceof Int32Array ||
    value instanceof Uint16Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  ) {
    return Int16Array.from(value);
  }
  return null;
}

// --- Type guards ---

function isAbifDate(value: AbifValue | null): value is AbifDate {
  return value !== null && typeof value === "object" && "year" in value && "month" in value;
}

function isAbifTime(value: AbifValue | null): value is AbifTime {
  return value !== null && typeof value === "object" && "hour" in value && "minute" in value;
}
