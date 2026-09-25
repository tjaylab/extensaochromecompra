import { useEffect, useState, type FormEvent } from 'react';
import { isoToBr } from '@compras/shared';
import { AUTO_READ_KEY, HISTORY_HOURS_KEY } from '../../lib/capture';
import { historyHours } from '../../lib/whatsapp-tab';
import { api } from '../../lib/api';
import { ErrorBanner, Field, Screen, Spinner, useLoad, useSession } from '../ui';

export function Settings() {
  const { me, refresh, signOut } = useSession();
  const admin = me.role === 'admin';
  return (
    <Screen title="Configurações">
      <section className="card">
        <span className="section-label">Conta</span>
        <span>{me.user.email} · {admin ? 'Administrador' : 'Comprador'}</span>
        <span className="muted">{me.company!.name}</span>
        <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={signOut}>Sair</button>
      </section>
      <HistorySetting />
      <AutoReadSetting />
      <OmieSettings admin={admin} onChange={refresh} />
      {admin && <Team />}
      {admin && <Metrics />}
    </Screen>
  );
}

function OmieSettings({ admin, onChange }: { admin: boolean; onChange: () => Promise<void> }) {
  const { me } = useSession();
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await onChange();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.saveOmie(key, secret);
      setKey('');
      setSecret('');
      return 'Conta Omie conectada. O catálogo de produtos está sendo carregado.';
    });
  };

  return (
    <section className="card">
      <span className="section-label">ERP Omie</span>
      {me.omie.mode === 'mock' ? (
        <span className="small muted">Modo simulado (OMIE_MODE=mock no servidor): pedidos não são enviados a um Omie real.</span>
      ) : (
        <span className="small muted">
          {me.omie.status === 'connected' ? 'Conectado' : me.omie.status === 'not_configured' ? 'Não conectado' : 'Falha na última verificação'}
          {me.omie.checked_at ? ` · verificado em ${isoToBr(me.omie.checked_at)}` : ''}
        </span>
      )}
      {msg && <div className={`banner ${msg.ok ? 'banner-ok' : 'banner-error'}`}>{msg.text}</div>}
      <div className="row wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => run(async () => {
            const r = await api.checkOmie();
            return r.status === 'connected' ? 'Conexão ativa.' : `Conexão com problema: ${r.message ?? r.status}`;
          })}
        >
          Verificar conexão
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(async () => (await api.syncOmie(), 'Produtos e condições de parcela atualizados.'))}>
          Atualizar catálogo
        </button>
      </div>
      {admin && (
        <form className="stack" onSubmit={save}>
          <span className="small muted">No Omie: Configurações › Aplicativos › Integrações (API). Copie App Key e App Secret.</span>
          <Field id="omie-key" label="App Key"><input id="omie-key" className="input" required autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></Field>
          <Field id="omie-secret" label="App Secret"><input id="omie-secret" className="input" type="password" required autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>
          <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy}>
            {me.omie.status === 'connected' && me.omie.mode === 'live' ? 'Trocar credenciais' : 'Conectar Omie'}
          </button>
        </form>
      )}
    </section>
  );
}

function Team() {
  const members = useLoad(() => api.members());
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'buyer' | 'admin'>('buyer');
  const [error, setError] = useState<string | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.invite(email, role);
      setEmail('');
      members.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="card">
      <span className="section-label">Equipe</span>
      {members.data?.members.map((m) => (
        <div key={m.email} className="row-between small"><span>{m.email}</span><span className="muted">{m.role === 'admin' ? 'Administrador' : 'Comprador'}</span></div>
      ))}
      {members.data?.invitations.map((m) => (
        <div key={m.email} className="row-between small"><span>{m.email}</span><span className="muted">Convite pendente</span></div>
      ))}
      <form className="stack" onSubmit={invite}>
        {error && <ErrorBanner message={error} />}
        <Field id="inv-email" label="Convidar por e-mail" hint="A pessoa cria a conta com este e-mail e entra direto na empresa.">
          <input id="inv-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="row">
          <select aria-label="Papel" className="select" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value as 'buyer' | 'admin')}>
            <option value="buyer">Comprador</option>
            <option value="admin">Administrador</option>
          </select>
          <button type="submit" className="btn btn-secondary">Convidar</button>
        </div>
      </form>
    </section>
  );
}

