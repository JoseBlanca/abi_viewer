import { forwardRef, useMemo } from "react";
import type { AbifFile } from "../abi-parser.ts";
import { Electropherogram } from "../domain/electropherogram.ts";
import { SizeCalibration } from "../domain/size-calibration.ts";
import type { SizeLadder } from "../domain/size-ladder.ts";
import type { XAxisMode } from "./App.tsx";
import type { WidgetChangeEvent, WidgetHandle } from "./ElectropherogramWidget.tsx";
import { ElectropherogramWidget } from "./ElectropherogramWidget.tsx";

interface SampleWidgetProps {
  readonly fileName: string;
  readonly abif: AbifFile;
  readonly selectedChannel: number;
  readonly standardChannel: number;
  readonly showStandardOverlay: boolean;
  readonly ladder: SizeLadder;
  readonly xAxisMode: XAxisMode;
  readonly onWidgetChange?: ((event: WidgetChangeEvent) => void) | undefined;
}

/**
 * Constructs memoized Electropherogram instances from the AbifFile, computes
 * size calibration from the standard channel, and hands them to the rendering
 * widget. Memoization keeps lazy caches alive across parent re-renders.
 */
export const SampleWidget = forwardRef<WidgetHandle, SampleWidgetProps>(function SampleWidget(
  {
    fileName,
    abif,
    selectedChannel,
    standardChannel,
    showStandardOverlay,
    ladder,
    xAxisMode,
    onWidgetChange,
  },
  ref,
) {
  const dyeNames = abif.dyeNames;
  const sampleName = abif.sampleName ?? fileName;
  const well = abif.well ?? "";

  const primary = useMemo(() => {
    const data = abif.rawChannels.get(selectedChannel);
    if (!data) return null;
    return new Electropherogram({
      data,
      dyeName: dyeNames[selectedChannel - 1] ?? "",
      sampleName,
      well,
      fileName,
    });
  }, [abif, selectedChannel, dyeNames, sampleName, well, fileName]);

  // The standard channel's electropherogram — always constructed when a
  // standard channel is selected, so we can calibrate even when not overlaying.
  const standardEp = useMemo(() => {
    if (standardChannel <= 0) return null;
    const data = abif.rawChannels.get(standardChannel);
    if (!data) return null;
    return new Electropherogram({
      data,
      dyeName: dyeNames[standardChannel - 1] ?? "",
      sampleName,
      well,
      fileName,
    });
  }, [abif, standardChannel, dyeNames, sampleName, well, fileName]);

  const calibration = useMemo(() => {
    if (!standardEp) return null;
    return SizeCalibration.tryBuild(standardEp, ladder);
  }, [standardEp, ladder]);

  if (!primary) return null;

  const label = well ? `${well} — ${sampleName}` : sampleName;
  const overlay = showStandardOverlay ? standardEp : null;

  return (
    <ElectropherogramWidget
      ref={ref}
      label={label}
      primary={primary}
      standard={overlay}
      calibration={calibration}
      xAxisMode={xAxisMode}
      onWidgetChange={onWidgetChange}
    />
  );
});
