import { Renderer } from "@freelensapp/extensions";

import type {
  SwiftGuestLabelSelector,
  SwiftGuestSpec,
  SwiftGuestTopologySpreadConstraint,
} from "./swiftguest-v1alpha1";
import type { Condition, KubeSwiftKubeObjectCRD, Quantity } from "./types";

/**
 * Model for `swiftguestpools.swift.kubeswift.io/v1alpha1`.
 *
 * A guest pool manages a fleet of identical guests with ReplicaSet-style
 * semantics. The interfaces below are written from the published
 * CustomResourceDefinition schema, whose `spec.template.spec` is the SwiftGuest
 * spec schema verbatim, so the guest template reuses `SwiftGuestSpec` rather
 * than restating it.
 */

export type SwiftGuestPoolSpreadPolicy = "Pack" | "Spread";

export type SwiftGuestPoolUpdateStrategyType = "RollingUpdate" | "Recreate";

export type SwiftGuestPoolServiceType = "ClusterIP" | "NodePort" | "LoadBalancer";

export type SwiftGuestPoolProtocol = "TCP" | "UDP" | "SCTP";

export interface SwiftGuestPoolServicePort {
  port: number;
  expose?: SwiftGuestPoolServiceType;
  name?: string;
  protocol?: SwiftGuestPoolProtocol;
  targetPort?: number;
}

/** One load-balanced Service in front of every replica of the pool. */
export interface SwiftGuestPoolService {
  ports: SwiftGuestPoolServicePort[];
  annotations?: Record<string, string>;
  headless?: boolean;
  loadBalancerClass?: string;
  type?: SwiftGuestPoolServiceType;
}

export interface SwiftGuestPoolRollingUpdate {
  maxSurge: number;
  maxUnavailable: number;
}

export interface SwiftGuestPoolUpdateStrategy {
  rollingUpdate?: SwiftGuestPoolRollingUpdate;
  type?: SwiftGuestPoolUpdateStrategyType;
}

/** The subset of `ObjectMeta` the CRD allows on the pool's templates. */
export interface SwiftGuestPoolTemplateMetadata {
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
  name?: string;
}

export interface SwiftGuestPoolGuestTemplate {
  spec: SwiftGuestSpec;
  metadata?: SwiftGuestPoolTemplateMetadata;
}

export interface SwiftGuestPoolTypedObjectReference {
  kind: string;
  name: string;
  apiGroup?: string;
  /** Only `dataSourceRef` may cross namespaces. */
  namespace?: string;
}

export interface SwiftGuestPoolVolumeResourceRequirements {
  limits?: Record<string, Quantity>;
  requests?: Record<string, Quantity>;
}

export interface SwiftGuestPoolVolumeClaimSpec {
  accessModes?: string[];
  dataSource?: SwiftGuestPoolTypedObjectReference;
  dataSourceRef?: SwiftGuestPoolTypedObjectReference;
  resources?: SwiftGuestPoolVolumeResourceRequirements;
  selector?: SwiftGuestLabelSelector;
  storageClassName?: string;
  volumeAttributesClassName?: string;
  volumeMode?: string;
  volumeName?: string;
}

/** Per-replica PVC, owned by the pool rather than by the individual guests. */
export interface SwiftGuestPoolVolumeClaimTemplate {
  metadata: SwiftGuestPoolTemplateMetadata;
  spec: SwiftGuestPoolVolumeClaimSpec;
}

export interface SwiftGuestPoolSpec {
  replicas: number;
  template: SwiftGuestPoolGuestTemplate;
  service?: SwiftGuestPoolService;
  spreadPolicy?: SwiftGuestPoolSpreadPolicy;
  topologySpreadConstraints?: SwiftGuestTopologySpreadConstraint[];
  updateStrategy?: SwiftGuestPoolUpdateStrategy;
  volumeClaimTemplates?: SwiftGuestPoolVolumeClaimTemplate[];
}

export interface SwiftGuestPoolStatus {
  availableReplicas?: number;
  conditions?: Condition[];
  /** Hash of the template the pool is currently rolling out. */
  currentTemplateHash?: string;
  failedReplicas?: number;
  readyReplicas?: number;
  replicas?: number;
  /** Name of the Service the pool created, unset when `spec.service` is not. */
  serviceRef?: string;
  updatedReplicas?: number;
}

export class SwiftGuestPool extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftGuestPoolStatus,
  SwiftGuestPoolSpec
> {
  static readonly kind = "SwiftGuestPool";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/swift.kubeswift.io/v1alpha1/swiftguestpools";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["swift.kubeswift.io/v1alpha1"],
    plural: "swiftguestpools",
    singular: "swiftguestpool",
    shortNames: ["sgpool"],
    title: "SwiftGuestPools",
  };

  /**
   * The CRD defaults `replicas` to 1, but the field is only defaulted once the
   * API server has admitted the object.
   */
  static getDesiredReplicas(object: SwiftGuestPool): number {
    return object.spec?.replicas ?? 1;
  }

  static getCurrentReplicas(object: SwiftGuestPool): number {
    return object.status?.replicas ?? 0;
  }

  static getReadyReplicas(object: SwiftGuestPool): number {
    return object.status?.readyReplicas ?? 0;
  }

  static getUpdatedReplicas(object: SwiftGuestPool): number {
    return object.status?.updatedReplicas ?? 0;
  }

  static getAvailableReplicas(object: SwiftGuestPool): number {
    return object.status?.availableReplicas ?? 0;
  }

  static getFailedReplicas(object: SwiftGuestPool): number {
    return object.status?.failedReplicas ?? 0;
  }

  /** The CRD defaults the update strategy to a rolling update. */
  static getUpdateStrategyType(object: SwiftGuestPool): SwiftGuestPoolUpdateStrategyType {
    return object.spec?.updateStrategy?.type ?? "RollingUpdate";
  }

  /** The CRD defaults the spread policy to packing replicas together. */
  static getSpreadPolicy(object: SwiftGuestPool): SwiftGuestPoolSpreadPolicy {
    return object.spec?.spreadPolicy ?? "Pack";
  }

  /** The guest spec every replica of the pool is created from. */
  static getGuestTemplateSpec(object: SwiftGuestPool): SwiftGuestSpec | undefined {
    return object.spec?.template?.spec;
  }

  /**
   * `status.serviceRef` is a plain Service name, not an object reference, and
   * stays empty until the pool's Service exists.
   */
  static getServiceName(object: SwiftGuestPool): string | undefined {
    return object.status?.serviceRef || undefined;
  }

  static getServicePorts(object: SwiftGuestPool): SwiftGuestPoolServicePort[] {
    return object.spec?.service?.ports ?? [];
  }

  static getVolumeClaimTemplates(object: SwiftGuestPool): SwiftGuestPoolVolumeClaimTemplate[] {
    return object.spec?.volumeClaimTemplates ?? [];
  }
}

export class SwiftGuestPoolApi extends Renderer.K8sApi.KubeApi<SwiftGuestPool> {}
export class SwiftGuestPoolStore extends Renderer.K8sApi.KubeObjectStore<SwiftGuestPool, SwiftGuestPoolApi> {}
