import type { ButtonHTMLAttributes, ReactNode } from 'react';

type IconName =
  | 'plus' | 'play' | 'check' | 'alert' | 'list' | 'music' | 'brand'
  | 'settings' | 'export' | 'back' | 'chevron' | 'swap' | 'spark';

const paths: Record<IconName, ReactNode> = {
  plus: <path d="M10 4v12M4 10h12" />,
  play: <path d="M7 4.5v11l9-5.5-9-5.5Z" fill="currentColor" stroke="none" />,
  check: <path d="m4 10.5 4 4 8-9" />,
  alert: <><path d="M10 3.5 18 17H2L10 3.5Z" /><path d="M10 8v4M10 14.5v.5" /></>,
  list: <><path d="M3 5h14M3 10h14M3 15h14" /></>,
  music: <><path d="M7 15V5l9-2v10" /><circle cx="5" cy="15" r="2" /><circle cx="14" cy="13" r="2" /></>,
  brand: <><path d="M3 6h14M3 14h14" /><path d="M8 6v8M13 6v8" /></>,
  settings: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M15.5 4.5 14 6M6 14l-1.5 1.5" /></>,
  export: <><path d="M10 13V3M6.5 6.5 10 3l3.5 3.5" /><path d="M3 13v3h14v-3" /></>,
  back: <path d="M12 4 5 10l7 6" />,
  chevron: <path d="m7 4 6 6-6 6" />,
  swap: <><path d="M3 7h11l-3-3M17 13H6l3 3" /></>,
  spark: <><path d="M10 2.5 12 8l5.5 2L12 12l-2 5.5L8 12l-5.5-2L8 8l2-5.5Z" /></>,
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
}) {
  return (
    <button className={`btn btn--${variant} btn--${size}`} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'work' | 'warn' | 'fail' | 'idle'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Chip({ on, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className={`chip ${on ? 'chip--on' : ''}`} aria-pressed={!!on} onClick={onClick}>
      {children}
    </button>
  );
}

export function Progress({ value, tone = 'brass' }: { value: number; tone?: 'brass' | 'sage' | 'clay' }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <span className={`progress__fill progress__fill--${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__mark">
        <Icon name="plus" size={20} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="caps">{children}</div>;
}
