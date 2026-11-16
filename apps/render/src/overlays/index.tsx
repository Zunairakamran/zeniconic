/**
 * One component per overlay style. The switch is exhaustive over the styles the
 * layout package can emit; an unknown style from a newer EDL falls back to
 * small print rather than rendering nothing.
 */

import { AddressTag } from './address_tag';
import { CtaCard } from './cta_card';
import { LogoCorner } from './logo_corner';
import { PermitLine } from './permit_line';
import { PriceLower } from './price_lower';
import { RoomLabel } from './room_label';
import { SmallPrint } from './small_print';
import { SpecPill } from './spec_pill';
import type { OverlayBodyProps } from './types';

export function OverlayBody(props: OverlayBodyProps) {
  switch (props.layout.style) {
    case 'price_lower':
      return <PriceLower {...props} />;
    case 'address_tag':
      return <AddressTag {...props} />;
    case 'logo_corner':
      return <LogoCorner {...props} />;
    case 'cta_card':
      return <CtaCard {...props} />;
    case 'spec_pill':
      return <SpecPill {...props} />;
    case 'small_print':
      return <SmallPrint {...props} />;
    case 'permit_line':
      return <PermitLine {...props} />;
    case 'caption':
      return <RoomLabel {...props} />;
    default:
      return <SmallPrint {...props} />;
  }
}

export type { OverlayBodyProps } from './types';
export { AddressTag } from './address_tag';
export { CtaCard } from './cta_card';
export { LogoCorner } from './logo_corner';
export { PermitLine } from './permit_line';
export { PriceLower } from './price_lower';
export { RoomLabel } from './room_label';
export { SmallPrint } from './small_print';
export { SpecPill, specPills } from './spec_pill';
