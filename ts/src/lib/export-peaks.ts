/**
 * Generate a CSV report of detected peaks across all samples.
 *
 * One row per detected peak in every channel except the standard (the ladder
 * peaks are the calibration input, not data of interest). Peaks are detected
 * with the same noise-floor criterion as the rest of the app, and the
 * start-of-run artifacts (primer residuals, dye blobs) are excluded: when the
 * lane is calibrated, only peaks at or after the first matched standard peak are
 * kept; otherwise signal-based injection detection provides the cutoff. The bp
 * column is empty when the sample has no calibration or when the peak falls
 * outside the calibrated range.
 */

import type { AbifFile } from "../abi-parser.ts";
import { Electropherogram } from "../domain/electropherogram.ts";
import { findInjectionEnd } from "../domain/injection-detection.ts";
import { SizeCalibration } from "../domain/size-calibration.ts";
import type { SizeLadder } from "../domain/size-ladder.ts";

export interface ExportInput {
  readonly fileName: string;
  readonly abif: AbifFile;
}

const HEADER = ["sample", "well", "channel", "scan", "bp", "height", "prominence"] as const;

/**
 * Build a CSV string with one row per peak across all samples and channels,
 * excluding the standard channel. Returns just the header when no peaks found.
 */
export function buildPeakCsv(
  files: readonly ExportInput[],
  standardChannel: number,
  ladder: SizeLadder,
): string {
  const rows: string[] = [HEADER.join(",")];

  for (const { fileName, abif } of files) {
    const dyeNames = abif.dyeNames;
    const calibration = buildCalibration(abif, standardChannel, ladder, dyeNames, fileName);

    for (const [channelNumber, data] of abif.rawChannels) {
      if (channelNumber === standardChannel) continue;
      rows.push(...channelRows(abif, channelNumber, data, calibration, fileName));
    }
  }

  return rows.join("\n");
}

/** CSV rows for one channel's real peaks (start-of-run artifacts excluded). */
function channelRows(
  abif: AbifFile,
  channelNumber: number,
  data: Int16Array,
  calibration: SizeCalibration | null,
  fileName: string,
): string[] {
  const ep = new Electropherogram({
    data,
    dyeName: abif.dyeNames[channelNumber - 1] ?? "",
    sampleName: abif.sampleName ?? fileName,
    well: abif.well ?? "",
    fileName,
  });

  const startScan = artifactCutoffScan(calibration, data);
  return ep.peaks
    .filter((peak) => peak.position >= startScan)
    .map((peak) => peakRow(ep, peak, calibration));
}

/**
 * Scan position where real data begins, used to drop start-of-run artifacts.
 * When the lane is calibrated, the first matched standard peak marks where the
 * smallest real fragment migrates out; everything before it is injection
 * artifact. Without a calibration, fall back to signal-based injection detection
 * on the channel itself.
 */
function artifactCutoffScan(calibration: SizeCalibration | null, data: Int16Array): number {
  return calibration ? calibration.minScan : findInjectionEnd(data);
}

function buildCalibration(
  abif: AbifFile,
  standardChannel: number,
  ladder: SizeLadder,
  dyeNames: readonly string[],
  fileName: string,
): SizeCalibration | null {
  if (standardChannel <= 0) return null;
  const data = abif.rawChannels.get(standardChannel);
  if (!data) return null;
  const standard = new Electropherogram({
    data,
    dyeName: dyeNames[standardChannel - 1] ?? "",
    sampleName: abif.sampleName ?? fileName,
    well: abif.well ?? "",
    fileName,
  });
  return SizeCalibration.tryBuild(standard, ladder);
}

function peakRow(
  ep: Electropherogram,
  peak: { position: number; height: number; prominence: number },
  calibration: SizeCalibration | null,
): string {
  const bp = calibration?.scanToBp(peak.position);
  return [
    csvEscape(ep.sampleName),
    csvEscape(ep.well),
    csvEscape(ep.dyeName),
    peak.position.toString(),
    bp == null ? "" : bp.toFixed(2),
    peak.height.toString(),
    peak.prominence.toFixed(0),
  ].join(",");
}

/** RFC 4180 CSV field escaping: wrap in quotes if needed, double any internal quotes. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Trigger a browser download of the given text content as a file.
 *
 * No UTF-8 BOM is added — sample/well/dye names in ABIF files are ASCII in
 * practice, and a BOM renders as garbage bytes when the file is opened in
 * non-UTF-8 encodings (e.g., Latin-1). If Unicode content appears later we
 * can revisit.
 */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
