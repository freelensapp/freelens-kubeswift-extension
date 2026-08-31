/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The two decisions the shared form grammar makes (SPEC-0014): whether a
// reference field can be a picker at all, and whether the key control beside it
// can be one.
//
// Everything else in `create-dialog.tsx` renders what it is handed and is
// asserted through the dialogs that hand it - and through the E2E suite, which
// is the only place a stylesheet on a hardcoded white box can be judged.

import { describe, expect, it } from "vitest";
import { keyPickerIsUsable, objectPickerIsUsable } from "./create-dialog";

import type { ObjectPickerFacts } from "./create-dialog";

const ready: ObjectPickerFacts = { state: "ready", names: ["fast", "standard"] };

describe("objectPickerIsUsable", () => {
  it("is a picker when the read answered and the value is empty", () => {
    expect(objectPickerIsUsable(ready, "")).toBe(true);
  });

  it("is a picker when the value is one of the names the read returned", () => {
    expect(objectPickerIsUsable(ready, "fast")).toBe(true);
  });

  it("is a text input while the read is still in flight", () => {
    expect(objectPickerIsUsable({ state: "loading", names: [] }, "")).toBe(false);
  });

  it("is a text input when the read was refused, which is what keeps the write reachable", () => {
    expect(objectPickerIsUsable({ state: "unavailable", names: [] }, "")).toBe(false);
  });

  it("is a text input when the read answered with nothing, rather than an empty dropdown", () => {
    expect(objectPickerIsUsable({ state: "ready", names: [] }, "")).toBe(false);
  });

  it("is a text input for a value the list does not contain, so a typed name is never lost", () => {
    expect(objectPickerIsUsable(ready, "typed-by-hand")).toBe(false);
  });

  it("keeps a refused read a text input even when it holds stale names from a store seed", () => {
    expect(objectPickerIsUsable({ state: "unavailable", names: ["fast"] }, "fast")).toBe(false);
  });
});

describe("keyPickerIsUsable", () => {
  const keys = ["network-config", "user-data"];

  it("is a picker when the object's keys are known and no key is chosen yet", () => {
    expect(keyPickerIsUsable(keys, "")).toBe(true);
  });

  it("is a picker for a key the object really carries", () => {
    expect(keyPickerIsUsable(keys, "user-data")).toBe(true);
  });

  it("is a text input when the keys cannot be known at all", () => {
    expect(keyPickerIsUsable(undefined, "")).toBe(false);
  });

  it("is a text input for an object that carries no keys, rather than an empty dropdown", () => {
    expect(keyPickerIsUsable([], "")).toBe(false);
  });

  it("is a text input for a key the object does not carry, so a typed key is never lost", () => {
    expect(keyPickerIsUsable(keys, "typed-by-hand")).toBe(false);
  });

  it("keeps a key typed before the read answered visible once it does", () => {
    expect(keyPickerIsUsable(undefined, "user-data")).toBe(false);
    expect(keyPickerIsUsable(keys, "user-data")).toBe(true);
  });
});
