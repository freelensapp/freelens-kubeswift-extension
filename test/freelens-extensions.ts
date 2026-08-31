// Minimal stub of the host-provided `@freelensapp/extensions` module.
//
// At runtime Freelens injects this module as the `global.LensExtensions`
// global, so it is never bundled (see `globalExternals` in
// `electron.vite.config.js`) and cannot be imported in a plain Node/vitest
// process - the real package pulls in Electron. Unit tests alias the import to
// this file instead (see the `alias` option in `vitest.config.ts`).
//
// Only the surface actually exercised by the tests is stubbed here. Extend it
// as your tests need more of the host API.
import { vi } from "vitest";

class LensExtensionKubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: unknown;
  status?: unknown;

  constructor(data: Record<string, unknown> = {}) {
    Object.assign(this, data);
  }

  // Mirrors `@freelensapp/kube-object`'s `KubeObject.getName()`, which the
  // model helpers that match objects by name call on the real host object.
  getName(): string {
    return this.metadata?.name ?? "";
  }

  // Mirrors `@freelensapp/kube-object`'s `KubeObject.getNs()`, which detail
  // views and link-target helpers call on the real host object.
  getNs(): string | undefined {
    return this.metadata?.namespace || undefined;
  }
}

export const Renderer = {
  K8sApi: {
    LensExtensionKubeObject,
    KubeApi: class KubeApi {},
    KubeObjectStore: class KubeObjectStore {},
  },
  // The shared form primitives (`create-dialog.tsx`) destructure the host's
  // components at module scope, so importing that module in a unit test needs
  // the names to exist. Nothing here is rendered by the unit tests - they cover
  // the pure decisions of that file, not its JSX - so the stubs only have to be
  // valid component references.
  Component: {
    Input: () => null,
    Select: () => null,
  },
};

export const Common = {
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
};
