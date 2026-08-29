/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { existingObjectRef, objectExists } from "./object-existence";

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

describe("existingObjectRef", () => {
  const namespaced = {
    getByName: (name: string, namespace?: string) =>
      name === "gpu-4" && namespace === "gpu-lab"
        ? {
            apiVersion: "gpu.kubeswift.io/v1alpha1",
            getName: () => name,
            getNs: () => namespace,
          }
        : undefined,
  };

  const clusterScoped = {
    getByName: (name: string) =>
      name === "gpu-node-1"
        ? {
            apiVersion: "gpu.kubeswift.io/v1alpha1",
            getName: () => name,
          }
        : undefined,
  };

  it("builds the ref from the object the store found", () => {
    expect(existingObjectRef(namespaced, "SwiftGPUProfile", "gpu-4", "gpu-lab")).toEqual({
      apiVersion: "gpu.kubeswift.io/v1alpha1",
      kind: "SwiftGPUProfile",
      name: "gpu-4",
      namespace: "gpu-lab",
    });
  });

  it("leaves a cluster-scoped ref without a namespace", () => {
    expect(existingObjectRef(clusterScoped, "SwiftGPUNode", "gpu-node-1")).toEqual({
      apiVersion: "gpu.kubeswift.io/v1alpha1",
      kind: "SwiftGPUNode",
      name: "gpu-node-1",
      namespace: undefined,
    });
  });

  it("returns nothing for an object the store does not hold, so the row degrades to text", () => {
    expect(existingObjectRef(namespaced, "SwiftGPUProfile", "gpu-4", "other")).toBeUndefined();
    expect(existingObjectRef(namespaced, "SwiftGPUProfile", "no-such-profile", "gpu-lab")).toBeUndefined();
  });

  it("returns nothing when there is no name to look up or no store to look it up in", () => {
    expect(existingObjectRef(namespaced, "SwiftGPUProfile", undefined, "gpu-lab")).toBeUndefined();
    expect(existingObjectRef(null, "SwiftGPUProfile", "gpu-4", "gpu-lab")).toBeUndefined();
    expect(existingObjectRef(undefined, "SwiftGPUProfile", "gpu-4", "gpu-lab")).toBeUndefined();
  });
});
