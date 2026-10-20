/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Key and value rows, the repeatable shape of every map the sandbox create forms
// author since KubeSwift v0.18.0 (SPEC-0019 T4): the labels of an ingress pod
// selector, the claims of an artifact, and the labels of the launcher pod. Pure
// functions over plain arrays, so each owner keeps its rows wherever it likes
// and replaces them with what these return.

import { nextRowId } from "./guest-create";

/** One entry of a string map, as a repeatable row. */
export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

/** The two fields a row carries a message on. */
export type KeyValueField = "key" | "value";

export type KeyValueMessages = Partial<Record<KeyValueField, string>>;

/** The reading order of a row's two fields, for the sentence next to a blocked submit. */
export const keyValueFieldOrder: KeyValueField[] = ["key", "value"];

/** A fresh, empty row whose id follows the rows that exist (the `nextRowId` idiom). */
export function addKeyValueRow(rows: readonly KeyValueRow[], prefix: string): KeyValueRow[] {
  return [...rows, { id: nextRowId(prefix, rows), key: "", value: "" }];
}

export function removeKeyValueRow(rows: readonly KeyValueRow[], id: string): KeyValueRow[] {
  return rows.filter((row) => row.id !== id);
}

export function updateKeyValueRow(
  rows: readonly KeyValueRow[],
  id: string,
  patch: Partial<KeyValueRow>,
): KeyValueRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

/** A DNS-1123 subdomain: the optional prefix of a label key. */
const dnsSubdomainPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** The name part of a label key, and the whole of a non-empty label value. */
const labelSegmentPattern = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;

const maxLabelSegmentLength = 63;

const maxLabelPrefixLength = 253;

/** What a label key that Kubernetes would refuse is refused with. */
export const labelKeyMessage =
  "A label key is a name of at most 63 letters, digits, '-', '_' and '.', starting and ending with a letter or a " +
  "digit, optionally after a DNS subdomain prefix and a '/' (example.com/app). The API server refuses any other.";

/** What a label value that Kubernetes would refuse is refused with. */
export const labelValueMessage =
  "A label value is at most 63 letters, digits, '-', '_' and '.', starting and ending with a letter or a digit, " +
  "or empty. The API server refuses any other.";

/** Why a label key would be refused, or `undefined` when it is legal (or empty). */
export function labelKeyError(key: string): string | undefined {
  const value = key.trim();

  if (!value) {
    return undefined;
  }

  const slash = value.indexOf("/");
  const prefix = slash < 0 ? undefined : value.slice(0, slash);
  const name = slash < 0 ? value : value.slice(slash + 1);

  if (
    prefix !== undefined &&
    (!prefix || prefix.length > maxLabelPrefixLength || !dnsSubdomainPattern.test(prefix) || name.includes("/"))
  ) {
    return labelKeyMessage;
  }

  if (!name || name.length > maxLabelSegmentLength || !labelSegmentPattern.test(name)) {
    return labelKeyMessage;
  }

  return undefined;
}

/** Why a label value would be refused, or `undefined` when it is legal. */
export function labelValueError(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > maxLabelSegmentLength || !labelSegmentPattern.test(trimmed) ? labelValueMessage : undefined;
}

/** How one map's rows are checked: which syntax the keys and values follow, and what an extra key rule says. */
export interface KeyValueRules {
  /** `label` for Kubernetes labels; `free` for a map whose keys and values carry no syntax of their own. */
  syntax: "label" | "free";
  /** What the map is, in the sentence about a duplicate key. */
  what: string;
  /** A rule of the owner's beyond the syntax, such as a refused domain. */
  keyRule?: (key: string) => string | undefined;
}

/**
 * Every message of one map's rows.
 *
 * A row with a value and no key is refused, because a map has no such entry and
 * the value would silently not be sent; an entirely empty row is not an error
 * and is dropped from the payload. A key a second row repeats is refused,
 * because a map keeps one of the two and says nothing.
 */
export function keyValueRowErrors(rows: readonly KeyValueRow[], rules: KeyValueRules): KeyValueMessages[] {
  return rows.map((row, index) => {
    const messages: KeyValueMessages = {};
    const key = row.key.trim();
    const value = row.value.trim();

    if (!key && value) {
      messages.key = `A key is required once the row has a value: ${rules.what} is a map, so a value with no key would simply not be sent.`;
    } else if (key) {
      const syntax = rules.syntax === "label" ? labelKeyError(key) : undefined;
      const owner = syntax ? undefined : rules.keyRule?.(key);

      if (syntax ?? owner) {
        messages.key = syntax ?? owner;
      } else if (rows.some((other, otherIndex) => otherIndex < index && other.key.trim() === key)) {
        messages.key = `Another row already sets ${key}, and ${rules.what} is a map: one of the two would silently replace the other.`;
      }
    }

    const valueError = rules.syntax === "label" ? labelValueError(row.value) : undefined;

    if (valueError) {
      messages.value = valueError;
    }

    return messages;
  });
}

/** The rows as the map the CRD declares, or `undefined` when no row carries a key. */
export function keyValuePayload(rows: readonly KeyValueRow[]): Record<string, string> | undefined {
  const entries = rows.map((row) => [row.key.trim(), row.value.trim()] as const).filter(([key]) => key !== "");

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
