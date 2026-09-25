// Helpers shared by the extension and the API. Pure functions, no I/O.

/**
 * Parses a number typed or extracted in Brazilian or international format.
 * "111,46" -> 111.46, "1.234,50" -> 1234.5, "1,234.50" -> 1234.5, "1.234" -> 1234.
 * Returns null for empty or unparseable input.
 */
export function parseDecimal(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = input.trim().replace(/\s/g, '').replace(/^(R\$|US\$|USD|BRL|EUR|€|\$)/i, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The last separator is the decimal one.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  } else if (lastDot > -1) {
    // "1.234" (exactly 3 digits after a single dot) is a thousands separator in pt-BR.
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1]!.length === 3)) s = parts.join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(value: number | null | undefined, currency?: string | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!currency) return n;
  return currency === 'BRL' ? `R$ ${n}` : `${currency} ${n}`;
}

export function formatDecimal(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

/** Lower case, no accents, no punctuation and no company suffixes, for duplicate detection. */
export function normalizeSupplierName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(ltda|me|epp|eireli|sa|s a|cia|comercio|com|ind|industria)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort E.164 for Brazilian numbers as shown by WhatsApp Web ("+55 11 97000-1234"). */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

export function onlyDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

export function isValidCnpj(input: string): boolean {
  const c = onlyDigits(input);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export function formatCnpj(input: string): string {
  const c = onlyDigits(input).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** ISO date (YYYY-MM-DD) to DD/MM/YYYY. */
export function isoToBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** DD/MM/YYYY (or ISO) to ISO date. Returns null when invalid. */
export function brToIso(br: string | null | undefined): string | null {
  if (!br) return null;
  const s = br.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // Rejects impossible dates such as 31/02.
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function quoteNumber(seq: number): string {
  return `COT-${String(seq).padStart(4, '0')}`;
}

export function requisitionNumber(seq: number): string {
  return `REQ-${String(seq).padStart(4, '0')}`;
}

export function orderNumber(seq: number): string {
  return `PC-${String(seq).padStart(4, '0')}`;
}
