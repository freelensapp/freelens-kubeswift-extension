/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Loading of the stores a detail drawer needs to decide whether a reference
// (a Node, a Pod, another KubeSwift CRD instance...) can be rendered as a link
// or has to degrade to plain text (see `object-existence.ts` for the
// render-time lookup and DESIGN.md section 3 for the rule).
//
// The naive version of this was a one-shot fire-and-forget `loadAll()` guarded
// by `isLoaded`/`isLoading`. It filled the stores within seconds on a locally
// built app and never filled them at all on the packed Linux app in CI
// (issue #38), with nothing in the console to explain why. Two properties of
// the host's `KubeObjectStore` make that outcome possible without a single
// error being logged:
//
// - `loadAll()` without `namespaces` defaults to the cluster frame's
//   *context namespaces* (the UI namespace filter). For a namespaced store
//   that list can still be empty when the drawer opens, and listing zero
//   namespaces loads zero items while setting `isLoaded = true` - after which
//   an `isLoaded`-guarded one-shot never tries again.
// - a load that fails without an `onLoadFailure` callback rejects internally,
//   is warned about once, and leaves `isLoaded` false forever.
//
// So the loader below asks for explicit namespaces whenever the caller knows
// them, always passes `onLoadFailure` so a failure is data instead of a
// rejection, retries a bounded number of times while the component stays
// mounted, subscribes to the store after the first successful load so
// late-appearing objects upgrade rows to links, and reports every attempt on
// one line so the next CI run explains itself.
//
// Everything except the hook is a pure function of a store-shaped object, so
// the decisions are unit-testable without stubbing the host global (the same
// shape as `object-existence.ts` and the status classifiers of DESIGN.md
// section 2).

import React from "react";
import { maybe } from "../../common/utils";
import { type ObjectLookupStore, objectExists } from "./object-existence";

/** Prefix every diagnostic line shares, so CI logs can be grepped for it. */
export const referenceLogPrefix = "[kubeswift-extension]";

/** How many times a store is asked for the same references before giving up. */
export const defaultMaxAttempts = 5;

/** Base delay between attempts; the wait grows linearly up to `maxRetryDelayMs`. */
export const defaultRetryDelayMs = 2000;

/** Upper bound of the linear backoff, so the last attempts stay ~2-8s apart. */
export const maxRetryDelayMs = 8000;

/** The options of the host's `KubeObjectStore.loadAll()` this module uses. */
export interface LoadAllOptions {
  namespaces?: string[];
  merge?: boolean;
  onLoadFailure?: (error: unknown) => void;
}

/**
 * The slice of `Renderer.K8sApi`'s `KubeObjectStore` the reference loader
 * needs, on top of the lookup slice `objectExists` uses. Declared here rather
 * than imported from the host so the logic stays testable with plain objects:
 * `items`, `api` and `subscribe` are optional for the same reason.
 */
export interface LoadableStore<T> extends ObjectLookupStore<T> {
  isLoaded: boolean;
  isLoading: boolean;
  failedLoading?: boolean;
  items?: readonly unknown[];
  api?: { readonly apiBase?: string };
  loadAll(options?: LoadAllOptions): Promise<unknown>;
  subscribe?(): () => void;
}

/** A name (and, for namespaced kinds, a namespace) a drawer will look up. */
export interface ReferenceLookup {
  name?: string;
  namespace?: string;
}

/** One store a drawer depends on, with the references it will resolve in it. */
export interface ReferenceRequest<T = unknown> {
  /** Stable name for the diagnostics when the store exposes no `api.apiBase`. */
  label: string;
  /** `null`/`undefined` when `maybe(() => Kind.getStore())` could not resolve it. */
  store: LoadableStore<T> | null | undefined;
  /**
   * Namespaces to list explicitly. Omit for cluster-scoped kinds (Node,
   * StorageClass), which are listed cluster-wide anyway. Entries may be
   * `undefined` so callers can pass `ref?.namespace` straight through.
   */
  namespaces?: (string | undefined)[];
  /** The references the drawer will render; drives the `lookup=` diagnostic. */
  lookups?: ReferenceLookup[];
}

export type LookupOutcome = "hit" | "miss" | "n/a";

