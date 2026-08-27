import { Renderer } from "@freelensapp/extensions";

import type { Condition, KubeSwiftKubeObjectCRD } from "./types";

/**
 * Model for `swiftkernels.kernel.kubeswift.io/v1alpha1`.
 *
 * A SwiftKernel manages a kernel and initramfs OCI artifact that the controller
 * pulls onto the nodes labelled for kernel boot. The interfaces below are
 * written from the published CustomResourceDefinition schema.
 */

export type SwiftKernelPhase = "Pending" | "Pulling" | "Ready" | "Failed";

export interface SwiftKernelOciRef {
  image: string;
  /** Name of the image pull Secret used for private registries. */
  pullSecret?: string;
}

export interface SwiftKernelSpec {
  ociRef: SwiftKernelOciRef;
  /** Default kernel command line, overridable per guest. */
  kernelCmdline?: string;
  /** Informational label of the kernel profile. */
  profile?: string;
}

/** Pull progress of the artifact on one node. */
export interface SwiftKernelNodeStatus {
  nodeName: string;
  phase: SwiftKernelPhase;
}

export interface SwiftKernelStatus {
  conditions?: Condition[];
  /** Content digest of the initramfs layer. */
  initramfsDigest?: string;
  /** Content digest of the kernel layer. */
  kernelDigest?: string;
  nodeStatuses?: SwiftKernelNodeStatus[];
  phase?: SwiftKernelPhase;
}

export class SwiftKernel extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftKernelStatus,
  SwiftKernelSpec
> {
  static readonly kind = "SwiftKernel";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/kernel.kubeswift.io/v1alpha1/swiftkernels";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["kernel.kubeswift.io/v1alpha1"],
    plural: "swiftkernels",
    singular: "swiftkernel",
    shortNames: ["sk"],
    title: "SwiftKernels",
  };

  static getPhase(object: SwiftKernel): SwiftKernelPhase | undefined {
    return object.status?.phase;
  }

  /** The OCI artifact holding the kernel and the initramfs. */
  static getArtifact(object: SwiftKernel): string | undefined {
    return object.spec?.ociRef?.image;
  }

  static getProfile(object: SwiftKernel): string | undefined {
    return object.spec?.profile;
  }

  static getNodeStatuses(object: SwiftKernel): SwiftKernelNodeStatus[] {
    return object.status?.nodeStatuses ?? [];
  }

  /**
   * How many of the nodes the controller reports on already hold the artifact.
   * The controller only reports nodes labelled for kernel boot, so the total is
   * the number of candidate nodes, not the size of the cluster.
   */
  static getReadyNodeCount(object: SwiftKernel): { ready: number; total: number } {
    const nodeStatuses = SwiftKernel.getNodeStatuses(object);

    return {
      ready: nodeStatuses.filter((nodeStatus) => nodeStatus.phase === "Ready").length,
      total: nodeStatuses.length,
    };
  }
}

export class SwiftKernelApi extends Renderer.K8sApi.KubeApi<SwiftKernel> {}
export class SwiftKernelStore extends Renderer.K8sApi.KubeObjectStore<SwiftKernel, SwiftKernelApi> {}
