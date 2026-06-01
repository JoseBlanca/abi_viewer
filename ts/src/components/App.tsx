import { useCallback, useMemo, useRef, useState } from "react";
import { AbifFile } from "../abi-parser.ts";
import { Electropherogram } from "../domain/electropherogram.ts";
import { SizeCalibration } from "../domain/size-calibration.ts";
import type { SizeLadder } from "../domain/size-ladder.ts";
import { DEFAULT_LADDER, LADDERS } from "../domain/size-ladder.ts";
import type { XAxisMode } from "../domain/x-domain.ts";
import { computeSharedDomain } from "../domain/x-domain.ts";
import { buildPeakCsv, downloadTextFile } from "../lib/export-peaks.ts";
import { ChannelSelector } from "./ChannelSelector.tsx";
import type { WidgetChangeEvent, WidgetHandle } from "./ElectropherogramWidget.tsx";
import { ElectropherogramWidget } from "./ElectropherogramWidget.tsx";
import { FileUpload } from "./FileUpload.tsx";

export type { XAxisMode } from "../domain/x-domain.ts";

interface LoadedFile {
  readonly name: string;
  readonly abif: AbifFile;
}

interface SampleData {
  readonly name: string;
  readonly primary: Electropherogram;
  readonly standard: Electropherogram | null;
  readonly calibration: SizeCalibration | null;
  readonly label: string;
}

/**
 * Build the derived traces and calibration for one loaded file. Returns null
 * when the selected channel has no data (nothing to render for that sample).
 */
function buildSample(
  file: LoadedFile,
  selectedChannel: number,
  standardChannel: number,
  ladder: SizeLadder,
): SampleData | null {
  const { name, abif } = file;
  const names = abif.dyeNames;
  const sampleName = abif.sampleName ?? name;
  const well = abif.well ?? "";
  const meta = { sampleName, well, fileName: name };

  const primaryData = abif.rawChannels.get(selectedChannel);
  if (!primaryData) return null;
  const primary = new Electropherogram({
    data: primaryData,
    dyeName: names[selectedChannel - 1] ?? "",
    ...meta,
  });

  const standardData = standardChannel > 0 ? abif.rawChannels.get(standardChannel) : undefined;
  const standard = standardData
    ? new Electropherogram({
        data: standardData,
        dyeName: names[standardChannel - 1] ?? "",
        ...meta,
      })
    : null;
  const calibration = standard ? SizeCalibration.tryBuild(standard, ladder) : null;
  const label = well ? `${well} — ${sampleName}` : sampleName;

  return { name, primary, standard, calibration, label };
}

const EXAMPLE_FILES = [
  "DANI_NOV_A11.fsa",
  "DANI_NOV_A12.fsa",
  "DANI_NOV_G11.fsa",
  "DANI_NOV_H12.fsa",
];

