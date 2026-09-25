import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MeDTO } from '@compras/shared';
import { ApiError, api } from '../lib/api';
import { getToken, signOut } from '../lib/auth';
import { PENDING_CAPTURE_KEY, type Capture } from '../lib/capture';
import { Login, Onboarding } from './screens/Auth';
import { Compare } from './screens/Compare';
import { Menu } from './screens/Menu';
import { NewQuote } from './screens/NewQuote';
import { Order } from './screens/Order';
import { Orders } from './screens/Orders';
import { QuoteDetail } from './screens/QuoteDetail';
import { Quotes } from './screens/Quotes';
import { Requisitions } from './screens/Requisitions';
import { Review } from './screens/Review';
import { Settings } from './screens/Settings';
import { Suppliers } from './screens/Suppliers';
import { ErrorBanner, NavContext, SessionContext, Spinner, type Nav, type Route, type Session } from './ui';

type AuthState = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'error'; message: string } | { kind: 'ready'; me: MeDTO };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [stack, setStack] = useState<Route[]>([{ name: 'menu' }]);

  const refresh = useCallback(async () => {
    if (!(await getToken())) return setAuth({ kind: 'signed-out' });
    try {
      setAuth({ kind: 'ready', me: await api.me() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return setAuth({ kind: 'signed-out' });
      setAuth({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A capture from WhatsApp (floating button or right-click) opens the review screen.
  useEffect(() => {
    if (auth.kind !== 'ready' || !auth.me.company) return;
    const consume = (capture: Capture | undefined) => {
      if (!capture) return;
      chrome.storage.session.remove(PENDING_CAPTURE_KEY);
      chrome.action.setBadgeText({ text: '' });
      setStack([{ name: 'menu' }, { name: 'review', capture: { ...capture, origin: 'whatsapp' } }]);
    };
    chrome.storage.session.get(PENDING_CAPTURE_KEY).then((r) => consume(r[PENDING_CAPTURE_KEY] as Capture | undefined));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[PENDING_CAPTURE_KEY]?.newValue) consume(changes[PENDING_CAPTURE_KEY].newValue as Capture);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [auth]);

  const nav: Nav = useMemo(
    () => ({
      route: stack[stack.length - 1] ?? { name: 'menu' },
      depth: stack.length,
      go: (r) => setStack((s) => [...s, r]),
      replace: (r) => setStack((s) => [...s.slice(0, -1), r]),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      home: () => setStack([{ name: 'menu' }]),
    }),
    [stack],
  );

  if (auth.kind === 'loading') return <div className="center"><Spinner label="Carregando…" /></div>;
  if (auth.kind === 'error') return <div className="center"><ErrorBanner message={auth.message} onRetry={refresh} /></div>;
  if (auth.kind === 'signed-out') return <Login onSignedIn={refresh} />;
  if (!auth.me.company) return <Onboarding me={auth.me} onDone={refresh} />;

  const session: Session = {
    me: auth.me,
    refresh,
    signOut: async () => {
      await signOut();
      setStack([{ name: 'menu' }]);
      setAuth({ kind: 'signed-out' });
    },
  };

  const r = nav.route;
  return (
    <SessionContext.Provider value={session}>
      <NavContext.Provider value={nav}>
        {r.name === 'menu' && <Menu />}
        {r.name === 'new' && <NewQuote />}
        {r.name === 'review' && <Review key={r.capture.id} capture={r.capture} />}
        {r.name === 'quotes' && <Quotes flash={r.flash} />}
        {r.name === 'quote' && <QuoteDetail key={r.id} id={r.id} />}
        {r.name === 'requisitions' && <Requisitions />}
        {r.name === 'compare' && <Compare key={r.id} id={r.id} />}
        {r.name === 'order' && <Order key={r.id} id={r.id} />}
        {r.name === 'orders' && <Orders />}
        {r.name === 'suppliers' && <Suppliers />}
        {r.name === 'settings' && <Settings />}
      </NavContext.Provider>
    </SessionContext.Provider>
  );
}
