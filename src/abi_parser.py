"""Parser for Applied Biosystems ABIF (ABI) binary files (.ab1, .fsa).

The ABIF format stores Sanger sequencing and fragment analysis data.
File structure:
  - 128-byte header: "ABIF" magic, version, root directory entry
  - Directory entries: 28 bytes each, indexing tagged data elements
  - Data blocks: raw channel traces, metadata, dye info, etc.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import date, time
from pathlib import Path

# ABIF element type codes
ELEM_TYPES = {
    1: "byte",
    2: "char",
    3: "word",
    4: "short",
    5: "long",
    7: "float",
    8: "double",
    10: "date",
    11: "time",
    13: "bool",
    18: "pString",
    19: "cString",
    1023: "directory",
}

DIR_ENTRY_SIZE = 28
HEADER_SIZE = 128


@dataclass
class DirectoryEntry:
    tag_name: str
    tag_number: int
    elem_type: int
    elem_size: int
    num_elems: int
    data_size: int
    data_offset: int

    @property
    def key(self) -> tuple[str, int]:
        return (self.tag_name, self.tag_number)


class AbifFile:
    """Parsed ABIF file providing access to all tagged data entries."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        with open(self.path, "rb") as fh:
            self._data = fh.read()
        self._entries: dict[tuple[str, int], DirectoryEntry] = {}
        self._parse()

    def _parse(self):
        data = self._data
        if len(data) < HEADER_SIZE:
            msg = f"File too small to be ABIF: {len(data)} bytes"
            raise ValueError(msg)

        magic = data[:4]
        if magic != b"ABIF":
            msg = f"Not an ABIF file (magic: {magic!r})"
            raise ValueError(msg)

        self.version = struct.unpack(">H", data[4:6])[0]

        root = self._parse_dir_entry(data[6:34])
        num_entries = root.num_elems
        dir_offset = root.data_offset

        for i in range(num_entries):
            offset = dir_offset + i * DIR_ENTRY_SIZE
            entry = self._parse_dir_entry(data[offset : offset + DIR_ENTRY_SIZE])
            self._entries[entry.key] = entry

    @staticmethod
    def _parse_dir_entry(raw: bytes) -> DirectoryEntry:
        tag_name = raw[:4].decode("ascii")
        tag_number = struct.unpack(">i", raw[4:8])[0]
        elem_type = struct.unpack(">H", raw[8:10])[0]
        elem_size = struct.unpack(">H", raw[10:12])[0]
        num_elems = struct.unpack(">i", raw[12:16])[0]
        data_size = struct.unpack(">i", raw[16:20])[0]
        data_offset = struct.unpack(">i", raw[20:24])[0]
        return DirectoryEntry(
            tag_name=tag_name,
            tag_number=tag_number,
            elem_type=elem_type,
            elem_size=elem_size,
            num_elems=num_elems,
            data_size=data_size,
            data_offset=data_offset,
        )

    def _get_raw_data(self, entry: DirectoryEntry) -> bytes:
        if entry.data_size <= 4:
            return struct.pack(">i", entry.data_offset)[: entry.data_size]
        return self._data[entry.data_offset : entry.data_offset + entry.data_size]

    def get_entry(self, tag_name: str, tag_number: int) -> DirectoryEntry | None:
        return self._entries.get((tag_name, tag_number))

    @property
    def entries(self) -> list[DirectoryEntry]:
        return list(self._entries.values())

    def get_data(self, tag_name: str, tag_number: int) -> object:
        """Return the decoded value for a directory entry.

        Decoding depends on the element type:
          - short (4): tuple of signed 16-bit ints
          - long (5): tuple of signed 32-bit ints
          - float (7): tuple of 32-bit floats
          - double (8): tuple of 64-bit floats
          - word (3): tuple of unsigned 16-bit ints
          - byte (1): raw bytes
          - char (2): bytes
          - pString (18): str (Pascal string)
          - cString (19): str (C string)
          - date (10): datetime.date
          - time (11): datetime.time
          - bool (13): bool
          - other: raw bytes
        """
        entry = self._entries.get((tag_name, tag_number))
        if entry is None:
            msg = f"Entry not found: {tag_name}/{tag_number}"
            raise KeyError(msg)
        return self._decode_entry(entry)

    def _decode_entry(self, entry: DirectoryEntry) -> object:
        raw = self._get_raw_data(entry)
        elem_type = entry.elem_type
        num_elems = entry.num_elems

        if elem_type == 1:  # byte
            return raw
        if elem_type == 2:  # char
            return raw
        if elem_type == 3:  # word (unsigned short)
            return struct.unpack(f">{num_elems}H", raw)
        if elem_type == 4:  # short (signed)
            return struct.unpack(f">{num_elems}h", raw)
        if elem_type == 5:  # long (signed 32-bit)
            return struct.unpack(f">{num_elems}i", raw)
        if elem_type == 7:  # float
            return struct.unpack(f">{num_elems}f", raw)
        if elem_type == 8:  # double
            return struct.unpack(f">{num_elems}d", raw)
        if elem_type == 10:  # date
            year = struct.unpack(">H", raw[0:2])[0]
            month = raw[2]
            day = raw[3]
            return date(year, month, day)
        if elem_type == 11:  # time
            return time(raw[0], raw[1], raw[2], raw[3] * 10000)
        if elem_type == 13:  # bool
            return raw[0] != 0
        if elem_type == 18:  # pString
            length = raw[0]
            return raw[1 : 1 + length].decode("ascii", errors="replace")
        if elem_type == 19:  # cString
            return raw.rstrip(b"\x00").decode("ascii", errors="replace")

        return raw

    def get_data_or_none(self, tag_name: str, tag_number: int) -> object:
        """Like get_data but returns None if the entry does not exist."""
        try:
            return self.get_data(tag_name, tag_number)
        except KeyError:
            return None

    # --- Convenience properties for common fields ---

    @property
    def num_dyes(self) -> int:
        result = self.get_data("Dye#", 1)
        return result[0]

    @property
    def dye_names(self) -> list[str]:
        names = []
        for i in range(1, self.num_dyes + 1):
            name = self.get_data_or_none("DyeN", i)
            if name is not None:
                names.append(name)
        return names

    @property
    def dye_wavelengths(self) -> list[int]:
        wavelengths = []
        for i in range(1, self.num_dyes + 1):
            wl = self.get_data_or_none("DyeW", i)
            if wl is not None:
                wavelengths.append(wl[0])
        return wavelengths

    @property
    def _raw_data_tags(self) -> list[int]:
        """DATA tag numbers for raw channels, ordered by dye index.

        Raw channels have num_elems == num_scans. Typically DATA/1-4 for the
        first 4 dyes and DATA/105+ for additional dyes (e.g. 5-dye .fsa files).
        """
        n_scans = self.num_scans
        if n_scans is None:
            return list(range(1, self.num_dyes + 1))
        raw_tags = sorted(
            e.tag_number
            for e in self._entries.values()
            if e.tag_name == "DATA" and e.num_elems == n_scans
        )
        return raw_tags[: self.num_dyes]

    @property
    def raw_channels(self) -> dict[int, tuple[int, ...]]:
        """Raw fluorescence data keyed by dye index (1-based)."""
        channels = {}
        for dye_idx, tag_num in enumerate(self._raw_data_tags, start=1):
            channels[dye_idx] = self.get_data("DATA", tag_num)
        return channels

    @property
    def analyzed_channels(self) -> dict[int, tuple[int, ...]] | None:
        """Analyzed/sized channel data, if present.

        These are DATA entries whose length differs from the raw scan count.
        """
        raw_tags = set(self._raw_data_tags)
        channels = {}
        for entry in self._entries.values():
            if entry.tag_name == "DATA" and entry.tag_number not in raw_tags:
                channels[entry.tag_number] = self.get_data("DATA", entry.tag_number)
        if not channels:
            return None
        return channels

    @property
    def sample_name(self) -> str | None:
        return self.get_data_or_none("SpNm", 1)

    @property
    def well(self) -> str | None:
        return self.get_data_or_none("TUBE", 1)

    @property
    def machine_name(self) -> str | None:
        return self.get_data_or_none("MCHN", 1)

    @property
    def machine_model(self) -> str | None:
        val = self.get_data_or_none("MODL", 1)
        if isinstance(val, bytes):
            return val.decode("ascii", errors="replace")
        return val

    @property
    def run_start_date(self) -> date | None:
        return self.get_data_or_none("RUND", 1)

    @property
    def run_stop_date(self) -> date | None:
        return self.get_data_or_none("RUND", 2)

    @property
    def run_start_time(self) -> time | None:
        return self.get_data_or_none("RUNT", 1)

    @property
    def run_stop_time(self) -> time | None:
        return self.get_data_or_none("RUNT", 2)

    @property
    def dye_set_name(self) -> str | None:
        return self.get_data_or_none("DySN", 1)

    @property
    def software_version(self) -> str | None:
        return self.get_data_or_none("SVER", 1)

    @property
    def num_scans(self) -> int | None:
        result = self.get_data_or_none("SCAN", 1)
        if result is not None:
            return result[0]
        return None

    @property
    def injection_voltage(self) -> float | None:
        result = self.get_data_or_none("InVt", 1)
        if result is not None:
            return result[0]
        return None

    @property
    def injection_time(self) -> float | None:
        result = self.get_data_or_none("InSc", 1)
        if result is not None:
            return result[0]
        return None

    @property
    def plate_type(self) -> str | None:
        return self.get_data_or_none("PTYP", 1)

    @property
    def run_name(self) -> str | None:
        return self.get_data_or_none("RunN", 1)

    @property
    def lane(self) -> int | None:
        result = self.get_data_or_none("LANE", 1)
        if result is not None:
            return result[0]
        return None

    @property
    def size_standard(self) -> str | None:
        return self.get_data_or_none("GTyp", 1)

    @property
    def offscale_scans(self) -> tuple[float, ...] | None:
        return self.get_data_or_none("OfSc", 1)

    def __repr__(self) -> str:
        return f"AbifFile({self.path.name!r}, version={self.version}, entries={len(self._entries)})"
