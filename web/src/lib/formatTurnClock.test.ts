import { describe, expect, it } from "vitest";
import { formatTurnClock, formatTurnClockIso } from "./formatTurnClock";

describe("formatTurnClock", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatTurnClock(0)).toBe("0m00s");
    expect(formatTurnClock(999)).toBe("0m00s");
    expect(formatTurnClock(5_000)).toBe("0m05s");
    expect(formatTurnClock(65_000)).toBe("1m05s");
    expect(formatTurnClock(83_000)).toBe("1m23s");
  });

  it("does not go negative", () => {
    expect(formatTurnClock(-12_000)).toBe("0m00s");
  });
});

describe("formatTurnClockIso", () => {
  it("emits an ISO-8601 duration", () => {
    expect(formatTurnClockIso(5_000)).toBe("PT0M5S");
    expect(formatTurnClockIso(83_000)).toBe("PT1M23S");
  });
});
