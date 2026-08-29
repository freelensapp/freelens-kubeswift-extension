/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { objectExists } from "./object-existence";

describe("objectExists", () => {
  const store = {
    getByName: (name: string, namespace?: string) => {
      if (name === "node-1") {
        return { name };
      }

      if (name === "pod-1" && namespace === "kubeswift-e2e") {
        return { name, namespace };
      }

      return undefined;
    },
  };

  it("returns true for a cluster-scoped object the store has (no namespace)", () => {
    expect(objectExists(store, "node-1")).toBe(true);
  });

  it("returns false for a cluster-scoped name the store does not have", () => {
    expect(objectExists(store, "no-such-node")).toBe(false);
  });

  it("passes the namespace through to the store for a namespaced object", () => {
    expect(objectExists(store, "pod-1", "kubeswift-e2e")).toBe(true);
  });

  it("returns false when the namespace does not match", () => {
    expect(objectExists(store, "pod-1", "default")).toBe(false);
  });

  it("returns false when there is no name to look up", () => {
    expect(objectExists(store, undefined)).toBe(false);
  });

  it("returns false when the store itself is not available", () => {
    expect(objectExists(undefined, "node-1")).toBe(false);
  });

  it("returns false when the store is null (the maybe(() => Kind.getStore()) failure case)", () => {
    expect(objectExists(null, "node-1")).toBe(false);
  });
});
