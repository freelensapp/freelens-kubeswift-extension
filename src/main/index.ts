import { Main } from "@freelensapp/extensions";

/**
 * Main-process entry point of the extension.
 *
 * The extension is CRD-native and reads everything from the Kubernetes API in
 * the renderer process, so there is nothing to do here yet.
 */
export default class KubeSwiftMain extends Main.LensExtension {}
