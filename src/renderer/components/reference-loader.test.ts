/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import {
  formatAttempt,
  type LoadableStore,
  lookupOutcome,
  type ReferenceRequest,
  readAttempt,
  referenceRequestsKey,
  referenceStoreLabel,
  requestedNamespaces,
  retryDelayMs,
  shouldRetry,
} from "./reference-loader";

// The decisions the loading hook makes are pure functions of a store-shaped
// object, so they are tested here with plain objects, without a host global
// and without React (the hook itself is covered in `reference-loader.hook.test.tsx`).

interface FakeItem {
  name: string;
  namespace?: string;
}

function buildStore(overrides: Partial<LoadableStore<FakeItem>> = {}): LoadableStore<FakeItem> {
  const items: FakeItem[] = [];

  return {
    isLoaded: true,
    isLoading: false,
    items,
    getByName: (name, namespace) =>
      items.find((item) => item.name === name && (!namespace || item.namespace === namespace)),
    loadAll: async () => undefined,
    ...overrides,
  };
}

function buildRequest(overrides: Partial<ReferenceRequest<FakeItem>> = {}): ReferenceRequest<FakeItem> {
  return {
    label: "swiftguests",
    store: buildStore(),
    ...overrides,
  };
}

describe("requestedNamespaces", () => {
  it("returns undefined when nothing is known, so the store keeps its own context", () => {
    expect(requestedNamespaces()).toBeUndefined();
    expect(requestedNamespaces([])).toBeUndefined();
    expect(requestedNamespaces([undefined, ""])).toBeUndefined();
  });

  it("drops the unknown entries and deduplicates the rest", () => {
    expect(requestedNamespaces(["kubeswift-e2e", undefined, "kubeswift-e2e"])).toEqual(["kubeswift-e2e"]);
  });

  it("sorts the namespaces so the effect key does not depend on the caller's order", () => {
    expect(requestedNamespaces(["kubeswift-e2e", "default"])).toEqual(["default", "kubeswift-e2e"]);
    expect(requestedNamespaces(["default", "kubeswift-e2e"])).toEqual(["default", "kubeswift-e2e"]);
  });
});

describe("referenceStoreLabel", () => {
  it("prefers the store's apiBase, the most precise name in a CI log", () => {
    const request = buildRequest({
      store: buildStore({ api: { apiBase: "/apis/kubeswift.io/v1alpha1/swiftguests" } }),
    });

    expect(referenceStoreLabel(request)).toBe("/apis/kubeswift.io/v1alpha1/swiftguests");
  });

  it("falls back to the caller's label when the store exposes no apiBase", () => {
    expect(referenceStoreLabel(buildRequest())).toBe("swiftguests");
  });

  it("falls back to the caller's label when there is no store at all", () => {
    expect(referenceStoreLabel(buildRequest({ store: null }))).toBe("swiftguests");
  });
});

describe("lookupOutcome", () => {
  const store = buildStore({
    items: [{ name: "guest-1", namespace: "kubeswift-e2e" }] as FakeItem[],
    getByName: (name, namespace) =>
      name === "guest-1" && (!namespace || namespace === "kubeswift-e2e")
        ? { name: "guest-1", namespace: "kubeswift-e2e" }
        : undefined,
  });

  it("reports n/a when the drawer has no reference to resolve", () => {
    expect(lookupOutcome(store)).toBe("n/a");
    expect(lookupOutcome(store, [])).toBe("n/a");
    expect(lookupOutcome(store, [{ name: undefined, namespace: "kubeswift-e2e" }])).toBe("n/a");
  });

  it("reports n/a when the store itself is not available", () => {
    expect(lookupOutcome(null, [{ name: "guest-1" }])).toBe("n/a");
  });

  it("reports a hit only when every named reference resolves", () => {
    expect(lookupOutcome(store, [{ name: "guest-1", namespace: "kubeswift-e2e" }])).toBe("hit");
    expect(lookupOutcome(store, [{ name: "guest-1" }, { name: "guest-2" }])).toBe("miss");
  });

  it("reports a miss when the namespace does not match", () => {
    expect(lookupOutcome(store, [{ name: "guest-1", namespace: "default" }])).toBe("miss");
  });
});

describe("readAttempt", () => {
  it("describes a store that could not be resolved at all", () => {
    const outcome = readAttempt(buildRequest({ store: null, lookups: [{ name: "guest-1" }] }), 1);

    expect(outcome).toMatchObject({
      label: "swiftguests",
      attempt: 1,
      storeAvailable: false,
      isLoaded: false,
      items: 0,
      lookup: "n/a",
      failed: false,
    });
  });

  it("describes a loaded store holding the reference", () => {
    const items = [{ name: "guest-1", namespace: "kubeswift-e2e" }];
    const request = buildRequest({
      namespaces: ["kubeswift-e2e"],
      lookups: [{ name: "guest-1", namespace: "kubeswift-e2e" }],
      store: buildStore({ items, getByName: (name) => items.find((item) => item.name === name) }),
    });

    expect(readAttempt(request, 2)).toMatchObject({
      attempt: 2,
      namespaces: ["kubeswift-e2e"],
      storeAvailable: true,
      isLoaded: true,
      items: 1,
      lookup: "hit",
      failed: false,
    });
  });

  it("keeps the failure the load reported, unwrapping an Error into its message", () => {
    const outcome = readAttempt(buildRequest(), 1, new Error("Failed to load /api/v1/pods"));

    expect(outcome.failed).toBe(true);
    expect(outcome.error).toBe("Failed to load /api/v1/pods");
  });

  it("stringifies a failure that is not an Error", () => {
    expect(readAttempt(buildRequest(), 1, "no cluster").error).toBe("no cluster");
  });

  it("counts the store's own failedLoading flag as a failure", () => {
    const outcome = readAttempt(buildRequest({ store: buildStore({ failedLoading: true }) }), 1);

    expect(outcome.failed).toBe(true);
    expect(outcome.error).toBeUndefined();
  });
});

