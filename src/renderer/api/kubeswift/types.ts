import { Renderer } from "@freelensapp/extensions";

/**
 * Types shared by the KubeSwift (`swift.kubeswift.io`) resource models.
 *
 * They are written from the published CustomResourceDefinition schemas, no
 * type is imported or derived from the KubeSwift sources themselves.
 */

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
