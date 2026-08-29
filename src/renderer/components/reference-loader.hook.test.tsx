// @vitest-environment jsdom

/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LoadAllOptions, type LoadableStore, type ReferenceRequest, useReferenceStores } from "./reference-loader";

// The hook's own behavior (retries, subscription, cleanup) against fake
// store-shaped objects: no host global, no cluster, no real timers. The
// decisions it takes are tested as pure functions in `reference-loader.test.ts`.

interface FakeItem {
  name: string;
  namespace?: string;
}

type FakeStore = LoadableStore<FakeItem> & {
  items: FakeItem[];
  calls: LoadAllOptions[];
};

interface FakeStoreBehavior {
  /** Called on every load, so a test can decide when the store starts holding items. */
  onLoad?: (call: number, store: FakeStore) => void;
  subscribe?: () => () => void;
}

function createStore(behavior: FakeStoreBehavior = {}): FakeStore {
  const items: FakeItem[] = [];
  const calls: LoadAllOptions[] = [];
  const store: FakeStore = {
    isLoaded: false,
    isLoading: false,
    items,
    calls,
    api: { apiBase: "/apis/kubeswift.io/v1alpha1/swiftguests" },
    getByName: (name, namespace) =>
      items.find((item) => item.name === name && (!namespace || item.namespace === namespace)),
    loadAll: async (options) => {
      calls.push(options ?? {});
      store.isLoaded = true;
      behavior.onLoad?.(calls.length, store);

      return undefined;
    },
    subscribe: behavior.subscribe,
  };

  return store;
}

function Probe({ requests }: { requests: ReferenceRequest<FakeItem>[] }) {
  useReferenceStores(requests, { maxAttempts: 3, retryDelayMs: 1000 });

  return null;
}

/** Resolves its store on every render, the way a drawer calls `maybe(() => Kind.getStore())`. */
function ResolvingProbe({ resolveStore }: { resolveStore: () => FakeStore | null }) {
  useReferenceStores([{ label: "swiftguests", store: resolveStore(), lookups: [{ name: "guest-1" }] }], {
    maxAttempts: 3,
    retryDelayMs: 1000,
  });

  return null;
}

const logged = () => infoSpy.mock.calls.map(([line]) => String(line));

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Lets the pending loads settle and the retry timers fire. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useReferenceStores", () => {
  it("loads with the namespaces the drawer knows, merging and capturing failures", async () => {
    const store = createStore({ onLoad: (_call, current) => current.items.push({ name: "guest-1", namespace: "ns" }) });

    render(
      <Probe
        requests={[
          {
            label: "swiftguests",
            store,
            namespaces: ["ns", undefined],
            lookups: [{ name: "guest-1", namespace: "ns" }],
          },
        ]}
      />,
    );
    await advance(0);

    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]?.namespaces).toEqual(["ns"]);
    expect(store.calls[0]?.merge).toBe(true);
    expect(typeof store.calls[0]?.onLoadFailure).toBe("function");
    expect(logged()).toEqual([
      "[kubeswift-extension] reference store /apis/kubeswift.io/v1alpha1/swiftguests: attempt 1 ns=ns isLoaded=true items=1 lookup=hit",
    ]);
  });

  it("does not retry once the references are there", async () => {
    const store = createStore({ onLoad: (_call, current) => current.items.push({ name: "guest-1" }) });

    render(<Probe requests={[{ label: "swiftguests", store, lookups: [{ name: "guest-1" }] }]} />);
    await advance(10_000);

    expect(store.calls).toHaveLength(1);
  });

  it("retries the silent empty load until the store actually holds the reference (issue #38)", async () => {
    // The regression this hook exists for: the host reports isLoaded without
    // ever having listed anything, so a one-shot guarded by isLoaded gave up
    // forever with no error anywhere.
    const store = createStore({
      onLoad: (call, current) => {
        if (call === 2) {
          current.items.push({ name: "guest-1" });
        }
      },
    });

    render(<Probe requests={[{ label: "swiftguests", store, lookups: [{ name: "guest-1" }] }]} />);
    await advance(0);

    expect(store.calls).toHaveLength(1);
    expect(logged()[0]).toContain("attempt 1 ns=* isLoaded=true items=0 lookup=miss");

    await advance(10_000);

    expect(store.calls).toHaveLength(2);
    expect(logged()[1]).toContain("attempt 2 ns=* isLoaded=true items=1 lookup=hit");
  });

  it("gives up at the attempt budget instead of retrying forever", async () => {
    const store = createStore();

    render(<Probe requests={[{ label: "swiftguests", store, lookups: [{ name: "gone" }] }]} />);
    await advance(60_000);

    expect(store.calls).toHaveLength(3);
    expect(logged()).toHaveLength(3);
  });

  it("re-renders so a store that was not registered yet is picked up when it appears", async () => {
    const store = createStore({ onLoad: (_call, current) => current.items.push({ name: "guest-1" }) });
    let renders = 0;
    const resolveStore = () => {
      renders += 1;

      return renders > 1 ? store : null;
    };

    render(<ResolvingProbe resolveStore={resolveStore} />);
    await advance(60_000);

    expect(logged()[0]).toContain("store=unavailable");
    expect(store.calls).toHaveLength(1);
    expect(logged().at(-1)).toContain("items=1 lookup=hit");
  });

  it("reports a store it could not resolve and retries it", async () => {
    render(<Probe requests={[{ label: "swiftguests", store: null, lookups: [{ name: "guest-1" }] }]} />);
    await advance(60_000);

    expect(logged()).toHaveLength(3);
    expect(logged()[0]).toBe("[kubeswift-extension] reference store swiftguests: attempt 1 ns=* store=unavailable");
  });

  it("retries a failed load and reports the failure the host would have swallowed", async () => {
    const store = createStore();

    store.loadAll = async (options?: LoadAllOptions) => {
      store.calls.push(options ?? {});
      options?.onLoadFailure?.(new Error("Failed to load /apis/kubeswift.io/v1alpha1/swiftguests"));

      return undefined;
    };

    render(<Probe requests={[{ label: "swiftguests", store }]} />);
    await advance(0);

    expect(logged()[0]).toContain("failed=true error=Failed to load /apis/kubeswift.io/v1alpha1/swiftguests");

    await advance(60_000);

    expect(store.calls).toHaveLength(3);
  });

  it("watches the store after the first successful load and stops watching on unmount", async () => {
    const dispose = vi.fn();
    const subscribe = vi.fn(() => dispose);
    const store = createStore({ subscribe });

    const view = render(<Probe requests={[{ label: "swiftguests", store, lookups: [{ name: "gone" }] }]} />);

    await advance(60_000);

    expect(subscribe).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();

    view.unmount();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("stops retrying and logging once the drawer is closed", async () => {
    const store = createStore();

    const view = render(<Probe requests={[{ label: "swiftguests", store, lookups: [{ name: "gone" }] }]} />);

    await advance(0);
    view.unmount();
    await advance(60_000);

    expect(store.calls).toHaveLength(1);
    expect(logged()).toHaveLength(1);
  });
});
