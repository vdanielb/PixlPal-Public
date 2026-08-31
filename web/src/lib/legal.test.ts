import { describe, expect, it } from "vitest";
import { formatLegalDate, PRIVACY_UPDATED_ISO, TERMS_UPDATED_ISO } from "./legal";

describe("formatLegalDate", () => {
  it("renders the recorded Last Updated dates", () => {
    expect(formatLegalDate(PRIVACY_UPDATED_ISO)).toBe("August 30, 2026");
    expect(formatLegalDate(TERMS_UPDATED_ISO)).toBe("August 30, 2026");
  });
});
