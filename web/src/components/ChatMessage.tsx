import type { EditSnapshot, TranscriptEntry } from "../lib/useAgent";
import { formatTurnClock, formatTurnClockIso } from "../lib/formatTurnClock";

const ROLE_LABELS: Record<TranscriptEntry["kind"], string> = {
  user: "You",
  assistant: "Assistant",
  tool: "Edit",
  notice: "Note",
  error: "Problem",
};

export function ChatMessage({
  entry,
  onRevert,
}: {
  entry: TranscriptEntry;
  onRevert: (snapshot: EditSnapshot) => void;
}) {
  const revert = entry.revert;
  return (
    <li
      className={`message ${entry.kind}`}
      data-failed={entry.failed || undefined}
      data-pending={entry.pending || undefined}
    >
      <article>
        <h3>{ROLE_LABELS[entry.kind]}</h3>
        <p>{entry.text}</p>
        {entry.elapsedMs != null ? (
          <time dateTime={formatTurnClockIso(entry.elapsedMs)}>
            {formatTurnClock(entry.elapsedMs)}
          </time>
        ) : null}
        {revert && (
          <button className="revert" onClick={() => onRevert(revert)}>
            Undo these changes
          </button>
        )}
      </article>
    </li>
  );
}
