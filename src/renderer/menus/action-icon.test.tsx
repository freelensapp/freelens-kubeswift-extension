// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionIcon } from "./action-icon";
import styles from "./action-icon.module.scss";

// The one decision `ActionIcon` makes - and the reason it exists as a component
// rather than as a copied `className` expression in seven files (M7 milestone
// review, 2026-09-01): the dimming class goes on a refused action IN THE
// TOOLBAR, and nowhere else. The kebab is the host's to grey, and it greys the
// whole item, label included; a second dim there would leave the icon darker
// than its own words.
//
// The E2E half of this - that the class really lands at a lower computed
// opacity than an enabled sibling, in a real Freelens, in both themes - is in
// `e2e/__tests__/kubeswift-e2e.tests.ts`. This half is what makes a regression
// in the CONDITION cheap to catch.

afterEach(() => {
  cleanup();
});

function icon(container: HTMLElement): HTMLElement {
  const element = container.querySelector("i.Icon");

  if (!element) {
    throw new Error("ActionIcon rendered no icon");
  }

  return element as HTMLElement;
}

describe("ActionIcon", () => {
  it("dims a refused action in the drawer toolbar", () => {
    const { container } = render(
      <ActionIcon material="play_arrow" tooltip="Start: already set to run" disabled toolbar />,
    );

    expect(icon(container).className).toContain(styles.disabledIcon);
    // The stylesheet travels with the class, since the v1 extension API injects
    // its CSS this way.
    expect(container.querySelector("style")).not.toBeNull();
  });

  it("leaves an offered action in the toolbar alone", () => {
    const { container } = render(<ActionIcon material="play_arrow" tooltip="Start" disabled={false} toolbar />);

    expect(icon(container).className).not.toContain(styles.disabledIcon);
    expect(container.querySelector("style")).toBeNull();
  });

  it("leaves the row kebab to the host, which greys the whole item", () => {
    const { container } = render(<ActionIcon material="play_arrow" tooltip="Start: already set to run" disabled />);

    expect(icon(container).className).not.toContain(styles.disabledIcon);
    expect(container.querySelector("style")).toBeNull();
  });

  it("keeps the host idiom the toolbar needs: an interactive icon carrying the reason", () => {
    const { container } = render(
      <ActionIcon material="terminal" tooltip="Serial Console: no launcher pod" disabled toolbar />,
    );

    expect(icon(container).className).toContain("interactive");
    expect(icon(container).getAttribute("data-tooltip")).toBe("Serial Console: no launcher pod");
    expect(icon(container).getAttribute("data-material")).toBe("terminal");
  });
});
