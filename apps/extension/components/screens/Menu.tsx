import { api } from '../../lib/api';
import { Icon, Screen, useLoad, useNav, useSession } from '../ui';

export function Menu() {
  const nav = useNav();
  const { me } = useSession();
  const counts = useLoad(async () => {
    const [quotes, reqs, orders] = await Promise.all([api.quotes(), api.requisitions('open'), api.orders()]);
    return { quotes: quotes.length, reqs: reqs.length, orders: orders.length };
  });

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
      <div className="stack">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => nav.go({ name: 'new' })}>
          <Icon name="plus" size={20} /> Nova cotação
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
        Fluxo principal: no WhatsApp Web, selecione o texto da proposta do fornecedor e clique em <strong>Registrar cotação</strong> (ou use o botão direito).
      </div>
    </Screen>
  );
}