/** Everything one attempt observed, and the only input of the log line. */
export interface AttemptOutcome {
  label: string;
  attempt: number;
  namespaces?: string[];
  storeAvailable: boolean;
  isLoaded: boolean;
  items: number;
  lookup: LookupOutcome;
  failed: boolean;
  error?: string;
}

export interface UseReferenceStoresOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * The namespaces to pass to `loadAll()`: the caller's list without the empty
 * entries, deduplicated and sorted (so the effect key below is stable), or
 * `undefined` when nothing is known - which lets the host fall back to its
 * context namespaces, the right thing for a cluster-scoped store.
 */
export function requestedNamespaces(namespaces?: (string | undefined)[]): string[] | undefined {
  const known = [...new Set((namespaces ?? []).filter((namespace): namespace is string => Boolean(namespace)))].sort();

  return known.length > 0 ? known : undefined;
}

/** `api.apiBase` when the host exposes it (most informative), else the caller's label. */
export function referenceStoreLabel(request: ReferenceRequest<unknown>): string {
  return request.store?.api?.apiBase ?? request.label;
}

/**
 * Whether the store already holds every reference the drawer asked about:
 * `n/a` when there is nothing to look up (a drawer that only preloads), `hit`
 * when all named references resolve, `miss` otherwise. A `miss` is not
 * necessarily an error - a referenced object can legitimately be gone - which
 * is why it only drives retries, never rendering.
 */
export function lookupOutcome<T>(
  store: LoadableStore<T> | null | undefined,
  lookups?: ReferenceLookup[],
): LookupOutcome {
  const named = (lookups ?? []).filter((lookup) => Boolean(lookup.name));

  if (!store || named.length === 0) {
    return "n/a";
  }

  return named.every((lookup) => objectExists(store, lookup.name, lookup.namespace)) ? "hit" : "miss";
}

/** Reads the state one attempt ended in. Pure given a store-shaped object. */
export function readAttempt(request: ReferenceRequest<unknown>, attempt: number, failure?: unknown): AttemptOutcome {
  const { store } = request;
  const error = failure === undefined ? undefined : String(failure instanceof Error ? failure.message : failure);

  return {
    label: referenceStoreLabel(request),
    attempt,
    namespaces: requestedNamespaces(request.namespaces),
    storeAvailable: Boolean(store),
    isLoaded: store?.isLoaded === true,
    items: store?.items?.length ?? 0,
    lookup: lookupOutcome(store, request.lookups),
    failed: failure !== undefined || store?.failedLoading === true,
    error,
  };
}

/**
 * The one line an attempt logs. Terse and stable on purpose: these lines are
 * permanent instrumentation, echoed into the E2E job logs by the integration
 * error collector, and the only explanation available when a packed build
 * behaves differently from a local one (issue #38). `ns=*` means the store was
 * left to its own context namespaces.
 */
export function formatAttempt(outcome: AttemptOutcome): string {
  const namespaces = outcome.namespaces?.join(",") ?? "*";
  const head = `${referenceLogPrefix} reference store ${outcome.label}: attempt ${outcome.attempt} ns=${namespaces}`;
  const state = outcome.storeAvailable
    ? `isLoaded=${outcome.isLoaded} items=${outcome.items} lookup=${outcome.lookup}`
    : "store=unavailable";
  const failure = outcome.failed ? ` failed=true${outcome.error ? ` error=${outcome.error}` : ""}` : "";

  return `${head} ${state}${failure}`;
}

/**
 * Whether to ask the same store again: while attempts are left, anything short
 * of "loaded, without failures, holding what was asked for" is worth a retry.
 * A `n/a` lookup on a loaded store is complete, so it stops immediately.
 */
export function shouldRetry(outcome: AttemptOutcome, maxAttempts: number = defaultMaxAttempts): boolean {
  if (outcome.attempt >= maxAttempts) {
    return false;
  }

  return !outcome.storeAvailable || outcome.failed || !outcome.isLoaded || outcome.lookup === "miss";
}

/** Linear backoff, capped: 2s, 4s, 6s, 8s, 8s... after attempts 1, 2, 3, 4... */
export function retryDelayMs(attempt: number, baseDelayMs: number = defaultRetryDelayMs): number {
  return Math.min(baseDelayMs * Math.max(attempt, 1), maxRetryDelayMs);
}

