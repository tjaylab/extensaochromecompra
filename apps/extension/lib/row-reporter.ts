import type { MessageRow } from './whatsapp-dom';

export interface RowBatch {
  /** 'initial' when the conversation was opened, 'older' when scrolling up loaded history, 'newer' for new arrivals. */
  position: 'initial' | 'older' | 'newer';
  rows: MessageRow[];
}

/**
 * Reports every message bubble of the open conversation exactly once, as it appears on screen: what is
 * loaded when the conversation opens, older messages as the buyer scrolls up, and new ones as they arrive.
 * Pure logic, fed with the rows (in page order) on each scan.
 */
export class RowReporter {
  private chat = '';
  private seen = new Set<string>();
  /** Rows reported with no content yet (image or document still loading), retried on later scans. */
  private loading = new Set<string>();

  scan(chat: string, rows: MessageRow[]): RowBatch[] {
    if (chat !== this.chat) {
      this.chat = chat;
      this.seen = new Set();
      this.loading = new Set();
    }
    const firstSeen = rows.findIndex((r) => this.seen.has(r.id));
    const fresh = rows.filter((r) => !this.seen.has(r.id) || (this.loading.has(r.id) && (r.text || r.image || r.pdfName)));
    if (!fresh.length) return [];
    const isInitial = firstSeen === -1 && this.seen.size === 0;
    const older: MessageRow[] = [];
    const newer: MessageRow[] = [];
    for (const r of fresh) {
      const idx = rows.indexOf(r);
      this.seen.add(r.id);
      if (r.text || r.image || r.pdfName) this.loading.delete(r.id);
      else this.loading.add(r.id);
      (!isInitial && firstSeen !== -1 && idx < firstSeen ? older : newer).push(r);
    }
    const out: RowBatch[] = [];
    if (isInitial) return [{ position: 'initial', rows: newer }];
    if (older.length) out.push({ position: 'older', rows: older });
    if (newer.length) out.push({ position: 'newer', rows: newer });
    return out;
  }
}
