import { describe, expect, it } from "vitest";
import { normalizePath, routeFromPath } from "./routing";

describe("normalizePath", () => {
  it("strips trailing slashes except at the root", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/privacy/")).toBe("/privacy");
    expect(normalizePath("/terms///")).toBe("/terms");
  });
});

describe("routeFromPath", () => {
  it("maps the legal documents", () => {
    expect(routeFromPath("/privacy")).toBe("privacy");
    expect(routeFromPath("/privacy/")).toBe("privacy");
    expect(routeFromPath("/terms")).toBe("terms");
  });

  it("treats everything else as the editor", () => {
    expect(routeFromPath("/")).toBe("editor");
    expect(routeFromPath("/index.html")).toBe("editor");
    expect(routeFromPath("/photo")).toBe("editor");
  });
});
