import { useCallback, useRef, useState } from "react";
import { AbifFile } from "../abi-parser.ts";
import { autoAlignSamples } from "../lib/align-peaks.ts";
import { ChannelSelector } from "./ChannelSelector.tsx";
import type {
  ViewportCommand,
  WidgetChangeEvent,
  WidgetHandle,
} from "./ElectropherogramWidget.tsx";
import { ElectropherogramWidget } from "./ElectropherogramWidget.tsx";
import { FileUpload } from "./FileUpload.tsx";

interface LoadedFile {
  readonly name: string;
  readonly abif: AbifFile;
}

const ZOOM_STEP = 1.3;
const MAX_X_ZOOM = 10;

export function App() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [selectedChannel, setSelectedChannel] = useState(1);
  const [standardChannel, setStandardChannel] = useState(0);
  const [widgetsLocked, setWidgetsLocked] = useState(true);

  const [viewportCommands, setViewportCommands] = useState<Map<string, ViewportCommand>>(new Map());
  const commandVersionRef = useRef(0);
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

  const sendViewportCommands = useCallback(
    (entries: Map<string, { xCenter: number; xZoom: number }>) => {
      commandVersionRef.current += 1;
      const version = commandVersionRef.current;
      const commands = new Map<string, ViewportCommand>();
      for (const [name, vp] of entries) {
        commands.set(name, { version, ...vp });
      }
      setViewportCommands(commands);
    },
    [],
  );

  const handleAutoAlign = useCallback(() => {
    if (files.length < 2 || standardChannel <= 0) return;

    const channels = files
      .map(({ name, abif }) => {
        const data = abif.rawChannels.get(standardChannel);
        return data ? { name, data } : null;
      })
      .filter((c) => c !== null);

    const aligned = autoAlignSamples(channels);
    sendViewportCommands(aligned);
  }, [files, standardChannel, sendViewportCommands]);

  const handleZoomAll = useCallback(
    (direction: 1 | -1) => {
      const entries = new Map<string, { xCenter: number; xZoom: number }>();
      for (const file of files) {
        const existing = viewportCommands.get(file.name);
        const dataLen = file.abif.rawChannels.get(selectedChannel)?.length ?? 0;
        const currentZoom = existing?.xZoom ?? 1;
        const currentCenter = existing?.xCenter ?? dataLen / 2;
        const newZoom = Math.max(
          1,
          Math.min(MAX_X_ZOOM, currentZoom * (direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP)),
        );
        entries.set(file.name, { xCenter: currentCenter, xZoom: newZoom });
      }
      sendViewportCommands(entries);
    },
    [files, selectedChannel, viewportCommands, sendViewportCommands],
  );

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

  const dyeNames = files.length > 0 && files[0] !== undefined ? files[0].abif.dyeNames : [];
  const channelDyeName = dyeNames[selectedChannel - 1] ?? "";
  const standardDyeName = dyeNames[standardChannel - 1] ?? "";
  const showStandard = standardChannel > 0 && standardChannel !== selectedChannel;

  return (
    <div className="app">
      <header className="app-header">
        <h1>ABI Viewer</h1>
        <ChannelSelector
          dyeNames={dyeNames}
          selectedChannel={selectedChannel}
          onChannelChange={setSelectedChannel}
          standardChannel={standardChannel}
          onStandardChange={setStandardChannel}
        />
      </header>

      {files.length === 0 ? (
        <FileUpload onFilesLoaded={handleFilesLoaded} />
      ) : (
        <>
          <FileUpload onFilesLoaded={handleFilesLoaded} />
          {files.length > 0 && (
            <div className="toolbar">
              <div className="zoom-all">
                <button type="button" className="toolbar-btn" onClick={() => handleZoomAll(1)}>
                  +
                </button>
                <span className="toolbar-label">zoom</span>
                <button type="button" className="toolbar-btn" onClick={() => handleZoomAll(-1)}>
                  &minus;
                </button>
              </div>
              <label className="toolbar-checkbox">
                <input
                  type="checkbox"
                  checked={widgetsLocked}
                  onChange={(e) => setWidgetsLocked(e.target.checked)}
                />
                Lock widgets
              </label>
              {files.length >= 2 && standardChannel > 0 && (
                <button type="button" className="auto-align-btn" onClick={handleAutoAlign}>
                  Auto-align
                </button>
              )}
            </div>
          )}
          <div className="widget-list">
            {files.map(({ name, abif }) => {
              const channels = abif.rawChannels;
              const channelData = channels.get(selectedChannel);
              if (!channelData) return null;

              const standardData = showStandard ? (channels.get(standardChannel) ?? null) : null;

              const well = abif.well ?? "";
              const sampleName = abif.sampleName ?? name;
              const widgetLabel = well ? `${well} — ${sampleName}` : sampleName;

              return (
                <ElectropherogramWidget
                  key={name}
                  ref={(handle) => {
                    if (handle) {
                      widgetRefsMap.current.set(name, handle);
                    } else {
                      widgetRefsMap.current.delete(name);
                    }
                  }}
                  label={widgetLabel}
                  channelData={channelData}
                  channelDyeName={channelDyeName}
                  standardData={standardData}
                  standardDyeName={standardDyeName}
                  viewportCommand={viewportCommands.get(name)}
                  onWidgetChange={(event) => handleWidgetChange(name, event)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
