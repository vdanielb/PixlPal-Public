import { useState } from "react";
import type { Pipeline } from "@pixelcam/shared";

export function PipelineJson({ pipeline }: { pipeline: Pipeline }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(pipeline, null, 2);

  return (
    <details className="pipeline-json">
      <summary>
        Pipeline JSON
        <small> · {pipeline.operations.length} ops</small>
      </summary>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(json);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code>{json}</code>
      </pre>
    </details>
  );
}
