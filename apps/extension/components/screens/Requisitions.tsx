import { useState, type FormEvent } from 'react';
import { formatDecimal, parseDecimal } from '@compras/shared';
import { api } from '../../lib/api';
import { ErrorBanner, Field, Icon, Screen, Spinner, StatusBadge, useLoad, useNav } from '../ui';

const LABEL = { open: 'Aberto', ordered: 'Pedido gerado', cancelled: 'Cancelado' } as const;
const BADGE = { open: 'comparing', ordered: 'ordered', cancelled: 'discarded' } as const;

export function Requisitions() {
  const nav = useNav();
  const list = useLoad(() => api.requisitions());
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('un');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const q = parseDecimal(qty);
    try {
      await api.createRequisition({ title, items: item.trim() && q ? [{ description: item.trim(), quantity: q, unit }] : [] });
      setCreating(false);
      setTitle('');
      setItem('');
      setQty('');
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen title="Comparativos">
      {creating ? (
        <form className="card" onSubmit={submit}>
          <span className="section-label">Novo comparativo</span>
          {error && <ErrorBanner message={error} />}
          <Field id="r-title" label="Título">
            <input id="r-title" className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex.: Fontes 24V industriais" />
          </Field>
          <Field id="r-item" label="Item (opcional)">
            <input id="r-item" className="input" value={item} onChange={(e) => setItem(e.target.value)} />
          </Field>
          <div className="grid2">
            <Field id="r-qty" label="Quantidade">
              <input id="r-qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field id="r-unit" label="Unidade">
              <input id="r-unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary">Criar</button>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> Novo comparativo
        </button>
      )}
      {list.loading && <Spinner label="Carregando…" />}
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.data && !list.data.length && <div className="empty">Nenhum comparativo ainda. Crie um para comparar propostas.</div>}
      <div className="stack">
        {list.data?.map((r) => (
          <button key={r.id} type="button" className="card card-button" onClick={() => nav.go({ name: 'compare', id: r.id })}>
            <div className="row-between">
              <span className="mono small muted">{r.number}</span>
              <StatusBadge status={BADGE[r.status]} label={LABEL[r.status]} />
            </div>
            <strong>{r.title}</strong>
            <div className="row-between small muted">
              <span>{r.items.map((i) => `${formatDecimal(i.quantity)} ${i.unit ?? ''} ${i.description}`).join(', ') || 'Sem itens definidos'}</span>
              <span>{r.quote_count} {r.quote_count === 1 ? 'cotação' : 'cotações'}</span>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}
