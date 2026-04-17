/**
 * Generate a CSV report of detected peaks across all samples.
 *
 * One row per detected peak in every channel except the standard (the ladder
 * peaks are the calibration input, not data of interest). The bp column is
 * empty when the sample has no calibration or when the peak falls outside the
 * calibrated range.
 */

import type { AbifFile } from "../abi-parser.ts";
import { Electropherogram } from "../domain/electropherogram.ts";
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

      const ep = new Electropherogram({
        data,
        dyeName: dyeNames[channelNumber - 1] ?? "",
        sampleName: abif.sampleName ?? fileName,
        well: abif.well ?? "",
        fileName,
      });

      for (const peak of ep.peaks) {
        rows.push(peakRow(ep, peak, calibration));
      }
    }
  }

  return rows.join("\n");
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
