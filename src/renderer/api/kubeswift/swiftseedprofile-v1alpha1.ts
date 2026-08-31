import { Renderer } from "@freelensapp/extensions";

import type { KubeSwiftKubeObjectCRD } from "./types";

/**
 * Model for `swiftseedprofiles.seed.kubeswift.io/v1alpha1`.
 *
 * A seed profile carries the cloud-init NoCloud configuration rendered into the
 * seed ISO of a guest. Each of its three data fields is either inline in the
 * spec or a reference to a Secret or ConfigMap key, and the schema requires
 * either `userData` or `userDataFrom` - that half is a CEL rule on the spec and
 * is enforced on every cluster.
 *
 * The pair is NOT kept mutually exclusive by any layer, which this comment used
 * to claim (corrected in SPEC-0014 slice 2). Both documents forbid inline
 * beside a reference and nothing enforces it: an inline value beside a `*From`
 * resolves to the reference, a `secretKeyRef` beside a `configMapKeyRef`
 * resolves to the Secret by statement order, an empty `*From: {}` satisfies the
 * CEL rule and renders nothing, and a selector's `name` carries the core API's
 * `""` default. The Create Seed Profile form makes all four unreachable by
 * construction rather than validating them.
 *
 * The inline values may embed credentials. They are rendered read-only in the
 * detail panel and are never logged nor put in a table cell.
 */

export type SwiftSeedProfileDatasource = "NoCloud";

/** Selector of a key inside a Secret or a ConfigMap. */
export interface SwiftSeedProfileKeySelector {
  key: string;
  name?: string;
  optional?: boolean;
}

export interface SwiftSeedProfileDataValueFrom {
  configMapKeyRef?: SwiftSeedProfileKeySelector;
  secretKeyRef?: SwiftSeedProfileKeySelector;
}

export interface SwiftSeedProfileSpec {
  datasource: SwiftSeedProfileDatasource;
  /** Defaulted by the controller when neither this nor `metaDataFrom` is set. */
  metaData?: string;
  metaDataFrom?: SwiftSeedProfileDataValueFrom;
  networkData?: string;
  networkDataFrom?: SwiftSeedProfileDataValueFrom;
  userData?: string;
  userDataFrom?: SwiftSeedProfileDataValueFrom;
}

/** The CRD declares no status subresource: a seed profile never reports one. */
export type SwiftSeedProfileStatus = Record<string, never>;

export type SwiftSeedDataOrigin = "inline" | "secret" | "configMap";

/** Where one of the three cloud-init documents comes from. */
export interface SwiftSeedDataSource {
  origin: SwiftSeedDataOrigin;
  /** Label of the origin, short enough for a table cell. */
  title: string;
  /** Name of the Secret or ConfigMap holding the document. */
  name?: string;
  /** Key of the document inside the Secret or ConfigMap. */
  key?: string;
  optional?: boolean;
}

/**
 * Describes where a cloud-init document comes from, without ever touching the
 * content of the inline variant.
 */
function describeSeedData(value?: string, valueFrom?: SwiftSeedProfileDataValueFrom): SwiftSeedDataSource | undefined {
  if (value) {
    return { origin: "inline", title: "Inline" };
  }

  const secretKeyRef = valueFrom?.secretKeyRef;

  if (secretKeyRef) {
    return {
      origin: "secret",
      title: "Secret",
      name: secretKeyRef.name,
      key: secretKeyRef.key,
      optional: secretKeyRef.optional,
    };
  }

  const configMapKeyRef = valueFrom?.configMapKeyRef;

  if (configMapKeyRef) {
    return {
      origin: "configMap",
      title: "ConfigMap",
      name: configMapKeyRef.name,
      key: configMapKeyRef.key,
      optional: configMapKeyRef.optional,
    };
  }

  return undefined;
}

export class SwiftSeedProfile extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftSeedProfileStatus,
  SwiftSeedProfileSpec
> {
  static readonly kind = "SwiftSeedProfile";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/seed.kubeswift.io/v1alpha1/swiftseedprofiles";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["seed.kubeswift.io/v1alpha1"],
    plural: "swiftseedprofiles",
    singular: "swiftseedprofile",
    shortNames: ["ssp"],
    title: "Seed Profiles",
  };

  static getDatasource(object: SwiftSeedProfile): SwiftSeedProfileDatasource | undefined {
    return object.spec?.datasource;
  }

  static getUserDataSource(object: SwiftSeedProfile): SwiftSeedDataSource | undefined {
    return describeSeedData(object.spec?.userData, object.spec?.userDataFrom);
  }

  static getMetaDataSource(object: SwiftSeedProfile): SwiftSeedDataSource | undefined {
    return describeSeedData(object.spec?.metaData, object.spec?.metaDataFrom);
  }

  static getNetworkDataSource(object: SwiftSeedProfile): SwiftSeedDataSource | undefined {
    return describeSeedData(object.spec?.networkData, object.spec?.networkDataFrom);
  }
}

export class SwiftSeedProfileApi extends Renderer.K8sApi.KubeApi<SwiftSeedProfile> {}
export class SwiftSeedProfileStore extends Renderer.K8sApi.KubeObjectStore<SwiftSeedProfile, SwiftSeedProfileApi> {}
