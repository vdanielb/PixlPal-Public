import { useCallback, useState, type DragEvent } from "react";
import { InternalLink } from "./InternalLink";

export function Dropzone({
  onFile,
  engineReady,
}: {
  onFile: (file: File) => void;
  engineReady: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        onFile(file);
      }
    },
    [onFile],
  );

  return (
    <section
      className={`dropzone${dragging ? " dragging" : ""}`}
      aria-label="Open a photo"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <hgroup>
        <h2>Welcome to PixlPal.</h2>
        <p>
          PixlPal lets anyone edit photos. Just describe the changes you want in plain English.{" "}
          <InternalLink href="/privacy">Privacy Policy</InternalLink>
        </p>
      </hgroup>
      <label className="file-picker">
        {engineReady ? "Choose a photo" : "Warming up engine…"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
      <p className="hint">or drop an image anywhere in this area</p>
    </section>
  );
}
