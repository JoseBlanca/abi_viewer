import { useCallback, useRef } from "react";

interface FileUploadProps {
  readonly onFilesLoaded: (files: { name: string; buffer: ArrayBuffer }[]) => void;
}

export function FileUpload({ onFilesLoaded }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      const results: { name: string; buffer: ArrayBuffer }[] = [];
      for (const file of fileList) {
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
      if (e.dataTransfer.files.length > 0) {
        void handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void handleFiles(e.target.files);
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
