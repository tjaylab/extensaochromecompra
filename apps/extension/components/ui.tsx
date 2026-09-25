import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeDTO } from '@compras/shared';
import type { Capture } from '../lib/capture';

// ---------------------------------------------------------------------------
// Navigation: a small stack router. The panel is narrow; screens replace each other.
// ---------------------------------------------------------------------------

export type Route =
  | { name: 'menu'; error?: string }
  | { name: 'new' }
  | { name: 'review'; capture: Capture & { origin: 'whatsapp' | 'manual' } }
  | { name: 'quotes'; flash?: string }
  | { name: 'quote'; id: string }
  | { name: 'requisitions' }
  | { name: 'compare'; id: string }
  | { name: 'order'; id: string }
  | { name: 'orders' }
  | { name: 'suppliers' }
  | { name: 'settings' };

export interface Nav {
  route: Route;
  depth: number;
  go(r: Route): void;
  replace(r: Route): void;
  back(): void;
  home(): void;
}

export interface Session {
  me: MeDTO;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

export const NavContext = createContext<Nav | null>(null);
export const SessionContext = createContext<Session | null>(null);
export const useNav = () => useContext(NavContext)!;
export const useSession = () => useContext(SessionContext)!;

// ---------------------------------------------------------------------------
// Data loading hook
// ---------------------------------------------------------------------------

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, setData, error, loading, reload: () => setTick((t) => t + 1) };
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

const paths: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12l5 5 9-10" />,
  warn: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  send: <path d="M4 12l16-8-6 16-2-7z" />,
};

export function Icon({ name, size = 18, className }: { name: keyof typeof paths; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {paths[name]}
    </svg>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" role="status">
      <Icon name="spinner" className="spin" size={20} />
      {label && <span>{label}</span>}
    </div>
  );
}

export function OmieChip() {
  const { me } = useSession();
  const s = me.omie.status;
  const cls = s === 'connected' ? 'status-ok' : s === 'not_configured' ? 'status-idle' : 'status-bad';
  const label =
    s === 'connected' ? (me.omie.mode === 'mock' ? 'Omie simulado' : 'Conectado ao Omie') : s === 'not_configured' ? 'Omie não conectado' : 'Omie com erro';
  return (
    <span className={`status-chip ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function Header({ title }: { title: string }) {
  const nav = useNav();
  return (
    <header className="header">
      {nav.depth > 1 && (
        <button type="button" className="icon-btn" onClick={nav.back} aria-label="Voltar">
          <Icon name="back" />
        </button>
      )}
      <div className="header-title">
        <span className="header-kicker">ProcureMate</span>
        <span className="header-name">{title}</span>
      </div>
      <OmieChip />
    </header>
  );
}

export function Screen({ title, children, footer, subheader }: { title: string; children: ReactNode; footer?: ReactNode; subheader?: ReactNode }) {
  return (
    <div className="app">
      <Header title={title} />
      {subheader}
      <main className="body">{children}</main>
      {footer && <footer className="footer">{footer}</footer>}
    </div>
  );
}

export function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner banner-error" role="alert">
      <Icon name="warn" />
      <div className="stack" style={{ gap: 6 }}>
        <span>{message}</span>
        {onRetry && (
          <button type="button" className="btn-link" onClick={onRetry} style={{ alignSelf: 'flex-start' }}>
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge badge-${status}`}>{label}</span>;
}