const FIELD_LABEL: Record<string, string> = {
  moeda: 'Moeda',
  prazo_entrega: 'Prazo de entrega',
  condicao_pagamento: 'Pagamento',
  frete: 'Frete',
  validade: 'Validade',
  'itens.quantidade_de_itens': 'Número de itens',
  'itens.descricao': 'Descrição',
  'itens.marca': 'Marca',
  'itens.sku': 'SKU',
  'itens.quantidade': 'Quantidade',
  'itens.unidade': 'Unidade',
  'itens.valor_unitario': 'Valor unitário',
};

function Metrics() {
  const m = useLoad(() => api.metrics());
  if (m.loading) return <Spinner label="Carregando métricas…" />;
  if (!m.data) return m.error ? <ErrorBanner message={m.error} onRetry={m.reload} /> : null;
  const d = m.data;
  return (
    <section className="card">
      <span className="section-label">Piloto</span>
      <div className="grid2">
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Tempo mediano por cotação</span><strong>{d.median_registration_seconds != null ? `${d.median_registration_seconds} s` : '—'}</strong></div>
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Abaixo de 1 minuto</span><strong>{d.under_one_minute_pct != null ? `${d.under_one_minute_pct}%` : '—'}</strong></div>
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Cotações (WhatsApp / total)</span><strong>{d.quotes_whatsapp} / {d.quotes_total}</strong></div>
        <div className="stack" style={{ gap: 2 }}><span className="small muted">Pedidos enviados</span><strong>{d.orders_sent}</strong></div>
        <div className="stack span2" style={{ gap: 2 }}><span className="small muted">Cotações com algum campo corrigido</span><strong>{d.corrected_fields_pct != null ? `${d.corrected_fields_pct}%` : '—'}</strong></div>
      </div>
      {!!d.corrected_by_field.length && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">Campos mais corrigidos</span>
          {d.corrected_by_field.slice(0, 5).map((f) => (
            <div key={f.field} className="row-between small"><span>{FIELD_LABEL[f.field] ?? f.field}</span><span className="mono">{f.count}</span></div>
          ))}
        </div>
      )}
      {!!d.quotes_by_user.length && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">Cotações por comprador</span>
          {d.quotes_by_user.map((u) => (
            <div key={u.email} className="row-between small"><span>{u.email}</span><span className="mono">{u.count}</span></div>
          ))}
        </div>
      )}
    </section>
  );
}

function AutoReadSetting() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    chrome.storage.local.get(AUTO_READ_KEY).then((r) => setOn(r[AUTO_READ_KEY] !== false));
  }, []);
  const toggle = (v: boolean) => {
    setOn(v);
    chrome.storage.local.set({ [AUTO_READ_KEY]: v }).catch(() => {});
  };
  return (
    <section className="card">
      <span className="section-label">Leitura automática</span>
      <label className="row" style={{ alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
        <span className="stack" style={{ gap: 2 }}>
          <span>Ler imagens e PDFs recebidos de fornecedores</span>
          <span className="small muted">
            Quando chega uma imagem ou você baixa um PDF numa conversa com fornecedor reconhecido, a IA procura a cotação sozinha. Em outras conversas, só lê se você pedir.
          </span>
        </span>
      </label>
    </section>
  );
}

function HistorySetting() {
  const [hours, setHours] = useState(72);
  useEffect(() => {
    historyHours().then(setHours);
  }, []);
  const change = (h: number) => {
    setHours(h);
    chrome.storage.local.set({ [HISTORY_HOURS_KEY]: h }).catch(() => {});
  };
  return (
    <section className="card">
      <span className="section-label">Leitura da conversa</span>
      <Field id="history-hours" label="Período lido em “Registrar da conversa aberta”" hint="A extensão rola a conversa até cobrir o período. Períodos maiores levam alguns segundos a mais.">
        <select id="history-hours" className="select" value={hours} onChange={(e) => change(Number(e.target.value))}>
          <option value={24}>Últimas 24 horas</option>
          <option value={72}>Últimas 72 horas</option>
          <option value={168}>Últimos 7 dias</option>
        </select>
      </Field>
    </section>
  );
}
