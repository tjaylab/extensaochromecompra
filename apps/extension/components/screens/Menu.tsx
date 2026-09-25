import { useState } from 'react';
import { api } from '../../lib/api';
import { captureOpenConversation } from '../../lib/whatsapp-tab';
import { ErrorBanner, Icon, Screen, useLoad, useNav, useSession } from '../ui';

export function Menu() {
  const nav = useNav();
  const { me } = useSession();
  const counts = useLoad(async () => {
    const [quotes, reqs, orders] = await Promise.all([api.quotes(), api.requisitions('open'), api.orders()]);
    return { quotes: quotes.length, reqs: reqs.length, orders: orders.length };
  });
  const [readError, setReadError] = useState<string | null>(null);
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

  const omieMissing = me.omie.status !== 'connected';

  return (
    <Screen title={me.company!.name}>
      {omieMissing && (
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
          Colar texto da proposta
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
      <div className="banner banner-info">
        Abra a conversa com o fornecedor no WhatsApp Web e clique em <strong>Registrar da conversa aberta</strong>: a IA lê as mensagens recentes e acha a proposta vigente. Para apontar uma mensagem específica, selecione o texto e clique em <strong>Registrar cotação</strong>.
      </div>
    </Screen>
  );
}