describe("formatAttempt", () => {
  it("formats the nominal attempt on a single greppable line", () => {
    const request = buildRequest({
      label: "pods",
      namespaces: ["kubeswift-e2e"],
      lookups: [{ name: "launcher", namespace: "kubeswift-e2e" }],
      store: buildStore({
        api: { apiBase: "/api/v1/pods" },
        items: [{ name: "launcher" }],
        getByName: (name) => (name === "launcher" ? { name: "launcher" } : undefined),
      }),
    });

    expect(formatAttempt(readAttempt(request, 1))).toBe(
      "[kubeswift-extension] reference store /api/v1/pods: attempt 1 ns=kubeswift-e2e isLoaded=true items=1 lookup=hit",
    );
  });

  it("renders the store's own namespace context as ns=*", () => {
    const request = buildRequest({ label: "nodes", store: buildStore({ api: { apiBase: "/api/v1/nodes" } }) });

    expect(formatAttempt(readAttempt(request, 3))).toBe(
      "[kubeswift-extension] reference store /api/v1/nodes: attempt 3 ns=* isLoaded=true items=0 lookup=n/a",
    );
  });

  it("says so when the store could not be resolved", () => {
    expect(formatAttempt(readAttempt(buildRequest({ store: undefined }), 1))).toBe(
      "[kubeswift-extension] reference store swiftguests: attempt 1 ns=* store=unavailable",
    );
  });

  it("appends the failure that would otherwise be invisible", () => {
    expect(formatAttempt(readAttempt(buildRequest(), 2, new Error("boom")))).toBe(
      "[kubeswift-extension] reference store swiftguests: attempt 2 ns=* isLoaded=true items=0 lookup=n/a failed=true error=boom",
    );
  });
});

describe("shouldRetry", () => {
  const base = readAttempt(buildRequest(), 1);

  it("stops once the store is loaded, healthy and holding what was asked for", () => {
    expect(shouldRetry({ ...base, lookup: "hit" })).toBe(false);
    expect(shouldRetry({ ...base, lookup: "n/a" })).toBe(false);
  });

  it("retries while the reference is still missing (the store may fill later)", () => {
    expect(shouldRetry({ ...base, lookup: "miss" })).toBe(true);
  });

  it("retries a store that never reported itself loaded", () => {
    expect(shouldRetry({ ...base, isLoaded: false })).toBe(true);
  });

  it("retries after a failed load, which the host would otherwise leave silent", () => {
    expect(shouldRetry({ ...base, failed: true })).toBe(true);
  });

  it("retries a store that was not resolvable yet", () => {
    expect(shouldRetry({ ...base, storeAvailable: false })).toBe(true);
  });

  it("gives up at the attempt budget", () => {
    expect(shouldRetry({ ...base, attempt: 5, lookup: "miss" })).toBe(false);
    expect(shouldRetry({ ...base, attempt: 4, lookup: "miss" })).toBe(true);
    expect(shouldRetry({ ...base, attempt: 2, lookup: "miss" }, 2)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("grows linearly from the base delay", () => {
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(3)).toBe(6000);
  });

  it("is capped so the last attempts stay a few seconds apart", () => {
    expect(retryDelayMs(4)).toBe(8000);
    expect(retryDelayMs(9)).toBe(8000);
  });

  it("honors a custom base delay and never returns less than one step", () => {
    expect(retryDelayMs(1, 10)).toBe(10);
    expect(retryDelayMs(0, 10)).toBe(10);
  });
});

describe("referenceRequestsKey", () => {
  it("is stable across renders that ask for the same things", () => {
    const build = () => [buildRequest({ namespaces: ["kubeswift-e2e"], lookups: [{ name: "guest-1" }] })];

    expect(referenceRequestsKey(build())).toBe(referenceRequestsKey(build()));
  });

  it("changes when the drawer opens another object", () => {
    const first = referenceRequestsKey([buildRequest({ lookups: [{ name: "guest-1" }] })]);
    const second = referenceRequestsKey([buildRequest({ lookups: [{ name: "guest-2" }] })]);

    expect(first).not.toBe(second);
  });

  it("changes when the namespaces to load change", () => {
    const first = referenceRequestsKey([buildRequest({ namespaces: ["default"] })]);
    const second = referenceRequestsKey([buildRequest({ namespaces: ["kubeswift-e2e"] })]);

    expect(first).not.toBe(second);
  });

  it("changes when a store that was unresolvable becomes available", () => {
    const first = referenceRequestsKey([buildRequest({ store: null })]);
    const second = referenceRequestsKey([buildRequest()]);

    expect(first).not.toBe(second);
  });
});
