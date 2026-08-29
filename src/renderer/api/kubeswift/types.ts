import { Renderer } from "@freelensapp/extensions";

/**
 * Types shared by the KubeSwift (`swift.kubeswift.io`) resource models.
 *
 * They are written from the published CustomResourceDefinition schemas, no
 * type is imported or derived from the KubeSwift sources themselves.
 */

/**
 * Kubernetes `resource.Quantity`, for example `2Gi`.
 *
 * The CRD schemas declare quantities as `x-kubernetes-int-or-string`, so a bare
 * number is as valid on the wire as the usual string form.
 */
export type Quantity = number | string;

/**
 * Renders a quantity for display. Keeps `0` (a meaningful value) and maps an
 * unset quantity to `undefined`, so callers can apply their own fallback.
 */
export function formatQuantity(value?: Quantity): string | undefined {
  return value === undefined ? undefined : String(value);
}

const byteUnits = ["Ki", "Mi", "Gi", "Ti", "Pi"];

/**
 * Renders a byte count the way Kubernetes writes quantities, for example
 * `1.5Gi`. The snapshot and migration statuses report sizes as plain `int64`
 * byte counts rather than as quantities, which are unreadable as such in a
 * table cell.
 *
 * Keeps `0` (a captured snapshot of an empty disk is still a fact) and maps an
 * unset count to `undefined`, so callers can apply their own fallback.
 */
export function formatBytes(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  if (value < 1024) {
    return `${value}`;
  }

  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < byteUnits.length) {
    size /= 1024;
    unit += 1;
  }

  // One decimal, but never a trailing ".0": "1Gi" reads better than "1.0Gi".
  return `${Number(size.toFixed(1))}${byteUnits[unit - 1]}`;
}

/**
 * Renders a mebibyte count the way `formatBytes` renders a byte count, for
 * example `256Gi`. Several GPU fields (`numaTopology.memoryPerSocketMi` on a
 * profile, `host.numaNodes[].memoryMi` and `gpus[].barSizes[].sizeMi` on a
 * node) are counts of MiB rather than of bytes, so passing them to
 * `formatBytes` would under-report them by a factor of 1048576.
 *
 * Delegates the formatting itself, so there is one rule in one place, and
 * keeps `0` distinct from an unset count exactly as `formatBytes` does.
 */
export function formatMebibytes(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return formatBytes(value * 1024 * 1024);
}

/** Reference to another KubeSwift object living in the same namespace. */
export interface LocalObjectReference {
  name?: string;
}

/** Reference to an object in the same or in another namespace. */
export interface NamespacedObjectReference {
  name: string;
  namespace?: string;
}

/** Kubernetes core `ObjectReference`, used for `status.podRef`. */
export interface ObjectReference {
  apiVersion?: string;
  fieldPath?: string;
  kind?: string;
  name?: string;
  namespace?: string;
  resourceVersion?: string;
  uid?: string;
}

/** A reference to another KubeObject, resolvable by `Renderer.Component.LinkToObject`. */
export interface KubeObjectRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
}

/**
 * Builds a `Renderer.Component.LinkToObject` ref for a same-namespace
 * KubeSwift object, or `undefined` when the name is absent, so a detail
 * drawer falls back to "N/A" instead of rendering a dead link.
 */
export function toKubeObjectRef(
  kind: string,
  apiVersion: string,
  name: string | undefined,
  namespace: string | undefined,
): KubeObjectRef | undefined {
  if (!name) {
    return undefined;
  }

  return { apiVersion, kind, name, namespace };
}

/** Kubernetes `metav1.Condition`. */
export interface Condition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason: string;
  message: string;
  lastTransitionTime: string;
  observedGeneration?: number;
}

/** CRD metainfo with the title used as page and sidebar label. */
export interface KubeSwiftKubeObjectCRD extends Renderer.K8sApi.LensExtensionKubeObjectCRD {
  title: string;
}
