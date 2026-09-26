import { useEffect, useState } from 'react';
import { formatCnpj, type SupplierContextDTO, type SupplierSearchDTO } from '@compras/shared';
import { api } from '../lib/api';
import { ErrorBanner, Field, Spinner } from './ui';

type Contact = { contactName: string | null; contactPhone: string | null };
/** "+55 11 98765-4321" style, keeping whatever doesn't look like a Brazilian number. */
function formatPhone(p: string): string {
  let d = p.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`;
  return p;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Search the app's and Omie's suppliers to link this conversation when the AI didn't recognize it (or got it wrong). */
export function SupplierSearch({ contact, onLinked, onCancel }: { contact: Contact; onLinked: (c: SupplierContextDTO) => void; onCancel?: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SupplierSearchDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true);
      api
        .searchSuppliers(q.trim())
        .then((r) => alive && setRes(r))
        .catch((e) => alive && setError(message(e)))
        .finally(() => alive && setBusy(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const link = async (body: { omie_id?: number; supplier_id?: string }) => {
    setError(null);
    try {
      onLinked(await api.linkSupplier({ ...body, contact_name: contact.contactName, contact_phone: contact.contactPhone }));
    } catch (e) {
      setError(message(e));
    }
  };

  // A local supplier already linked to Omie shows once, as the Omie entry.
  const linkedOmie = new Set(res?.local.map((s) => s.omie_id).filter(Boolean));
  const empty = res && !res.local.length && !res.omie.length;

  return (
    <div className="stack">
      <Field id="sup-q" label="Procurar fornecedor">
        <input id="sup-q" className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, CNPJ ou telefone" />
      </Field>
      {error && <ErrorBanner message={error} />}
      {busy && <Spinner label="Procurando…" />}
      {empty && <span className="small muted">Nenhum fornecedor encontrado.</span>}
      {res?.local.map((s) => (
        <button key={s.id} type="button" className="btn btn-outline" style={{ justifyContent: 'flex-start' }} onClick={() => link(s.omie_id ? { omie_id: s.omie_id } : { supplier_id: s.id })}>
          {s.name}
          <span className="small muted" style={{ marginLeft: 'auto' }}>{s.omie_id ? 'No Omie' : 'Só no app'}</span>
        </button>
      ))}
      {res?.omie
        .filter((o) => !linkedOmie.has(o.omie_id))
        .map((o) => (
          <button key={o.omie_id} type="button" className="btn btn-outline" style={{ justifyContent: 'flex-start' }} onClick={() => link({ omie_id: o.omie_id })}>
            {o.trade_name || o.name}
            <span className="small muted" style={{ marginLeft: 'auto' }}>{o.cnpj ? formatCnpj(o.cnpj) : 'Omie'}</span>
          </button>
        ))}
      {onCancel && (
        <button type="button" className="btn-link small" style={{ alignSelf: 'flex-start' }} onClick={onCancel}>
          Cancelar
        </button>
      )}
    </div>
  );
}

/** Registers the supplier in Omie (tag Fornecedor) with the WhatsApp number as its phone. */
export function RegisterInOmie({ contact, ctx, onDone, onCancel }: { contact: Contact; ctx: SupplierContextDTO; onDone: (c: SupplierContextDTO) => void; onCancel: () => void }) {
  const s = ctx.supplier;
  const [name, setName] = useState(s?.name ?? contact.contactName ?? '');
  const [cnpj, setCnpj] = useState(s?.cnpj ? formatCnpj(s.cnpj) : '');
  const [email, setEmail] = useState(s?.email ?? '');
  const [phone, setPhone] = useState(contact.contactPhone ?? s?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api.registerOmieSupplier({
          supplier_id: s?.id ?? null,
          name: name.trim(),
          cnpj,
          email: email.trim() || null,
          phone: phone.trim() || null,
          contact_name: contact.contactName,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="section-label">Cadastrar no Omie</span>
      <Field id="om-name" label="Razão social">
        <input id="om-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field id="om-cnpj" label="CNPJ" hint="Se o CNPJ já estiver no Omie, só vinculo o cadastro existente.">
        <input id="om-cnpj" className="input mono" inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} required />
      </Field>
      <Field id="om-email" label="E-mail (opcional)">
        <input id="om-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id="om-phone" label="Telefone">
        <input id="om-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {error && <ErrorBanner message={error} />}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2 || cnpj.replace(/\D/g, '').length < 11}>
          {busy ? 'Cadastrando…' : 'Cadastrar fornecedor'}
        </button>
      </div>
    </form>
  );
}

/** The WhatsApp number differs from the phones registered in Omie: offer to make it the main phone. */
export function PhoneMismatch({ ctx, contact, onDone }: { ctx: SupplierContextDTO; contact: Contact; onDone: (c: SupplierContextDTO) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const mm = ctx.phone_mismatch;
  const omieId = ctx.omie_supplier?.omie_id ?? ctx.supplier?.omie_id;
  if (!mm || !omieId || hidden) return null;

  const update = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.updateOmiePhone({ omie_id: omieId, phone: mm.whatsapp, contact_name: contact.contactName }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="banner banner-warn">
      <div className="stack" style={{ gap: 6 }}>
        <span>
          O WhatsApp é {formatPhone(mm.whatsapp)}, mas no Omie {mm.omie.length ? `está ${mm.omie.map(formatPhone).join(', ')}` : 'não há telefone'}.
        </span>
        {error && <span className="small">{error}</span>}
        <div className="row">
          <button type="button" className="btn btn-outline" onClick={update} disabled={busy}>
            {busy ? 'Atualizando…' : 'Atualizar telefone no Omie'}
          </button>
          <button type="button" className="btn-link small" onClick={() => setHidden(true)} disabled={busy}>Agora não</button>
        </div>
      </div>
    </div>
  );
}
