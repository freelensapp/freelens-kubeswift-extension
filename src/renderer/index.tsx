/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";

/**
 * Renderer-process entry point of the extension.
 *
 * The KubeSwift resource views are being implemented milestone by milestone
 * (see `docs/development/ROADMAP.md`); each one registers itself here through
 * `kubeObjectDetailItems`, `clusterPages`, and `clusterPageMenus`.
 */
export default class KubeSwiftRenderer extends Renderer.LensExtension {}
