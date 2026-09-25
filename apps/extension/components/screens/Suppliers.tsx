import { useState } from 'react';
import { formatCnpj, type SupplierDTO } from '@compras/shared';
import { api } from '../../lib/api';
import { ErrorBanner, Field, Screen, Spinner, StatusBadge, useLoad } from '../ui';

export function Suppliers() {
  const [q, setQ] = useState('');
  const list = useLoad(() => api.suppliers(q), [q]);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Screen title="Fornecedores">
      <Field id="s-q" label="Buscar">
        <input id="s-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou CNPJ" />
      </Field>
      {list.loading && !list.data && <Spinner label="Carregando…" />}
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.data && !list.data.length && <div className="empty">Nenhum fornecedor. Eles são criados ao registrar cotações.</div>}
      <div className="stack">
        {list.data?.map((s) =>
          editing === s.id ? (
            <SupplierEdit
              key={s.id}
              s={s}
              onClose={(updated) => {
                setEditing(null);
                if (updated) list.setData(list.data!.map((x) => (x.id === updated.id ? updated : x)));
              }}
            />
          ) : (
            <button key={s.id} type="button" className="card card-button" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => setEditing(s.id)}>
              <div className="stack" style={{ gap: 2 }}>
                <strong>{s.name}</strong>
                <span className="small muted">{[s.phone, s.cnpj && formatCnpj(s.cnpj)].filter(Boolean).join(' · ') || 'Sem telefone ou CNPJ'}</span>
              </div>
              <StatusBadge status={s.omie_id ? 'ok' : 'draft'} label={s.omie_id ? 'No Omie' : 'Só no app'} />
            </button>
          ),
        )}
      </div>
    </Screen>
  );
}

function SupplierEdit({ s, onClose }: { s: SupplierDTO; onClose: (updated?: SupplierDTO) => void }) {
  const [name, setName] = useState(s.name);
  const [phone, setPhone] = useState(s.phone ?? '');
  const [cnpj, setCnpj] = useState(s.cnpj ? formatCnpj(s.cnpj) : '');
  const [email, setEmail] = useState(s.email ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      onClose(await api.updateSupplier(s.id, { name, phone: phone || null, cnpj: cnpj || null, email: email || null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      {error && <ErrorBanner message={error} />}
      <Field id="e-name" label="Nome"><input id="e-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field id="e-phone" label="Telefone (WhatsApp)"><input id="e-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field id="e-cnpj" label="CNPJ" hint={s.omie_id ? 'Vinculado ao Omie: altere o CNPJ lá.' : undefined}>
        <input id="e-cnpj" className="input" value={cnpj} readOnly={!!s.omie_id} onChange={(e) => setCnpj(formatCnpj(e.target.value))} />
      </Field>
      <Field id="e-email" label="E-mail"><input id="e-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={save}>Salvar</button>
        <button type="button" className="btn btn-secondary" onClick={() => onClose()}>Cancelar</button>
      </div>
    </div>
  );
}
