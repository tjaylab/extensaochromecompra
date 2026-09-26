import { useState } from 'react';
import {
  formatCnpj,
  formatMoney,
  isoToBr,
  isValidCnpj,
  onlyDigits,
  SUBSCRIPTION_STATUS_LABEL,
  USAGE_WARNING,
  type BillingCycle,
  type BillingDTO,
  type Plan as PlanInfo,
  type PlanId,
} from '@compras/shared';
import { ApiError, api } from '../../lib/api';
import { ErrorBanner, Field, Icon, Screen, Spinner, StatusBadge, useLoad, useSession } from '../ui';

const STATUS_BADGE = { trialing: 'info', active: 'ok', past_due: 'selected', canceled: 'error' } as const;

function openPage(url: string) {
  if (chrome.tabs?.create) chrome.tabs.create({ url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
}

/** Gestão > Plano e uso: the company's plan, this month's AI readings and buyers, and changing plan (Asaas). */
export function Plan() {
  const billing = useLoad(() => api.billing());
  const b = billing.data;
  return (
    <Screen title="Plano e uso">
      {billing.error && <ErrorBanner message={billing.error} onRetry={billing.reload} />}
      {!b && !billing.error && <Spinner label="Carregando…" />}
      {b && <PlanBody b={b} onChange={billing.setData} />}
    </Screen>
  );
}

function PlanBody({ b, onChange }: { b: BillingDTO; onChange: (b: BillingDTO) => void }) {
  const { me } = useSession();
  const [cycle, setCycle] = useState<BillingCycle>(b.cycle);
  const [choosing, setChoosing] = useState<PlanId | null>(null);
  const trialEnded = b.status === 'trialing' && b.trial_ends_at != null && new Date(b.trial_ends_at) < new Date();
  const share = b.limits.readings ? b.usage.readings / b.limits.readings : 1;

  return (
    <>
      <section className="card" aria-label="Plano atual">
        <div className="row-between">
          <span className="section-label">Plano atual</span>
          <StatusBadge status={STATUS_BADGE[b.status]} label={trialEnded ? 'Teste encerrado' : SUBSCRIPTION_STATUS_LABEL[b.status]} />
        </div>
        <strong style={{ fontSize: 18 }}>{b.plan.name}</strong>
        <span className="small muted">
          {b.status === 'trialing' && b.trial_ends_at
            ? trialEnded
              ? `O teste terminou em ${isoToBr(b.trial_ends_at)}. Escolha um plano para a IA voltar a ler.`
              : `Teste grátis até ${isoToBr(b.trial_ends_at)}.`
            : `${formatMoney(b.cycle === 'yearly' ? b.plan.yearly : b.plan.monthly, 'BRL')} por ${b.cycle === 'yearly' ? 'ano' : 'mês'}`}
        </span>
        {b.invoice_url && (
          <button type="button" className="btn btn-primary" onClick={() => openPage(b.invoice_url!)}>
            {b.status === 'past_due' ? 'Pagar fatura em aberto' : 'Pagar fatura'}
          </button>
        )}
      </section>

      <section className="card" aria-label="Uso do mês">
        <span className="section-label">Uso neste período</span>
        <Meter
          label="Leituras de IA"
          used={b.usage.readings}
          limit={b.limits.readings}
          hint={`${isoToBr(b.period.start)} a ${isoToBr(b.period.end)} · cada mensagem, PDF ou imagem lida conta uma`}
        />
        <Meter label="Compradores" used={b.usage.seats} limit={b.limits.seats} hint="Usuários e convites pendentes" />
        {b.blocked_reason === 'reading_limit' && (
          <div className="banner banner-warn">
            <Icon name="warn" />
            <span>As leituras deste mês acabaram: a leitura automática está pausada. Você continua registrando cotações à mão.</span>
          </div>
        )}
        {b.blocked_reason == null && share >= USAGE_WARNING && (
          <span className="small" style={{ color: 'var(--warn-ink)' }}>Você já usou {Math.round(share * 100)}% das leituras do mês.</span>
        )}
      </section>

      <div className="row-between">
        <span className="section-label">Planos</span>
        <div className="row" role="group" aria-label="Ciclo de cobrança">
          <button type="button" className="seg" aria-pressed={cycle === 'monthly'} onClick={() => setCycle('monthly')}>Mensal</button>
          <button type="button" className="seg" aria-pressed={cycle === 'yearly'} onClick={() => setCycle('yearly')}>Anual · 2 meses grátis</button>
        </div>
      </div>
      {b.plans.map((p) => (
        <PlanCard
          key={p.id}
          p={p}
          cycle={cycle}
          current={p.id === b.plan.id && cycle === b.cycle && b.status !== 'trialing'}
          canChange={me.role === 'admin'}
          onChoose={() => setChoosing(p.id)}
        />
      ))}
      {me.role !== 'admin' && <span className="small muted">Só administradores da empresa mudam o plano.</span>}
      {choosing && (
        <CheckoutForm
          b={b}
          plan={b.plans.find((p) => p.id === choosing)!}
          cycle={cycle}
          onCancel={() => setChoosing(null)}
          onDone={(next) => {
            onChange(next);
            setChoosing(null);
          }}
        />
      )}
    </>
  );
}

function Meter({ label, used, limit, hint }: { label: string; used: number; limit: number | null; hint?: string }) {
  const share = limit ? Math.min(1, used / limit) : 0;
  const tone = limit && used >= limit ? 'var(--danger-ink)' : share >= USAGE_WARNING ? 'var(--warn-ink)' : 'var(--accent)';
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row-between small">
        <span>{label}</span>
        <span className="mono">
          {used.toLocaleString('pt-BR')} de {limit == null ? 'ilimitado' : limit.toLocaleString('pt-BR')}
        </span>
      </div>
      {limit != null && (
        <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
          <span style={{ width: `${Math.round(share * 100)}%`, background: tone }} />
        </div>
      )}
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

function PlanCard({ p, cycle, current, canChange, onChoose }: { p: PlanInfo; cycle: BillingCycle; current: boolean; canChange: boolean; onChoose: () => void }) {
  const price = cycle === 'yearly' ? p.yearly : p.monthly;
  return (
    <section className={`card plan-card ${current ? 'plan-current' : ''}`} aria-label={`Plano ${p.name}`}>
      <div className="row-between">
        <strong style={{ fontSize: 16 }}>{p.name}</strong>
        <span className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
          <strong className="mono">{formatMoney(price, 'BRL')}</strong>
          <span className="small muted">por {cycle === 'yearly' ? 'ano' : 'mês'}</span>
        </span>
      </div>
      <ul className="plan-list">
        {p.highlights.map((h) => (
          <li key={h}>
            <Icon name="check" size={14} /> {h}
          </li>
        ))}
      </ul>
      {current ? (
        <span className="small" style={{ color: 'var(--success-ink)', fontWeight: 600 }}>Seu plano atual</span>
      ) : (
        canChange && (
          <button type="button" className="btn btn-outline" onClick={onChoose}>
            Assinar {p.name}
          </button>
        )
      )}
    </section>
  );
}

function CheckoutForm({ b, plan, cycle, onCancel, onDone }: { b: BillingDTO; plan: PlanInfo; cycle: BillingCycle; onCancel: () => void; onDone: (b: BillingDTO) => void }) {
  const { me } = useSession();
  const hasCnpj = !!me.company?.cnpj && isValidCnpj(me.company.cnpj);
  const [cnpj, setCnpj] = useState(me.company?.cnpj ? formatCnpj(me.company.cnpj) : '');
  const [email, setEmail] = useState(me.user.email);
  const [method, setMethod] = useState<'UNDEFINED' | 'PIX' | 'BOLETO' | 'CREDIT_CARD'>('UNDEFINED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = onlyDigits(cnpj);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.checkout({ plan: plan.id, cycle, billing_type: method, cnpj: digits || null, email: email.trim() || null });
      if (r.invoice_url) openPage(r.invoice_url);
      onDone(r.billing);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'payments_not_configured' ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!b.payments_enabled) {
    return (
      <div className="banner banner-warn">
        <Icon name="warn" />
        <div className="stack" style={{ gap: 6 }}>
          <span>O pagamento online ainda não está ativo. Fale com a equipe ProcureMate para assinar o plano {plan.name}.</span>
          <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={onCancel}>Fechar</button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="section-label">
        Assinar {plan.name} · {formatMoney(cycle === 'yearly' ? plan.yearly : plan.monthly, 'BRL')}/{cycle === 'yearly' ? 'ano' : 'mês'}
      </span>
      {!hasCnpj && (
        <Field id="ck-cnpj" label="CNPJ da empresa" error={digits.length === 14 && !isValidCnpj(digits) ? 'CNPJ inválido' : null}>
          <input id="ck-cnpj" className="input mono" inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} required />
        </Field>
      )}
      <Field id="ck-email" label="E-mail para a cobrança e a nota fiscal">
        <input id="ck-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field id="ck-method" label="Forma de pagamento">
        <select id="ck-method" className="select" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="UNDEFINED">Escolher na fatura (Pix, boleto ou cartão)</option>
          <option value="PIX">Pix</option>
          <option value="BOLETO">Boleto</option>
          <option value="CREDIT_CARD">Cartão de crédito</option>
        </select>
      </Field>
      <span className="small muted">O novo plano vale na hora. A fatura abre numa aba nova; quando o pagamento for confirmado, a assinatura fica ativa sozinha.</span>
      {error && <ErrorBanner message={error} />}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={busy || (!hasCnpj && !isValidCnpj(digits))}>
          {busy ? 'Gerando cobrança…' : 'Ir para o pagamento'}
        </button>
      </div>
    </form>
  );
}
