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
// Pure functions of a store and a name/namespace, not JSX and not a direct
// `Renderer.K8sApi`/`getStore()` read, so they stay unit-testable without
// stubbing the host global (the same shape as the status classifiers
// DESIGN.md section 2 asks for).
//
// This module answers "is it there right now"; getting the store to hold it
// in the first place is `reference-loader.ts` (issue #38).

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

/** The slice of a KubeObject a `LinkToObject` target is built from. */
export interface ReferenceableObject {
  apiVersion: string;
  getName(): string;
  /** Absent on cluster-scoped kinds, which is exactly what the ref then carries. */
  getNs?(): string | undefined;
}

/** What `Renderer.Component.LinkToObject` resolves a link from, structurally. */
export interface ExistingObjectRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
}

/**
 * The link target of the object named `name`, or `undefined` when the store
 * does not currently hold it - which is the same rule `objectExists` states,
 * with the ref built in the same step so a caller cannot check one object and
 * link another.
 *
 * The `apiVersion` and the namespace are read off the object the store found
 * rather than restated by the caller, so the ref describes what is actually
 * there. Declared structurally (no `Renderer` import, no `KubeObjectRef`
 * import) so this module stays a pure, host-free pair of lookups; the returned
 * shape is what `LinkToObject` takes.
 */
export function existingObjectRef<T extends ReferenceableObject>(
  store: ObjectLookupStore<T> | null | undefined,
  kind: string,
  name: string | undefined,
  namespace?: string,
): ExistingObjectRef | undefined {
  if (!store || !name) {
    return undefined;
  }

  const object = store.getByName(name, namespace);

  if (!object) {
    return undefined;
  }

  return { apiVersion: object.apiVersion, kind, name: object.getName(), namespace: object.getNs?.() };
}
