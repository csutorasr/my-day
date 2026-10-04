import { HugeiconsIcon } from '@hugeicons/react';

// The preset's icon set; decorative unless a label is passed.
export function Icon({ icon, className, label }) {
  return <HugeiconsIcon icon={icon} strokeWidth={2} className={className} aria-hidden={label ? undefined : true} aria-label={label} />;
}
