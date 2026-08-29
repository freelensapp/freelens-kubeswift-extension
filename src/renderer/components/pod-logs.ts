/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Which container of a pod a log tab should open on.
//
// `Renderer.Component.logTabStore.createPodTab` takes the container to show as
// well as the pod, and Freelens core has exactly this rule already (its Pods
// list uses it for the logs button in every row) - but it does not export it
// through the extension API, so it is reimplemented here. Both codebases are
// MIT, so this is a convenience question rather than a licensing one; the rule
// itself is Kubernetes' own `kubectl.kubernetes.io/default-container`
// convention, which is why it is safe to restate.
//
// `Pod.getAllContainers()` includes the init containers, which is what puts the
// `sandbox-materialize` logs - the artefact upstream's troubleshooting section
// points at for a sandbox stuck `Materializing` or failing its image pull - one
// container switch away inside the tab this picks the first container of.
//
// Declared structurally (no `Renderer` import) so it stays unit-testable with
// plain objects, the same shape as `object-existence.ts`.

/** The annotation Kubernetes uses to name a pod's principal container. */
export const defaultContainerAnnotation = "kubectl.kubernetes.io/default-container";

/** The slice of a container this module needs. */
export interface NamedContainer {
  name: string;
}

/** The slice of `Pod` this module needs, as core's `KubeObject` exposes it. */
export interface PodWithContainers<T extends NamedContainer = NamedContainer> {
  getAllContainers(): T[];
  /** Core returns annotations as `key=value` strings, not as a map. */
  getAnnotations(filter?: boolean): string[];
}

/**
 * The container a log tab should open on: the one the
 * `kubectl.kubernetes.io/default-container` annotation names, falling back to
 * the first container when the annotation is missing or names a container this
 * pod does not have.
 *
 * Returns `undefined` for a pod with no containers at all, so the caller can
 * render no affordance rather than a control that cannot do anything.
 */
export function findDefaultContainer<T extends NamedContainer>(
  containers: readonly T[],
  annotations: readonly string[],
): T | undefined {
  const prefix = `${defaultContainerAnnotation}=`;
  const annotated = annotations.find((annotation) => annotation.startsWith(prefix))?.slice(prefix.length);

  if (annotated) {
    const named = containers.find((container) => container.name === annotated);

    if (named) {
      return named;
    }
  }

  return containers[0];
}

/** `findDefaultContainer` over a pod, which is how every caller uses it. */
export function findDefaultContainerOfPod<T extends NamedContainer>(pod: PodWithContainers<T>): T | undefined {
  return findDefaultContainer(pod.getAllContainers(), pod.getAnnotations(true));
}
