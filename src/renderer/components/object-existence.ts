/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Whether a referenced object (a Node, a Pod, another KubeSwift CRD
// instance...) actually exists in the cluster, so a detail view can degrade a
// reference to plain text instead of a link that errors when clicked
// (DESIGN.md section 3, issue #23: core's `LinkToNode`/`LinkToPod` and
// `Renderer.Component.LinkToObject` all build a details URL from the
// name/ref alone and never check the target exists).
//
// Pure functions of a store and a name/namespace (or a store and a loading
// state), not JSX and not a direct `Renderer.K8sApi`/`getStore()` read, so
// they stay unit-testable without stubbing the host global (the same shape
// as the status classifiers DESIGN.md section 2 asks for).

/** The slice of `Renderer.K8sApi`'s `KubeObjectStore` `objectExists` needs. */
export interface ObjectLookupStore<T> {
  getByName(name: string, namespace?: string): T | undefined;
}

/**
 * True when `store` currently has an item named `name` (optionally scoped to
 * `namespace`, for namespaced kinds). `store` and `name` are both accepted as
 * possibly absent so callers do not need a separate guard: a `DrawerItem`
 * without a name to look up, a host surface not wired up (defensive only;
 * `Renderer.K8sApi` always provides `nodesStore`/`podsStore`), or a CRD store
 * that `<Kind>.getStore()` could not resolve (it throws rather than
 * returning `undefined`, so callers wrap it in `maybe()` first, which yields
 * `null` on failure) all simply report "does not exist".
 */
export function objectExists<T>(
  store: ObjectLookupStore<T> | null | undefined,
  name: string | undefined,
  namespace?: string,
): boolean {
  if (!store || !name) {
    return false;
  }

  return store.getByName(name, namespace) !== undefined;
}

/** The slice of `KubeObjectStore` `ensureLoaded` needs, on top of `ObjectLookupStore`. */
export interface LoadableStore<T> extends ObjectLookupStore<T> {
  isLoaded: boolean;
  isLoading: boolean;
  loadAll(): Promise<unknown>;
}

/**
 * Triggers a one-time `loadAll()` on `store` if it has neither loaded nor
 * started loading yet. Meant to be called from a `useEffect` with an empty
 * dependency array: a detail view referencing another kind's store (for
 * example a SwiftSnapshot linking to the SwiftGuest it was taken from, or
 * this repo's own SwiftGuest linking to a core Node/Pod) cannot assume that
 * store is already populated - nothing else on the page necessarily loaded
 * it. A no-op for `store` being `null`/`undefined`, so callers can pass the
 * result of `maybe(() => Kind.getStore())` straight through.
 */
export function ensureLoaded(store: LoadableStore<unknown> | null | undefined): void {
  if (store && !store.isLoaded && !store.isLoading) {
    void store.loadAll();
  }
}
