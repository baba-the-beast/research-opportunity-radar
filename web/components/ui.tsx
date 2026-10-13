/**
 * Shared UI primitives. Pages compose these instead of hand-rolling classes, so spacing, colour and
 * states stay consistent. Colours come from the tokens in styles/tokens.css.
 *
 * Accessibility built in: 44px touch targets below `sm`, visible focus (global :focus-visible ring),
 * every Field wires its label, hint and error to the control by id.
 */
import Link from 'next/link';
import { useId, type ReactNode } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ----------------------------------------------------------------------------------------------
 * Layout
 * -------------------------------------------------------------------------------------------- */

/** Page width and padding. `narrow` for forms and reading pages. */
export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className={cx('w-full mx-auto px-4 sm:px-8 py-8 sm:py-10 flex flex-col gap-8', narrow ? 'max-w-3xl' : 'max-w-6xl')}>
      {children}
    </div>
  );
}

/** Page title block. `back` renders a small link above the title. */
export function PageHeader({
  title,
  description,
  actions,
  back
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link href={back.href} className="self-start inline-flex items-center gap-1 min-h-11 -my-3 sm:min-h-0 sm:my-0 text-body-sm text-on-surface-variant hover:text-primary">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">arrow_back</span>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="font-headline-xl text-headline-lg sm:text-headline-xl text-on-surface">{title}</h1>
          {description && <p className="text-body-md text-on-surface-variant max-w-[68ch]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A bordered surface. Give it a title for a titled section; `flush` removes inner padding (for lists). */
export function Panel({
  title,
  description,
  actions,
  children,
  flush = false,
  as: Tag = 'section',
  id
}: {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  as?: 'section' | 'div' | 'aside';
}) {
  return (
    <Tag id={id} className="rounded-2xl surface-card bg-surface overflow-hidden scroll-mt-20">
      {(title || actions) && (
        <div className={cx('flex flex-wrap items-start justify-between gap-3 px-5 sm:px-6 pt-5', flush && 'pb-4 border-b border-outline-variant')}>
          <div className="flex flex-col gap-0.5 min-w-0">
            {title && <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>}
            {description && <p className="text-body-sm text-on-surface-variant max-w-[64ch]">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? '' : 'px-5 sm:px-6 pb-5 pt-4'}>{children}</div>
    </Tag>
  );
}

/* ----------------------------------------------------------------------------------------------
 * Buttons
 * -------------------------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-body-sm font-semibold transition-colors min-h-11 sm:min-h-9 px-4 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-fixed',
  secondary: 'border border-outline-variant bg-surface text-on-surface hover:bg-surface-container hover:border-outline',
  ghost: 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container',
  danger: 'border border-error/40 text-error hover:bg-error-container'
};

/** Class string for a button-looking element (use on <a>/<Link> too). */
export function buttonClass(variant: ButtonVariant = 'secondary', extra?: string) {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], extra);
}

export function Button({
  variant = 'secondary',
  icon,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: string }) {
  return (
    <button type="button" className={buttonClass(variant, className)} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** Decorative Material Symbols icon; hidden from screen readers. */
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cx('material-symbols-outlined text-[18px] leading-none', className)} aria-hidden="true">
      {name}
    </span>
  );
}

/* ----------------------------------------------------------------------------------------------
 * Forms
 * -------------------------------------------------------------------------------------------- */

/** Shared control styling: 3:1 border contrast, 44px tall on touch screens. */
export const controlClass =
  'w-full rounded-lg border border-outline bg-surface text-body-md text-on-surface px-3 min-h-11 sm:min-h-10 placeholder:text-on-surface-variant/70 hover:border-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors';

/**
 * Label + control + hint + error. The render prop receives the id and aria props to spread onto the
 * control, so the label and messages are always announced with it.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  className,
  children
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-body-sm font-semibold text-on-surface">
        {label}
        {optional && <span className="font-normal text-on-surface-variant"> (optional)</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-body-sm text-on-surface-variant">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Segmented single choice, exposed as a radio group. */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="self-start inline-flex flex-wrap p-0.5 rounded-lg bg-surface-container">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cx(
              'px-3 min-h-11 sm:min-h-8 rounded-md text-body-sm transition-colors',
              selected
                ? 'bg-surface text-on-surface font-semibold surface-raised dark:bg-surface-container-highest'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labelled on/off switch row. */
export function Switch({
  checked,
  onChange,
  label,
  description
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-body-md font-semibold text-on-surface cursor-pointer">
          {label}
        </label>
        {description && <p className="text-body-sm text-on-surface-variant">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative shrink-0 w-11 h-6 mt-0.5 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-outline')}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------
 * Feedback
 * -------------------------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-surface-container text-on-surface-variant',
  info: 'bg-primary-soft text-primary',
  success: 'bg-secondary-container text-on-secondary-container',
  warning: 'bg-tertiary-container text-on-tertiary-container',
  danger: 'bg-error-container text-on-error-container'
};

/** Small status label. Pair colour with words; never rely on colour alone. */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: string; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold', BADGE_TONES[tone])}>
      {icon && <Icon name={icon} className="text-[14px]" />}
      {children}
    </span>
  );
}

const NOTICE_ICONS: Record<Tone, string> = {
  neutral: 'info',
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  danger: 'error'
};

/** Inline message. Danger notices are announced immediately; others politely. */
export function Notice({ tone = 'neutral', title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex items-start gap-3 rounded-xl px-4 py-3 text-body-sm', BADGE_TONES[tone])}
    >
      <Icon name={NOTICE_ICONS[tone]} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

/** Empty or zero state: what this is, why it is empty, what to do next. */
export function EmptyState({ icon = 'inbox', title, children, action }: { icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-12">
      <Icon name={icon} className="text-[28px] text-on-surface-variant" />
      <p className="text-body-md font-semibold text-on-surface">{title}</p>
      {children && <p className="text-body-sm text-on-surface-variant max-w-[48ch]">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Loading placeholder rows; announced once to screen readers. */
export function LoadingRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 animate-pulse">
          <div className="h-3 w-1/4 rounded bg-surface-container-high" />
          <div className="h-4 w-3/4 rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}

/** Thin horizontal meter, 0–100. */
export function Meter({ value, tone = 'info', label }: { value: number; tone?: 'info' | 'success'; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">
      <div className={cx('h-full rounded-full', tone === 'success' ? 'bg-secondary' : 'bg-primary')} style={{ width: `${v}%` }} />
    </div>
  );
}
