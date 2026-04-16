interface ChannelSelectorProps {
  readonly dyeNames: string[];
  readonly selectedChannel: number;
  readonly onChannelChange: (channel: number) => void;
  readonly standardChannel: number;
  readonly onStandardChange: (channel: number) => void;
}

export function ChannelSelector({
  dyeNames,
  selectedChannel,
  onChannelChange,
  standardChannel,
  onStandardChange,
}: ChannelSelectorProps) {
  if (dyeNames.length === 0) return null;

  return (
    <div className="channel-selector">
      <label>
        View channel:{" "}
        <select value={selectedChannel} onChange={(e) => onChannelChange(Number(e.target.value))}>
          {dyeNames.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Standard:{" "}
        <select value={standardChannel} onChange={(e) => onStandardChange(Number(e.target.value))}>
          {dyeNames.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
