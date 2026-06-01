import { useCallback, useRef } from "react";

interface FileUploadProps {
  readonly onFilesLoaded: (files: { name: string; buffer: ArrayBuffer }[]) => void;
}

export function FileUpload({ onFilesLoaded }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const results: { name: string; buffer: ArrayBuffer }[] = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        results.push({ name: file.name, buffer });
      }
      onFilesLoaded(results);
    },
    [onFilesLoaded],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Snapshot the FileList synchronously: Firefox invalidates the
      // dataTransfer once this handler returns, before the async read runs.
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        void handleFiles(files);
      }
    },
    [handleFiles],
  );

  // Firefox needs the default prevented on dragenter as well as dragover,
  // otherwise it won't register the element as a drop target.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void handleFiles(Array.from(e.target.files));
      }
    },
    [handleFiles],
  );

  return (
    <button
      type="button"
      className="file-upload"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".fsa,.ab1"
        onChange={handleChange}
        style={{ display: "none" }}
      />
      <p>Drop .fsa / .ab1 files here or click to browse</p>
    </button>
  );
}
