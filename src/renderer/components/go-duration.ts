/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Go's duration grammar, which every duration field of the sandbox kinds takes
// (`timeout`, `ttl`, `termination.drainPeriod`, an artifact's `fetchTimeout`)
// and none of them constrains with a pattern. Its own module so that the
// sandbox create forms' helper modules can parse one without importing the
// form module that imports them.

/** The unit suffixes Go's own duration parser accepts, longest first so `ms` beats `m`. */
const goDurationUnits: [string, number][] = [
  ["ns", 1e-6],
  ["us", 1e-3],
  ["µs", 1e-3],
  ["μs", 1e-3],
  ["ms", 1],
  ["s", 1000],
  ["m", 60_000],
  ["h", 3_600_000],
];

const goDurationTokenPattern = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/gy;

/**
 * A Go duration as milliseconds, or `undefined` when it is not one at all.
 *
 * Written from Go's own grammar - a sign, then one or more decimal-and-unit
 * pairs, with a bare `0` as the one value that needs no unit - because neither
 * `spec.timeout` nor `spec.ttl` carries a schema pattern or a format, and the
 * rules refusing a non-positive one are webhook-only. A negative value is
 * returned as a negative number rather than rejected here: the sign is what the
 * two refusals below are about, and the consequence of each differs.
 */
export function parseGoDurationMs(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const sign = trimmed.startsWith("-") ? -1 : 1;
  const body = trimmed.replace(/^[+-]/, "");

  if (!body) {
    return undefined;
  }

  // Go accepts a bare zero, with or without a unit, and nothing else unitless.
  if (/^0+(\.0*)?$/.test(body)) {
    return 0;
  }

  goDurationTokenPattern.lastIndex = 0;

  let total = 0;
  let consumed = 0;
  let match = goDurationTokenPattern.exec(body);

  while (match) {
    const magnitude = Number(match[1]);
    const unit = goDurationUnits.find(([suffix]) => suffix === match?.[2]);

    if (!Number.isFinite(magnitude) || !unit) {
      return undefined;
    }

    total += magnitude * unit[1];
    consumed = goDurationTokenPattern.lastIndex;
    match = goDurationTokenPattern.exec(body);
  }

  return consumed === body.length && consumed > 0 ? sign * total : undefined;
}
