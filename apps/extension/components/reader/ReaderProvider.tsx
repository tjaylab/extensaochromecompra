import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { looksLikeProposal, type Attachment, type ConversationMessage, type ExtractionResponse } from '@compras/shared';
import { ApiError, api } from '../../lib/api';
import { refreshBilling } from '../../lib/billing-store';
import { quoteFromExtraction } from '../../lib/auto-quote';
import {
  AUTO_READ_KEY,
  newCaptureId,
  requestAttention,
  SUGGESTION_KEY,
  type ContactResponse,
  type RowMediaResponse,
  type RowsLoadedMessage,
  type RowsRequest,
  type Suggestion,
} from '../../lib/capture';
import { sendToWhatsApp } from '../../lib/whatsapp-tab';
import type { ProposalView } from '../ProposalCard';
import { useActiveContact } from '../SupplierPanel';
import { useNav } from '../ui';

// Reads the open conversation as it appears on screen: messages loaded when the chat opens, older ones as the
// buyer scrolls up, new arrivals, images and PDFs. Finds every quote in them (scan mode) and keeps the results
// ready to save. Mounted once for the whole app, so it keeps working while the buyer is on other screens.

export interface Activity {
  id: string;
  kind: 'fetch' | 'analyze' | 'found' | 'none' | 'media' | 'error' | 'unknown';
  text: string;
  snippets?: { direction: 'in' | 'out'; text: string }[];
  done: boolean;
  at: number;
  action?: { label: string; run: () => void };
}

export interface ChatState {
  key: string;
  contact: ContactResponse;
  /** Recognized supplier (automatic reading allowed); null = not checked yet. */
  known: boolean | null;
  /** The buyer asked to read a conversation that is not a recognized supplier. */
  manual: boolean;
  messages: ConversationMessage[];
  scanned: string[];
  proposals: ProposalView[];
  activities: Activity[];
  busy: boolean;
}

interface Reader {
  current: ChatState | null;
  readyCount: number;
  save: (key: string) => void;
  ignore: (key: string) => void;
  review: (key: string) => void;
  openQuote: (key: string) => void;
  analyzeAnyway: () => void;
  addFiles: (files: Attachment[]) => void;
  /** Reads again everything loaded in the open conversation. */
  reload: () => void;
  /** Automatic reading is paused: the plan's readings ran out or the subscription is inactive. */
  paused: string | null;
}

const ReaderContext = createContext<Reader | null>(null);
export const useReader = () => useContext(ReaderContext)!;

const SCAN_DEBOUNCE_MS = 1200;
const CONTEXT_BEFORE = 8;
const MAX_ACTIVITIES = 10;
/** Opening a chat with history on screen reads only its latest images and PDFs automatically. */
const INITIAL_MEDIA = 2;
const FILES_CHAT = 'arquivos';
const storageKey = (chat: string) => `reader:${chat}`;
const chatKeyOf = (c: ContactResponse) => c.contactName ?? c.contactPhone ?? '';
const whoOf = (c: ContactResponse) => c.contactName ?? c.contactPhone ?? 'o contato';

async function autoReadEnabled() {
  const r = await chrome.storage.local.get(AUTO_READ_KEY);
  return r[AUTO_READ_KEY] !== false;
}

