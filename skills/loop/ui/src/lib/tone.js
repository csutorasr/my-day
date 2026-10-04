// Status tones (format.js speaks 'ok' / 'warn' / 'wait' / 'bad' / 'accent' / '') as Tailwind classes.
export const toneBadge = {
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  wait: 'bg-warning-soft text-warning',
  bad: 'bg-danger-soft text-danger',
  accent: 'bg-primary/10 text-link',
  '': 'bg-muted text-muted-foreground',
};

export const toneDot = {
  ok: 'bg-success',
  warn: 'bg-warning',
  wait: 'bg-warning',
  bad: 'bg-danger',
  accent: 'bg-primary',
  '': 'bg-muted-foreground/40',
};
