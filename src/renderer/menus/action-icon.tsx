/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The icon every action of this extension renders, in both surfaces one
// `kubeObjectMenuItems` registration reaches (W5), and the single place that
// decides what a DISABLED action looks like.
//
// It exists because of the M7 milestone review (2026-09-01): in the detail
// drawer's toolbar the reason a guard refused is carried by the item's `title`
// attribute and by the drawer's own explanation row, and neither of those is
// visible until the user goes looking. Roberto's ruling is that the refusal has
// to be visible ON THE ICON, and that the fix is cross-cutting - it belongs to
// every action registered since SPEC-0010, not to the consoles that surfaced
// it. So it lives here, and the seven items say `disabled` instead of styling
// anything themselves.
//
// Three host facts (Freelens 1.10.3) shape what this does:
//
// - The host does NOT leave a disabled toolbar item undimmed: menu.scss's
//   `.MenuItem.disabled` sets `opacity: 0.5` and it applies in both surfaces
//   (measured on this repository's own artifacts: white icons at 255,255,255
//   next to disabled ones at 162,208,205 on the drawer title bar, which is
//   exactly half). The review's finding is therefore about DEGREE, not about
//   the absence of an affordance - half opacity on that background reads as a
//   slightly different shade rather than as a dead control.
// - `Icon` accepts `disabled`, but its stylesheet answers it with
//   `opacity: 0.5; color: inherit !important` (icon.scss). In the drawer title
//   bar `color: inherit` throws away `--drawerTitleText` (`#ffffff` in both
//   themes) for the `MenuItem`'s `--textColorPrimary` - `#8e9297` dark,
//   `#555555` light - so passing the prop would recolour the icon differently
//   per theme on a background that does not change. Rejected for that reason,
//   not for the opacity, which is the half this class keeps.
// - In the row kebab the host already greys the WHOLE item, icon and label
//   together, which is the correct rendering there and is left exactly as it
//   is. Dimming the icon a second time would make it darker than its own label.
//   Hence `toolbar &&`: the class is the toolbar's answer to what the kebab
//   already says in words.

import { Renderer } from "@freelensapp/extensions";
import styles from "./action-icon.module.scss";
import stylesInline from "./action-icon.module.scss?inline";

const {
  Component: { Icon },
} = Renderer;

export interface ActionIconProps {
  /** A host Material ligature: an unknown name renders as its own word rather than failing. */
  material: string;
  /** The verb, or the verb and the guard's reason - the same string the item's `title` carries. */
  tooltip: string;
  /** The guard's verdict, negated: true when the action is offered but refused. */
  disabled: boolean;
  /** What the host passes for the drawer toolbar; absent in the list row kebab. */
  toolbar?: boolean;
}

export function ActionIcon({ material, tooltip, disabled, toolbar }: ActionIconProps) {
  const dimmed = disabled && Boolean(toolbar);

  return (
    <>
      {/* The v1 extension API injection idiom, rendered only when a rule is
          actually used: an enabled toolbar and every kebab cost nothing. */}
      {dimmed ? <style>{stylesInline}</style> : null}
      <Icon
        material={material}
        interactive={toolbar}
        tooltip={tooltip}
        tooltipOverrideDisabled
        className={dimmed ? styles.disabledIcon : undefined}
      />
    </>
  );
}
