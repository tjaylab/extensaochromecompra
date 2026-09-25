// Only the formatting helpers: keeps the content script free of the schema library.
import { looksLikeProposal } from '@compras/shared/format';
import type { MessageRow } from './whatsapp-dom';

export type Arrival =
  | { kind: 'text'; row: MessageRow }
  | { kind: 'image'; row: MessageRow }
  | { kind: 'pdf-hint'; row: MessageRow };

/**
 * Decides which bubbles are *new arrivals* worth a suggestion. Pure logic, fed with the rows on each scan:
 * - the first scan of a conversation (and any conversation switch) only records a baseline;
 * - only rows after the last row already seen count, so older messages loaded by scrolling up never trigger;
 * - incoming rows still loading (no text, no image yet) are retried for a while.
 */
export class MessageWatch {
  private chat = '';
  private lastSeen: string | null = null;
  private pending = new Map<string, number>(); // row id -> first seen (ms)
  private done = new Set<string>();

  constructor(private retryMs = 30_000) {}

  scan(chat: string, rows: MessageRow[], now = Date.now()): Arrival[] {
    if (chat !== this.chat || !rows.length) {
      this.reset(chat, rows);
      return [];
    }
    const idx = this.lastSeen ? rows.findIndex((r) => r.id === this.lastSeen) : -1;
    if (idx === -1) {
      // The last row we saw is gone (virtualized list or a big jump): start over without suggesting.
      this.reset(chat, rows);
      return [];
    }
    for (const r of rows.slice(idx + 1)) if (r.direction === 'in' && !this.done.has(r.id)) this.pending.set(r.id, now);
    this.lastSeen = rows[rows.length - 1]!.id;

    const out: Arrival[] = [];
    for (const [id, first] of [...this.pending]) {
      const row = rows.find((r) => r.id === id);
      const settle = () => {
        this.pending.delete(id);
        this.done.add(id);
      };
      if (!row || now - first > this.retryMs) {
        settle();
        continue;
      }
      if (row.image) {
        settle();
        out.push({ kind: 'image', row });
      } else if (row.pdfName) {
        settle();
        out.push({ kind: 'pdf-hint', row });
      } else if (row.text) {
        settle();
        if (looksLikeProposal(row.text)) out.push({ kind: 'text', row });
      }
      // else: still loading, try again on the next scan
    }
    return out;
  }

  private reset(chat: string, rows: MessageRow[]) {
    this.chat = chat;
    this.lastSeen = rows[rows.length - 1]?.id ?? null;
    this.pending.clear();
    this.done = new Set(rows.map((r) => r.id));
  }
}