export function ReaderProvider({ children }: { children: ReactNode }) {
  const nav = useNav();
  const active = useActiveContact();
  const [chats, setChats] = useState<Record<string, ChatState>>({});
  // The source of truth, updated synchronously: the async readers below read it right after writing.
  // (A setState updater runs later, during render, so it can't be relied on for that.)
  const ref = useRef(chats);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const loaded = useRef<Set<string>>(new Set());
  const rescan = useRef<Set<string>>(new Set());
  // One image or PDF at a time: WhatsApp hands over one document per click.
  const mediaQueue = useRef<Promise<unknown>>(Promise.resolve());
  // The plan stopped AI readings (402 from the API): nothing is read automatically until the buyer reloads.
  const [paused, setPausedState] = useState<string | null>(null);
  const pausedRef = useRef<string | null>(null);
  const setPaused = (p: string | null) => {
    pausedRef.current = p;
    setPausedState(p);
  };
  /** True when the error is the plan stopping readings (and pauses automatic reading). */
  const planStop = (e: unknown) => {
    if (e instanceof ApiError && e.status === 402) {
      setPaused(e.message);
      return true;
    }
    return false;
  };
  useEffect(() => {
    api
      .billing()
      .then((b) => !b.can_read && setPaused(b.blocked_reason === 'reading_limit' ? 'As leituras de IA do plano acabaram neste mês.' : 'A assinatura está inativa.'))
      .catch(() => {});
  }, []);

  const update = (key: string, contact: ContactResponse, fn: (s: ChatState) => ChatState) => {
    const prev = ref.current;
    const s = prev[key] ?? { key, contact, known: null, manual: false, messages: [], scanned: [], proposals: [], activities: [], busy: false };
    const next = { ...prev, [key]: fn({ ...s, contact: contact.contactPhone || !s.contact.contactPhone ? contact : s.contact }) };
    ref.current = next;
    setChats(next);
  };

  const addActivity = (key: string, contact: ContactResponse, a: Omit<Activity, 'id' | 'at'> & { id?: string }) => {
    const id = a.id ?? newCaptureId();
    update(key, contact, (s) => {
      const exists = s.activities.some((x) => x.id === id);
      const activities = exists ? s.activities.map((x) => (x.id === id ? { ...x, ...a, id } : x)) : [{ ...a, id, at: Date.now() }, ...s.activities].slice(0, MAX_ACTIVITIES);
      return { ...s, activities };
    });
    return id;
  };

  /** Scanned message ids and unsaved proposals survive closing the panel, so nothing is read twice. */
  const persist = (key: string) => {
    const s = ref.current[key];
    if (!s) return;
    chrome.storage.local
      .set({ [storageKey(key)]: { scanned: s.scanned.slice(-3000), proposals: s.proposals.filter((p) => p.status === 'ready').slice(0, 20) } })
      .catch(() => {});
  };
  const restore = async (key: string, contact: ContactResponse) => {
    if (loaded.current.has(key)) return;
    loaded.current.add(key);
    const r = (await chrome.storage.local.get(storageKey(key)))[storageKey(key)] as { scanned?: string[]; proposals?: ProposalView[] } | undefined;
    if (r) update(key, contact, (s) => ({ ...s, scanned: [...new Set([...(r.scanned ?? []), ...s.scanned])], proposals: [...(r.proposals ?? []), ...s.proposals] }));
  };

  const ensureKnown = async (key: string, contact: ContactResponse) => {
    const s = ref.current[key];
    if (s?.known != null) return s.known;
    const [auto, ctx] = await Promise.all([autoReadEnabled(), api.supplierContext(contact.contactName, contact.contactPhone).catch(() => null)]);
    const known = auto && !!(ctx?.supplier || ctx?.omie_supplier);
    update(key, contact, (x) => ({ ...x, known }));
    return known;
  };

  const addProposals = (key: string, contact: ContactResponse, found: { ex: ExtractionResponse; ids: string[]; source: ProposalView['source']; fileName?: string | null }[]) => {
    if (!found.length) return;
    update(key, contact, (s) => {
      let proposals = [...s.proposals];
      for (const f of found) {
        const view: ProposalView = {
          key: f.ids.length ? f.ids.slice().sort().join('|') : f.ex.extraction_id,
          source: f.source,
          fileName: f.fileName ?? null,
          ex: f.ex,
          contact,
          detectedAt: Date.now(),
          status: 'ready',
        };
        // The same messages read again (a correction arrived): replace the earlier reading.
        const overlap = proposals.findIndex((p) => p.status === 'ready' && f.ids.some((id) => p.key.split('|').includes(id)));
        if (overlap >= 0) proposals[overlap] = view;
        else proposals = [view, ...proposals];
      }
      return { ...s, proposals };
    });
    requestAttention(`${found.length === 1 ? 'Cotação' : `${found.length} cotações`} de ${whoOf(contact)} pronta${found.length === 1 ? '' : 's'} para salvar`);
    persist(key);
  };

  // --- Reading the conversation ---------------------------------------------------------------

  const runScan = async (key: string) => {
    const s = ref.current[key];
    if (!s) return;
    if (s.busy) {
      rescan.current.add(key);
      return;
    }
    const known = await ensureKnown(key, s.contact);
    const st = ref.current[key]!;
    const pending = st.messages.filter((m) => m.id && !st.scanned.includes(m.id));
    if (!pending.length) return;
    const priced = pending.some((m) => m.direction === 'in' && looksLikeProposal(m.text));
    if (!priced) {
      update(key, st.contact, (x) => ({ ...x, scanned: [...x.scanned, ...pending.map((m) => m.id!)] }));
      addActivity(key, st.contact, { id: `idle:${key}`, kind: 'none', text: 'Nenhuma mensagem com preço até agora. Continuo acompanhando.', done: true });
      persist(key);
      return;
    }
    if (!known && !st.manual) {
      addActivity(key, st.contact, {
        id: `unknown:${key}`,
        kind: 'unknown',
        text: `${whoOf(st.contact)} não é um fornecedor reconhecido. As mensagens com preço não foram lidas.`,
        done: true,
        action: { label: 'Analisar mesmo assim', run: () => analyzeChat(key) },
      });
      return;
    }
    if (pausedRef.current) return; // the messages stay pending: read once the plan allows
    const first = st.messages.indexOf(pending[0]!);
    const last = st.messages.indexOf(pending[pending.length - 1]!);
    const chunk = st.messages.slice(Math.max(0, first - CONTEXT_BEFORE), last + 1).slice(-300);
    update(key, st.contact, (x) => ({ ...x, busy: true }));
    const aid = addActivity(key, st.contact, { kind: 'analyze', text: 'Analisando cotação…', done: false });
    try {
      const r = await api.scan({ conversation: chunk, contact_name: st.contact.contactName, contact_phone: st.contact.contactPhone }).finally(refreshBilling);
      addProposals(key, st.contact, r.proposals.map((p) => ({ ex: p, ids: p.message_ids, source: 'conversation' as const })));
      addActivity(key, st.contact, {
        id: aid,
        kind: r.proposals.length ? 'found' : 'none',
        text: r.proposals.length ? `${r.proposals.length === 1 ? '1 cotação encontrada' : `${r.proposals.length} cotações encontradas`}` : 'Nenhuma cotação nestas mensagens',
        done: true,
      });
      update(key, st.contact, (x) => ({ ...x, scanned: [...new Set([...x.scanned, ...chunk.map((m) => m.id!).filter(Boolean)])] }));
    } catch (e) {
      if (planStop(e)) update(key, st.contact, (x) => ({ ...x, activities: x.activities.filter((a) => a.id !== aid) }));
      else addActivity(key, st.contact, { id: aid, kind: 'error', text: e instanceof Error ? e.message : String(e), done: true });
    } finally {
      update(key, st.contact, (x) => ({ ...x, busy: false }));
      persist(key);
      if (rescan.current.delete(key)) schedule(key);
    }
  };

  const schedule = (key: string) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => runScan(key), SCAN_DEBOUNCE_MS);
  };

  const analyzeChat = (key: string) => {
    const s = ref.current[key];
    if (!s) return;
    update(key, s.contact, (x) => ({ ...x, manual: true, activities: x.activities.filter((a) => a.kind !== 'unknown') }));
    schedule(key);
  };

  /** A received image or PDF: read it (automatically for recognized suppliers, on click otherwise). */
  const readMedia = (key: string, contact: ContactResponse, m: RowsLoadedMessage['media'][number], force = false) => {
    const run = mediaQueue.current.then(() => readMediaNow(key, contact, m, force)).catch(() => {});
    mediaQueue.current = run;
    return run;
  };
  const readMediaNow = async (key: string, contact: ContactResponse, m: RowsLoadedMessage['media'][number], force: boolean) => {
    const s = ref.current[key];
    if (s?.scanned.includes(m.id)) return;
    const label = m.kind === 'pdf' ? `o PDF "${m.name}"` : 'a imagem';
    if (pausedRef.current && !force) return;
    const known = await ensureKnown(key, contact);
    if (!known && !force && !ref.current[key]?.manual) {
      addActivity(key, contact, {
        id: `media:${m.id}`,
        kind: 'media',
        text: `${whoOf(contact)} enviou ${label}.`,
        done: true,
        action: { label: 'Ler cotação', run: () => readMedia(key, contact, m, true) },
      });
      return;
    }
    const aid = addActivity(key, contact, { id: `media:${m.id}`, kind: 'analyze', text: `Lendo ${label}…`, done: false });
    update(key, contact, (x) => ({ ...x, scanned: [...x.scanned, m.id] }));
    try {
      const r = await sendToWhatsApp<RowMediaResponse>({ type: m.kind === 'pdf' ? 'read-row-pdf' : 'get-row-image', id: m.id });
      if (!r?.attachment) throw new Error(r?.error ?? `Não consegui abrir ${label}.`);
      const context = (ref.current[key]?.messages ?? []).slice(-CONTEXT_BEFORE);
      const ex = await api.extract({ text: '', conversation: context, attachments: [r.attachment], contact_name: contact.contactName, contact_phone: contact.contactPhone }).finally(refreshBilling);
      if (ex.data.itens.length) {
        addProposals(key, contact, [{ ex, ids: [m.id], source: m.kind === 'pdf' ? 'pdf' : 'image', fileName: m.name }]);
        addActivity(key, contact, { id: aid, kind: 'found', text: `Cotação encontrada em ${label}`, done: true });
      } else addActivity(key, contact, { id: aid, kind: 'none', text: `${label.charAt(0).toUpperCase()}${label.slice(1)} não tem cotação`, done: true });
    } catch (e) {
      if (planStop(e)) {
        update(key, contact, (x) => ({ ...x, scanned: x.scanned.filter((id) => id !== m.id), activities: x.activities.filter((a) => a.id !== aid) }));
        return;
      }
      addActivity(key, contact, {
        id: aid,
        kind: 'error',
        text: e instanceof Error ? e.message : String(e),
        done: true,
        action: {
          label: 'Tentar de novo',
          run: () => {
            update(key, contact, (x) => ({ ...x, scanned: x.scanned.filter((id) => id !== m.id) }));
            readMedia(key, contact, m, true);
          },
        },
      });
    } finally {
      persist(key);
    }
  };

  const onRows = async (msg: RowsLoadedMessage) => {
    const key = chatKeyOf(msg.contact);
    if (!key) return;
    await restore(key, msg.contact);
    const incoming = msg.messages.filter((m) => m.text.trim());
    if (incoming.length) {
      update(key, msg.contact, (s) => {
        const have = new Set(s.messages.map((m) => m.id));
        const fresh = incoming.filter((m) => !have.has(m.id));
        if (msg.position === 'initial') {
          // A snapshot of what is on screen: its order wins; messages read before and no longer loaded stay first.
          const now = new Set(incoming.map((m) => m.id));
          return { ...s, messages: [...s.messages.filter((m) => !now.has(m.id)), ...incoming] };
        }
        return { ...s, messages: msg.position === 'older' ? [...fresh, ...s.messages] : [...s.messages, ...fresh] };
      });
      const scanned = ref.current[key]?.scanned ?? [];
      const unseen = incoming.filter((m) => !scanned.includes(m.id!));
      if (unseen.length) {
        addActivity(key, msg.contact, {
          ...(msg.position === 'initial' ? { id: `fetch:${key}` } : {}),
          kind: 'fetch',
          text: `${msg.position === 'older' ? 'Lendo mensagens anteriores' : msg.position === 'initial' ? 'Obtendo mensagens' : 'Nova mensagem'} de ${whoOf(msg.contact)} · ${unseen.length}`,
          snippets: unseen.slice(-3).map((m) => ({ direction: m.direction, text: m.text.slice(0, 90) })),
          done: true,
        });
        schedule(key);
      }
    }
    const received = msg.media.filter((m) => m.direction === 'in');
    for (const m of msg.position === 'initial' ? received.slice(-INITIAL_MEDIA) : received) readMedia(key, msg.contact, m);
  };

  useEffect(() => {
    const listener = (msg: RowsLoadedMessage) => {
      if (msg?.type === 'rows-loaded') onRows(msg).catch((e) => console.error('[ProcureMate] leitura', e));
    };
    chrome.runtime.onMessage.addListener(listener);
    // PDFs the buyer downloaded in WhatsApp (read without attaching).
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const s = changes[SUGGESTION_KEY]?.newValue as Suggestion | undefined;
      if (area !== 'session' || !s || s.kind !== 'pdf' || !s.attachment) return;
      chrome.storage.session.remove(SUGGESTION_KEY).catch(() => {});
      readFile(chatKeyOf(s.contact) || FILES_CHAT, s.contact, s.attachment, 'pdf');
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(onStorage);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Asks the WhatsApp tab for every message loaded in the open conversation. */
  const sync = async (contact: ContactResponse) => {
    const key = chatKeyOf(contact);
    if (!key) return;
    const fail = (text: string) =>
      addActivity(key, contact, { id: `sync:${key}`, kind: 'error', text, done: true, action: { label: 'Ler de novo', run: () => sync(contact) } });
    let r: RowsLoadedMessage | undefined;
    try {
      r = await sendToWhatsApp<RowsLoadedMessage>({ type: 'get-rows' } satisfies RowsRequest);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      return fail(/Receiving end|establish connection/i.test(text) ? 'Recarregue a aba do WhatsApp Web (F5) para eu voltar a ler as mensagens.' : text);
    }
    if (!r) return fail('Não consegui falar com o WhatsApp Web. Recarregue a aba (F5).');
    if (chatKeyOf(r.contact) !== key) return; // the buyer switched chats meanwhile
    update(key, contact, (s) => ({ ...s, activities: s.activities.filter((a) => a.id !== `sync:${key}`) }));
    if (!r.messages.length && !r.media.length) return fail('Não encontrei mensagens nesta conversa. Role um pouco a conversa ou clique para tentar de novo.');
    await onRows(r);
  };

  const activeKey = active ? chatKeyOf(active) : '';
  useEffect(() => {
    if (active && activeKey) sync(active).catch((e) => console.error('[ProcureMate] leitura', e));
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const readFile = async (key: string, contact: ContactResponse, att: Attachment, source: ProposalView['source']) => {
    const label = att.media_type === 'application/pdf' ? `o PDF "${att.name ?? 'documento'}"` : `a imagem "${att.name ?? ''}"`;
    const aid = addActivity(key, contact, { kind: 'analyze', text: `Lendo ${label}…`, done: false });
    try {
      const context = (ref.current[key]?.messages ?? []).slice(-CONTEXT_BEFORE);
      const ex = await api.extract({ text: '', conversation: context, attachments: [att], contact_name: contact.contactName, contact_phone: contact.contactPhone }).finally(refreshBilling);
      if (ex.data.itens.length) {
        addProposals(key, contact, [{ ex, ids: [], source, fileName: att.name }]);
        addActivity(key, contact, { id: aid, kind: 'found', text: `Cotação encontrada em ${label}`, done: true });
      } else addActivity(key, contact, { id: aid, kind: 'none', text: `Não encontrei cotação em ${label}`, done: true });
    } catch (e) {
      if (planStop(e)) update(key, contact, (x) => ({ ...x, activities: x.activities.filter((a) => a.id !== aid) }));
      else addActivity(key, contact, { id: aid, kind: 'error', text: e instanceof Error ? e.message : String(e), done: true });
    }
  };

  // --- Actions on proposals ---------------------------------------------------------------------

  // Files dropped with no conversation open are read under a chat of their own.
  const currentKey = active ? chatKeyOf({ contactName: active.contactName, contactPhone: active.contactPhone }) : FILES_CHAT;
  const current: ChatState | null =
    chats[currentKey] ??
    (active ? { key: currentKey, contact: active, known: null, manual: false, messages: [], scanned: [], proposals: [], activities: [], busy: false } : null);
  const find = (pkey: string) => (current ? current.proposals.find((p) => p.key === pkey) : undefined);
  const setProposal = (pkey: string, patch: Partial<ProposalView> | null) => {
    if (!current) return;
    update(current.key, current.contact, (s) => ({
      ...s,
      proposals: patch === null ? s.proposals.filter((p) => p.key !== pkey) : s.proposals.map((p) => (p.key === pkey ? { ...p, ...patch } : p)),
    }));
    persist(current.key);
  };

  const reader: Reader = {
    current,
    readyCount: current?.proposals.filter((p) => p.status === 'ready').length ?? 0,
    save: async (pkey) => {
      const p = find(pkey);
      if (!p) return;
      const { payload } = quoteFromExtraction(p.ex, { ...p.contact, detectedAt: p.detectedAt, origin: 'whatsapp' });
      if (!payload) return;
      setProposal(pkey, { status: 'saving' });
      try {
        setProposal(pkey, { status: 'saved', quote: await api.createQuote(payload) });
      } catch (e) {
        setProposal(pkey, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    },
    ignore: (pkey) => setProposal(pkey, null),
    review: (pkey) => {
      const p = find(pkey);
      if (!p || !current) return;
      const used = new Set(p.key.split('|'));
      nav.go({
        name: 'review',
        capture: {
          id: newCaptureId(),
          mode: p.source === 'conversation' ? 'conversation' : 'file',
          text: '',
          attachments: [],
          conversation: p.source === 'conversation' ? current.messages.filter((m) => m.id && used.has(m.id)) : current.messages.slice(-CONTEXT_BEFORE),
          contactName: p.contact.contactName,
          contactPhone: p.contact.contactPhone,
          capturedAt: p.detectedAt,
          extraction: p.ex,
          origin: 'whatsapp',
        },
      });
      setProposal(pkey, null);
    },
    openQuote: (pkey) => {
      const q = find(pkey)?.quote;
      if (q) nav.go({ name: 'quote', id: q.id });
    },
    analyzeAnyway: () => current && analyzeChat(current.key),
    addFiles: (files) => {
      const contact: ContactResponse = current?.contact ?? { contactName: null, contactPhone: null };
      const key = current?.key ?? FILES_CHAT;
      for (const f of files) readFile(key, contact, f, f.media_type === 'application/pdf' ? 'pdf' : 'file');
    },
    reload: () => {
      // The buyer may have changed plan meanwhile: check again before reading.
      api
        .billing()
        .then((b) => b.can_read && setPaused(null))
        .catch(() => {})
        .finally(() => {
          if (active) sync(active);
          if (current && !pausedRef.current) schedule(current.key);
        });
    },
    paused,
  };

  return <ReaderContext.Provider value={reader}>{children}</ReaderContext.Provider>;
}
