import { useEffect, useState, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { useReader } from '../reader/ReaderProvider';
import { WorkPanel } from '../reader/WorkPanel';
import { SupplierPanel } from '../SupplierPanel';
import { ErrorBanner, Icon, Screen, useLoad, useNav, useSession } from '../ui';

type Tab = 'insights' | 'work' | 'manage';
const TABS: { id: Tab; label: string }[] = [
  { id: 'insights', label: 'Insights' },
  { id: 'work', label: 'Work' },
  { id: 'manage', label: 'Gestão' },
];
const TAB_KEY = 'homeTab';

/** Home: "Insights" (the supplier of the open conversation), "Work" (live reading) and "Gestão". Remembers the last tab. */
export function Menu({ error }: { error?: string }) {
  const [tab, setTab] = useState<Tab>(error ? 'work' : 'insights');
  const reader = useReader();
  useEffect(() => {
    if (error) return;
    chrome.storage.local.get(TAB_KEY).then((r) => TABS.some((t) => t.id === r[TAB_KEY]) && setTab(r[TAB_KEY] as Tab));
  }, [error]);
  const select = (t: Tab) => {
    setTab(t);
    chrome.storage.local.set({ [TAB_KEY]: t }).catch(() => {});
    document.getElementById(`tab-${t}`)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    select(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!.id);
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
              {t.id === 'work' && reader.readyCount > 0 && <span className="tab-badge">{reader.readyCount}</span>}
            </button>
          ))}
        </nav>
      }
    >
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="stack" style={{ gap: 16 }}>
        {error && <ErrorBanner message={error} />}
        {tab === 'insights' && (
          <>
            {reader.readyCount > 0 && (
              <button type="button" className="banner banner-ai" style={{ textAlign: 'left' }} onClick={() => select('work')}>
                <Icon name="check" />
                <span>
                  {reader.readyCount === 1 ? '1 cotação pronta' : `${reader.readyCount} cotações prontas`} nesta conversa · ver em Work
                </span>
              </button>
            )}
            <SupplierPanel />
          </>
        )}
        {tab === 'work' && <WorkPanel />}
        {tab === 'manage' && <Manage />}
      </div>
    </Screen>
  );
}

function Manage() {
  const nav = useNav();
  const { me } = useSession();
  const counts = useLoad(async () => {
    const [quotes, reqs, orders, billing] = await Promise.all([api.quotes(), api.requisitions('open'), api.orders(), api.billing().catch(() => null)]);
    return { quotes: quotes.length, reqs: reqs.length, orders: orders.length, billing };
  });

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
      <div className="stack">
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
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'plan' })}>
          Plano e uso{' '}
          <span className="count">
            {counts.data?.billing ? `${counts.data.billing.plan.name} · ${counts.data.billing.usage.readings}/${counts.data.billing.limits.readings} leituras` : ''}
          </span>
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={() => nav.go({ name: 'settings' })}>
          <Icon name="settings" /> Configurações
        </button>
        {me.is_superadmin && (
          <button type="button" className="btn btn-outline btn-lg" onClick={() => nav.go({ name: 'admin' })}>
            Painel ProcureMate
          </button>
        )}
      </div>
    </>
  );
}
