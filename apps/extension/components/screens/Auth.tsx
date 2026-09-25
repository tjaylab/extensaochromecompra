import { useState, type FormEvent } from 'react';
import type { MeDTO } from '@compras/shared';
import { api } from '../../lib/api';
import { signIn, signOut, signUp } from '../../lib/auth';
import { env } from '../../lib/env';
import { ErrorBanner, Field } from '../ui';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dev = env.authMode === 'dev';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'up') {
        const r = await signUp(email, password);
        if (r.needsConfirmation) {
          setNotice('Enviamos um link de confirmação para o seu e-mail. Confirme e depois entre.');
          setMode('in');
          return;
        }
      } else {
        await signIn(email, password);
      }
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <main className="body" style={{ justifyContent: 'center' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="header-kicker">Compras WhatsApp</span>
          <h1 style={{ margin: 0, fontSize: 22 }}>{mode === 'in' ? 'Entrar' : 'Criar conta'}</h1>
          <span className="muted">Registre cotações recebidas no WhatsApp em poucos segundos.</span>
        </div>
        {notice && <div className="banner banner-ok">{notice}</div>}
        {error && <ErrorBanner message={error} />}
        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          <Field id="email" label="E-mail">
            <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {!dev && (
            <Field id="password" label="Senha" hint={mode === 'up' ? 'Mínimo de 8 caracteres' : undefined}>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'up' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Aguarde…' : mode === 'in' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
        {dev ? (
          <span className="small muted">Modo de desenvolvimento: entra só com o e-mail.</span>
        ) : (
          <button type="button" className="btn-link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')} style={{ alignSelf: 'flex-start' }}>
            {mode === 'in' ? 'Ainda não tenho conta' : 'Já tenho conta'}
          </button>
        )}
      </main>
    </div>
  );
}

export function Onboarding({ me, onDone }: { me: MeDTO; onDone: () => void }) {
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCompany({ name, cnpj: cnpj || null });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <main className="body" style={{ justifyContent: 'center' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="header-kicker">Compras WhatsApp</span>
          <h1 style={{ margin: 0, fontSize: 22 }}>Sua empresa</h1>
          <span className="muted">
            Você entrou como {me.user.email}. Se alguém da sua empresa já usa o Compras WhatsApp, peça um convite para este e-mail em vez de criar outra empresa.
          </span>
        </div>
        {error && <ErrorBanner message={error} />}
        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          <Field id="company" label="Nome da empresa">
            <input id="company" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="cnpj" label="CNPJ (opcional)">
            <input id="cnpj" className="input" inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Criando…' : 'Criar empresa'}
          </button>
        </form>
        <button type="button" className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => signOut().then(onDone)}>
          Sair e entrar com outro e-mail
        </button>
      </main>
    </div>
  );
}
