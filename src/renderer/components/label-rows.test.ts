/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import {
  addKeyValueRow,
  keyValueFieldOrder,
  keyValuePayload,
  keyValueRowErrors,
  labelKeyError,
  labelKeyMessage,
  labelValueError,
  labelValueMessage,
  removeKeyValueRow,
  updateKeyValueRow,
} from "./label-rows";

import type { KeyValueRow } from "./label-rows";

function row(id: string, key: string, value = ""): KeyValueRow {
  return { id, key, value };
}

describe("the row helpers", () => {
  it("adds an empty row whose id follows the existing ones", () => {
    const first = addKeyValueRow([], "claim");

    expect(first).toEqual([{ id: "claim-1", key: "", value: "" }]);
    expect(addKeyValueRow([row("claim-4", "a")], "claim").at(-1)?.id).toBe("claim-5");
  });

  it("removes and updates by id, leaving the input untouched", () => {
    const rows = [row("label-1", "a", "1"), row("label-2", "b", "2")];

    expect(removeKeyValueRow(rows, "label-1")).toEqual([row("label-2", "b", "2")]);
    expect(updateKeyValueRow(rows, "label-2", { value: "3" })).toEqual([
      row("label-1", "a", "1"),
      row("label-2", "b", "3"),
    ]);
    expect(rows[1].value).toBe("2");
  });

  it("reads the two fields in the order they are shown", () => {
    expect(keyValueFieldOrder).toEqual(["key", "value"]);
  });
});

describe("labelKeyError", () => {
  it.each(["app", "app.kubernetes.io/name", "example.com/a_b-c.d", "A1", "a".repeat(63)])("accepts %s", (key) => {
    expect(labelKeyError(key)).toBeUndefined();
  });

  it("says nothing about an empty key", () => {
    expect(labelKeyError("  ")).toBeUndefined();
  });

  it.each([
    "-app",
    "app-",
    "has space",
    "a".repeat(64),
    "/app",
    "Example.com/app",
    "example.com/",
    "a/b/c",
    `${"a".repeat(254)}/app`,
  ])("refuses %s", (key) => {
    expect(labelKeyError(key)).toBe(labelKeyMessage);
  });
});

describe("labelValueError", () => {
  it.each(["", "v1", "a.b_c-d", "x".repeat(63)])("accepts %j", (value) => {
    expect(labelValueError(value)).toBeUndefined();
  });

  it.each(["-v", "v-", "a/b", "x".repeat(64)])("refuses %s", (value) => {
    expect(labelValueError(value)).toBe(labelValueMessage);
  });
});

describe("keyValueRowErrors", () => {
  it("drops an empty row silently and refuses a value with no key", () => {
    const errors = keyValueRowErrors([row("r-1", ""), row("r-2", "", "orphan")], {
      syntax: "free",
      what: "the claims",
    });

    expect(errors[0]).toEqual({});
    expect(errors[1].key).toContain("the claims is a map");
  });

  it("refuses a key a previous row already sets, on the later row only", () => {
    const errors = keyValueRowErrors([row("r-1", "team", "a"), row("r-2", "team", "b")], {
      syntax: "free",
      what: "the claims",
    });

    expect(errors[0]).toEqual({});
    expect(errors[1].key).toContain("Another row already sets team");
  });

  it("applies the label syntax only to label maps", () => {
    const rows = [row("r-1", "Bad Key", "bad value!")];

    expect(keyValueRowErrors(rows, { syntax: "label", what: "the labels" })[0]).toEqual({
      key: labelKeyMessage,
      value: labelValueMessage,
    });
    expect(keyValueRowErrors(rows, { syntax: "free", what: "the claims" })[0]).toEqual({});
  });

  it("asks the owner's rule only once the syntax passes", () => {
    const keyRule = (key: string) => (key.startsWith("kubeswift.io/") ? "reserved" : undefined);

    expect(keyValueRowErrors([row("r-1", "kubeswift.io/x")], { syntax: "label", what: "l", keyRule })[0].key).toBe(
      "reserved",
    );
    expect(keyValueRowErrors([row("r-1", "Bad Key")], { syntax: "label", what: "l", keyRule })[0].key).toBe(
      labelKeyMessage,
    );
  });
});

describe("keyValuePayload", () => {
  it("is undefined while no row carries a key", () => {
    expect(keyValuePayload([])).toBeUndefined();
    expect(keyValuePayload([row("r-1", " ", "value")])).toBeUndefined();
  });

  it("trims keys and values and keeps an empty value", () => {
    expect(keyValuePayload([row("r-1", " app ", " web "), row("r-2", "tier", ""), row("r-3", "")])).toEqual({
      app: "web",
      tier: "",
    });
  });
});
