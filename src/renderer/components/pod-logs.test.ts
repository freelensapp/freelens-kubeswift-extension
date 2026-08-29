import { describe, expect, it } from "vitest";
import { defaultContainerAnnotation, findDefaultContainer, findDefaultContainerOfPod } from "./pod-logs";

// The rule Kubernetes documents and Freelens core implements for its own Pods
// list, restated here because core does not export it through the extension API
// (SPEC-0008). Everything is a plain object: no host global is needed.
describe("findDefaultContainer", () => {
  const launcher = { name: "launcher" };
  const materialize = { name: "sandbox-materialize" };

  it("picks the container the annotation names", () => {
    expect(
      findDefaultContainer(
        [materialize, launcher],
        [`${defaultContainerAnnotation}=launcher`, "example.com/other=value"],
      ),
    ).toBe(launcher);
  });

  it("falls back to the first container when the annotation names an unknown one", () => {
    expect(findDefaultContainer([materialize, launcher], [`${defaultContainerAnnotation}=sidecar`])).toBe(materialize);
  });

  it("falls back to the first container when there is no annotation", () => {
    expect(findDefaultContainer([materialize, launcher], [])).toBe(materialize);
  });

  it("picks an init container when the pod has nothing else", () => {
    // `getAllContainers()` includes the init containers, which is what makes
    // the sandbox-materialize logs reachable at all.
    expect(findDefaultContainer([materialize], [])).toBe(materialize);
  });

  it("returns nothing for a pod with no containers, so the caller renders no affordance", () => {
    expect(findDefaultContainer([], [`${defaultContainerAnnotation}=launcher`])).toBeUndefined();
    expect(findDefaultContainer([], [])).toBeUndefined();
  });

  it("ignores an annotation whose value is empty", () => {
    expect(findDefaultContainer([materialize, launcher], [`${defaultContainerAnnotation}=`])).toBe(materialize);
  });
});

describe("findDefaultContainerOfPod", () => {
  it("reads the containers and the annotations off the pod", () => {
    const launcher = { name: "launcher" };
    const pod = {
      getAllContainers: () => [{ name: "sandbox-materialize" }, launcher],
      getAnnotations: () => [`${defaultContainerAnnotation}=launcher`],
    };

    expect(findDefaultContainerOfPod(pod)).toBe(launcher);
  });

  it("returns nothing for a pod that reports no containers", () => {
    const pod = { getAllContainers: () => [], getAnnotations: () => [] };

    expect(findDefaultContainerOfPod(pod)).toBeUndefined();
  });
});
