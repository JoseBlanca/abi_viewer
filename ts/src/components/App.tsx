import { useCallback, useState } from "react";
import { AbifFile } from "../abi-parser.ts";
import { autoAlignSamples } from "../lib/align-peaks.ts";
import { ChannelSelector } from "./ChannelSelector.tsx";
import { ElectropherogramWidget } from "./ElectropherogramWidget.tsx";
import { FileUpload } from "./FileUpload.tsx";

interface LoadedFile {
  readonly name: string;
  readonly abif: AbifFile;
}

interface ViewportState {
  xCenter: number;
  xZoom: number;
}

export function App() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [selectedChannel, setSelectedChannel] = useState(1);
  const [standardChannel, setStandardChannel] = useState(0);
  const [viewports, setViewports] = useState<Map<string, ViewportState>>(new Map());

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

  const handleViewportChange = useCallback((fileName: string, xCenter: number, xZoom: number) => {
    setViewports((prev) => {
      const next = new Map(prev);
      next.set(fileName, { xCenter, xZoom });
      return next;
    });
  }, []);

  const handleAutoAlign = useCallback(() => {
    if (files.length < 2 || standardChannel <= 0) return;

    const channels = files
      .map(({ name, abif }) => {
        const data = abif.rawChannels.get(standardChannel);
        return data ? { name, data } : null;
      })
      .filter((c) => c !== null);

    const aligned = autoAlignSamples(channels);
    setViewports(aligned);
  }, [files, standardChannel]);

  const dyeNames = files.length > 0 && files[0] !== undefined ? files[0].abif.dyeNames : [];
  const channelDyeName = dyeNames[selectedChannel - 1] ?? "";
  const standardDyeName = dyeNames[standardChannel - 1] ?? "";
  const showStandard = standardChannel > 0 && standardChannel !== selectedChannel;

  return (
    <div className="app">
      <header className="app-header">
        <h1>ABI Viewer</h1>
        <div className="header-controls">
          <ChannelSelector
            dyeNames={dyeNames}
            selectedChannel={selectedChannel}
            onChannelChange={setSelectedChannel}
            standardChannel={standardChannel}
            onStandardChange={setStandardChannel}
          />
          {files.length >= 2 && standardChannel > 0 && (
            <button type="button" className="auto-align-btn" onClick={handleAutoAlign}>
              Auto-align
            </button>
          )}
        </div>
      </header>

      {files.length === 0 ? (
        <FileUpload onFilesLoaded={handleFilesLoaded} />
      ) : (
        <>
          <FileUpload onFilesLoaded={handleFilesLoaded} />
          <div className="widget-list">
            {files.map(({ name, abif }) => {
              const channels = abif.rawChannels;
              const channelData = channels.get(selectedChannel);
              if (!channelData) return null;

              const standardData = showStandard ? (channels.get(standardChannel) ?? null) : null;
              const vp = viewports.get(name);

              const well = abif.well ?? "";
              const sampleName = abif.sampleName ?? name;
              const widgetLabel = well ? `${well} — ${sampleName}` : sampleName;

              return (
                <ElectropherogramWidget
                  key={name}
                  fileName={name}
                  label={widgetLabel}
                  channelData={channelData}
                  channelDyeName={channelDyeName}
                  standardData={standardData}
                  standardDyeName={standardDyeName}
                  xCenter={vp?.xCenter}
                  xZoom={vp?.xZoom}
                  onViewportChange={handleViewportChange}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
