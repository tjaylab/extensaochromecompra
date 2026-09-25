import { useRef, useState } from 'react';
import { newCaptureId } from '../../lib/capture';
import { Field, Screen, useNav } from '../ui';

/** Alternative to the WhatsApp flow: paste a proposal received elsewhere. */
export function NewQuote() {
  const nav = useNav();
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const startedAt = useRef(Date.now());

  const interpret = () =>
    nav.replace({
      name: 'review',
      capture: {
        id: newCaptureId(),
        mode: 'selection',
        text: text.trim(),
        conversation: null,
        contactName: contact.trim() || null,
        contactPhone: null,
        capturedAt: startedAt.current,
        origin: 'manual',
      },
    });

  return (
    <Screen
      title="Nova cotação"
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={!text.trim()} onClick={interpret}>
          Interpretar mensagem
        </button>
      }
    >
      <Field id="paste" label="Texto da proposta" hint="Cole a mensagem do fornecedor exatamente como recebida.">
        <textarea id="paste" className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} autoFocus />
      </Field>
      <Field id="contact" label="Fornecedor ou contato (opcional)">
        <input id="contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
      </Field>
    </Screen>
  );
}
