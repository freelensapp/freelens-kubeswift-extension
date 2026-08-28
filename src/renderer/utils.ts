/**
 * Utility functions shared by renderer-side components.
 */

const EDITOR_LINE_HEIGHT_PX = 18;
const EDITOR_MIN_LINES = 5;
const EDITOR_MAX_LINES = 20;

/**
 * Clamped initial height for a read-only `MonacoEditor` showing a text blob
 * in a detail drawer (approach used by freelens-fluxcd-extension's
 * `yaml-dump.tsx`, MIT-licensed, reimplemented here for our own blobs): short
 * values are not stretched to a tall, mostly-empty box, and long ones do not
 * push the rest of the drawer off screen. The editor keeps its own scrollbar
 * once the content exceeds the clamp, so nothing is ever truncated.
 */
export function getBlobEditorHeight(value: string): number {
  const lines = value ? value.split("\n").length : 1;
  const clampedLines = Math.min(Math.max(lines, EDITOR_MIN_LINES), EDITOR_MAX_LINES);

  return clampedLines * EDITOR_LINE_HEIGHT_PX;
}