/**
 * The dependency key of the loading effect: the requests are rebuilt on every
 * render, so the effect restarts only when what is actually being asked for
 * changes (another object opened in the drawer, or a store that was
 * unresolvable becoming available).
 */
export function referenceRequestsKey(requests: ReferenceRequest<unknown>[]): string {
  return requests
    .map((request) => {
      const namespaces = requestedNamespaces(request.namespaces)?.join(",") ?? "";
      const lookups = (request.lookups ?? [])
        .map((lookup) => `${lookup.name ?? ""}/${lookup.namespace ?? ""}`)
        .join(",");

      return `${request.label}!${request.store ? "y" : "n"}!${namespaces}!${lookups}`;
    })
    .join("|");
}

/**
 * Loads the stores a drawer needs while it is mounted. Call it once per
 * component with every store the drawer resolves references in; keep using
 * `objectExists` at render time (the components are MobX observers, so a store
 * filling in re-renders them and upgrades the rows to links).
 *
 * The store itself is the state and it is observable, so the hook keeps none
 * of its own except a render nudge for stores that were not resolvable yet.
 * Nothing is dispatched, logged or retried once the drawer is closed: the
 * cleanup stops the attempts, the timers and the watch.
 */
export function useReferenceStores(
  requests: ReferenceRequest<unknown>[],
  options: UseReferenceStoresOptions = {},
): void {
  const { maxAttempts = defaultMaxAttempts, retryDelayMs: baseDelayMs = defaultRetryDelayMs } = options;
  const key = referenceRequestsKey(requests);
  const latestRequests = React.useRef(requests);
  // The only state the hook keeps, and only for the `store=unavailable` case:
  // a CRD store that `maybe(() => Kind.getStore())` could not resolve is
  // re-resolved by the caller on its next render, and nothing observable would
  // ask for one. Bounded by the attempt budget, and never dispatched after the
  // component unmounted.
  const [, refresh] = React.useReducer((renders: number) => renders + 1, 0);

  latestRequests.current = requests;

  React.useEffect(() => {
    let mounted = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const disposers: (() => void)[] = [];
    const subscribed = new Set<number>();

    const attemptLoad = async (index: number, attempt: number): Promise<void> => {
      const request = latestRequests.current[index];

      if (!mounted || !request) {
        return;
      }

      const store = request.store;
      let failure: unknown;

      if (store) {
        try {
          // Explicit namespaces when the caller knows them, `merge: true` so
          // other namespaces already in the store are kept, and
          // `onLoadFailure` so a listing error is reported here instead of
          // being swallowed by the host's own warning path.
          await store.loadAll({
            namespaces: requestedNamespaces(request.namespaces),
            merge: true,
            onLoadFailure: (error) => {
              failure ??= error;
            },
          });
        } catch (error) {
          failure ??= error;
        }
      }

      if (!mounted) {
        return;
      }

      const outcome = readAttempt(request, attempt, failure);

      console.info(formatAttempt(outcome));

      if (store?.subscribe && !subscribed.has(index) && outcome.isLoaded && !outcome.failed) {
        // Watching starts only after a successful load: the host's `subscribe`
        // watches the namespaces that load recorded. `maybe` keeps a store
        // that cannot be watched from breaking the drawer.
        subscribed.add(index);

        const disposer = maybe(() => store.subscribe?.());

        if (disposer) {
          disposers.push(disposer);
        }
      }

      if (!outcome.storeAvailable && shouldRetry(outcome, maxAttempts)) {
        refresh();
      }

      if (shouldRetry(outcome, maxAttempts)) {
        const timer = setTimeout(
          () => {
            timers.delete(timer);
            void attemptLoad(index, attempt + 1);
          },
          retryDelayMs(attempt, baseDelayMs),
        );

        timers.add(timer);
      }
    };

    latestRequests.current.forEach((_request, index) => {
      void attemptLoad(index, 1);
    });

    return () => {
      mounted = false;

      for (const timer of timers) {
        clearTimeout(timer);
      }

      timers.clear();

      for (const dispose of disposers) {
        maybe(() => dispose());
      }
    };
  }, [key, maxAttempts, baseDelayMs]);
}
