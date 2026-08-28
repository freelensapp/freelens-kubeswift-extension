import { describe, expect, it } from "vitest";
import { getBlobEditorHeight } from "./utils";

describe("getBlobEditorHeight", () => {
  it("clamps a short value to the minimum of 5 lines", () => {
    expect(getBlobEditorHeight("one line")).toBe(5 * 18);
    expect(getBlobEditorHeight("line1\nline2")).toBe(5 * 18);
  });

  it("clamps an empty value to the minimum", () => {
    expect(getBlobEditorHeight("")).toBe(5 * 18);
  });

  it("grows with the line count inside the clamp range", () => {
    const tenLines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");

    expect(getBlobEditorHeight(tenLines)).toBe(10 * 18);
  });

  it("clamps a long value to the maximum of 20 lines", () => {
    const fiftyLines = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");

    expect(getBlobEditorHeight(fiftyLines)).toBe(20 * 18);
  });
});
