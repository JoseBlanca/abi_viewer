import { forwardRef, useMemo } from "react";
import type { AbifFile } from "../abi-parser.ts";
import { Electropherogram } from "../domain/electropherogram.ts";
import type {
  ViewportCommand,
  WidgetChangeEvent,
  WidgetHandle,
} from "./ElectropherogramWidget.tsx";
import { ElectropherogramWidget } from "./ElectropherogramWidget.tsx";

interface SampleWidgetProps {
  readonly fileName: string;
  readonly abif: AbifFile;
  readonly selectedChannel: number;
  readonly standardChannel: number;
  readonly viewportCommand?: ViewportCommand | undefined;
  readonly onWidgetChange?: ((event: WidgetChangeEvent) => void) | undefined;
}

/**
 * Constructs memoized Electropherogram instances from the AbifFile and hands
 * them to the rendering widget. Memoization keeps the class's lazy peak cache
 * alive across parent re-renders.
 */
export const SampleWidget = forwardRef<WidgetHandle, SampleWidgetProps>(function SampleWidget(
  { fileName, abif, selectedChannel, standardChannel, viewportCommand, onWidgetChange },
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

  const standard = useMemo(() => {
    if (standardChannel <= 0 || standardChannel === selectedChannel) return null;
    const data = abif.rawChannels.get(standardChannel);
    if (!data) return null;
    return new Electropherogram({
      data,
      dyeName: dyeNames[standardChannel - 1] ?? "",
      sampleName,
      well,
      fileName,
    });
  }, [abif, standardChannel, selectedChannel, dyeNames, sampleName, well, fileName]);

  if (!primary) return null;

  const label = well ? `${well} — ${sampleName}` : sampleName;

  return (
    <ElectropherogramWidget
      ref={ref}
      label={label}
      primary={primary}
      standard={standard}
      viewportCommand={viewportCommand}
      onWidgetChange={onWidgetChange}
    />
  );
});
