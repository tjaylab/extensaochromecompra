import { useEffect, useState, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { captureOpenConversation } from '../../lib/whatsapp-tab';
import { SupplierPanel } from '../SupplierPanel';
import { ErrorBanner, Icon, Screen, useLoad, useNav, useSession } from '../ui';

type Tab = 'insights' | 'work';
const TABS: { id: Tab; label: string }[] = [
  { id: 'insights', label: 'Insights' },
  { id: 'work', label: 'Work' },
];
const TAB_KEY = 'homeTab';

/** Home: "Insights" (the supplier of the open conversation) and "Work" (actions). Remembers the last tab. */
export function Menu({ error }: { error?: string }) {
  const [tab, setTab] = useState<Tab>(error ? 'work' : 'insights');
  useEffect(() => {
    if (error) return;
    chrome.storage.local.get(TAB_KEY).then((r) => r[TAB_KEY] === 'work' && setTab('work'));
  }, [error]);
  const select = (t: Tab) => {
    setTab(t);
    chrome.storage.local.set({ [TAB_KEY]: t }).catch(() => {});
    document.getElementById(`tab-${t}`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    select(tab === 'insights' ? 'work' : 'insights');
  };

  const { me } = useSession();
  return (
    <Screen
      title={me.company!.name}
      subheader={
        <nav className="tabs" role="tablist" aria-label="Seções" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      }
    >
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="stack" style={{ gap: 16 }}>
        {tab === 'insights' ? <SupplierPanel /> : <Work error={error} />}
      </div>
    </Screen>
  );
}

function Work({ error }: { error?: string }) {
  const nav = useNav();
  const { me } = useSession();
  const counts = useLoad(async () => {
    const [quotes, reqs, orders] = await Promise.all([api.quotes(), api.requisitions('open'), api.orders()]);
    return { quotes: quotes.length, reqs: reqs.length, orders: orders.length };
  });
  const [readError, setReadError] = useState<string | null>(error ?? null);
  const [reading, setReading] = useState(false);

  const fromConversation = async () => {
    setReading(true);
    setReadError(null);
    try {
      const capture = await captureOpenConversation();
      nav.go({ name: 'review', capture: { ...capture, origin: 'whatsapp' } });
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  return (
    <>
      {me.omie.status !== 'connected' && (
        <div className="banner banner-warn">
          <Icon name="warn" />
          <div className="stack" style={{ gap: 6 }}>
            <span>
              {me.omie.status === 'not_configured'
                ? 'O Omie ainda não está conectado. Você já pode registrar e comparar cotações; o envio de pedidos precisa da conexão.'
                : 'A conexão com o Omie falhou na última verificação.'}
            </span>
            {me.role === 'admin' && (
              <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => nav.go({ name: 'settings' })}>
                Abrir configurações
              </button>
            )}
          </div>
        </div>
      )}
      {readError && <ErrorBanner message={readError} />}
      <div className="stack">
        <button type="button" className="btn btn-primary btn-lg" onClick={fromConversation} disabled={reading}>
          <Icon name="plus" size={20} /> {reading ? 'Lendo a conversa…' : 'Registrar da conversa aberta'}
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'new' })}>
          Anexar PDF ou imagem
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'quotes' })}>
          Minhas cotações <span className="count">{counts.data?.quotes ?? ''}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'requisitions' })}>
          Requisições <span className="count">{counts.data ? `${counts.data.reqs} abertas` : ''}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'orders' })}>
          Pedidos de compra <span className="count">{counts.data?.orders ?? ''}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'suppliers' })}>
          Fornecedores
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'settings' })}>
          <Icon name="settings" /> Configurações
        </button>
      </div>
    </>
  );
}