export function App() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [selectedChannel, setSelectedChannel] = useState(1);
  const [standardChannel, setStandardChannel] = useState(0);
  const [widgetsLocked, setWidgetsLocked] = useState(true);
  const [ladder, setLadder] = useState<SizeLadder>(DEFAULT_LADDER);
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>("scan");

  const widgetRefsMap = useRef(new Map<string, WidgetHandle>());

  const handleFilesLoaded = useCallback(
    (newFiles: { name: string; buffer: ArrayBuffer }[]) => {
      const loaded: LoadedFile[] = [];
      for (const { name, buffer } of newFiles) {
        try {
          loaded.push({ name, abif: new AbifFile(buffer) });
        } catch (e) {
          console.error(`Failed to parse ${name}:`, e);
        }
      }
      setFiles((prev) => {
        const combined = [...prev, ...loaded];
        if (prev.length === 0 && loaded.length > 0 && loaded[0] !== undefined) {
          const numDyes = loaded[0].abif.numDyes;
          if (numDyes > 0 && standardChannel === 0) {
            setStandardChannel(numDyes);
          }
        }
        return combined;
      });
    },
    [standardChannel],
  );

  const handleLoadExamples = useCallback(async () => {
    const results: { name: string; buffer: ArrayBuffer }[] = [];
    for (const name of EXAMPLE_FILES) {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/${name}`);
      if (response.ok) {
        results.push({ name, buffer: await response.arrayBuffer() });
      }
    }
    if (results.length > 0) {
      handleFilesLoaded(results);
    }
  }, [handleFilesLoaded]);

  // Locked widgets: broadcast changes from one widget to all others
  const widgetsLockedRef = useRef(widgetsLocked);
  widgetsLockedRef.current = widgetsLocked;

  const handleWidgetChange = useCallback((sourceName: string, event: WidgetChangeEvent) => {
    if (!widgetsLockedRef.current) return;

    for (const [name, handle] of widgetRefsMap.current) {
      if (name === sourceName) continue;

      switch (event.type) {
        case "pan":
          handle.panBy(event.value);
          break;
        case "xZoom":
          handle.setXZoom(event.value);
          break;
        case "yScale":
          handle.setYScale(event.value);
          break;
        case "standardYScale":
          handle.setStandardYScale(event.value);
          break;
      }
    }
  }, []);

  const handleDownloadResults = useCallback(() => {
    const csv = buildPeakCsv(
      files.map(({ name, abif }) => ({ fileName: name, abif })),
      standardChannel,
      ladder,
    );
    downloadTextFile(csv, "peaks.csv", "text/csv");
  }, [files, standardChannel, ladder]);

  const dyeNames = files.length > 0 && files[0] !== undefined ? files[0].abif.dyeNames : [];
  const showStandard = standardChannel > 0 && standardChannel !== selectedChannel;

  // Per-sample derived data (primary trace, standard trace, calibration).
  // Built here rather than per-widget so the panels can share a single x-axis
  // domain and stay aligned. Memoized to keep each Electropherogram's lazy peak
  // cache alive across re-renders (e.g. x-axis mode switches, lock toggles).
  const samples = useMemo(
    () =>
      files
        .map((file) => buildSample(file, selectedChannel, standardChannel, ladder))
        .filter((s): s is SampleData => s !== null),
    [files, selectedChannel, standardChannel, ladder],
  );

  // Single x-axis domain shared by every panel, so they line up by default both
  // on load and whenever the x-axis mode changes.
  const sharedDomain = useMemo(
    () =>
      computeSharedDomain(
        xAxisMode,
        samples.map((s) => ({ scanCount: s.primary.scanCount, calibration: s.calibration })),
      ),
    [xAxisMode, samples],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>ABI Viewer</h1>
      </header>

      {files.length === 0 ? (
        <div className="empty-state">
          <FileUpload onFilesLoaded={handleFilesLoaded} />
          <button type="button" className="load-examples-btn" onClick={handleLoadExamples}>
            Load example files
          </button>
        </div>
      ) : (
        <>
          <FileUpload onFilesLoaded={handleFilesLoaded} />
          <div className="toolbar">
            <ChannelSelector
              dyeNames={dyeNames}
              selectedChannel={selectedChannel}
              onChannelChange={setSelectedChannel}
              standardChannel={standardChannel}
              onStandardChange={setStandardChannel}
            />
            {standardChannel > 0 && (
              <>
                <label className="toolbar-field">
                  Ladder:{" "}
                  <select
                    value={
                      Object.entries(LADDERS).find(([, l]) => l === ladder)?.[0] ?? "GS500_LIZ"
                    }
                    onChange={(e) => {
                      const next = LADDERS[e.target.value];
                      if (next) setLadder(next);
                    }}
                  >
                    {Object.entries(LADDERS).map(([key, l]) => (
                      <option key={key} value={key}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toolbar-field">
                  X axis:{" "}
                  <select
                    value={xAxisMode}
                    onChange={(e) => setXAxisMode(e.target.value as XAxisMode)}
                  >
                    <option value="scan">scans</option>
                    <option value="bp">base pairs</option>
                  </select>
                </label>
              </>
            )}
            <label className="toolbar-checkbox">
              <input
                type="checkbox"
                checked={widgetsLocked}
                onChange={(e) => setWidgetsLocked(e.target.checked)}
              />
              Lock widgets
            </label>
            <button type="button" className="download-results-btn" onClick={handleDownloadResults}>
              Download results
            </button>
          </div>
          <div className="widget-list">
            {samples.map(({ name, primary, standard, calibration, label }) => (
              <ElectropherogramWidget
                key={name}
                ref={(handle) => {
                  if (handle) {
                    widgetRefsMap.current.set(name, handle);
                  } else {
                    widgetRefsMap.current.delete(name);
                  }
                }}
                label={label}
                primary={primary}
                standard={showStandard ? standard : null}
                calibration={calibration}
                xAxisMode={xAxisMode}
                domain={sharedDomain}
                onWidgetChange={(event) => handleWidgetChange(name, event)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
