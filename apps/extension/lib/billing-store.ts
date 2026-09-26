import { useEffect, useState } from 'react';
import type { BillingDTO } from '@compras/shared';
import { api } from './api';

// The company's plan and usage, shared by the header chip, Work and "Plano e uso". Fetched once and refreshed
// every minute (readings change as the AI reads) or when refreshBilling() is called.

let current: BillingDTO | null = null;
let inflight: Promise<void> | null = null;
let lastFetch = 0;
const listeners = new Set<(b: BillingDTO | null) => void>();
const MAX_AGE_MS = 60_000;

export function refreshBilling(): Promise<void> {
  inflight ??= api
    .billing()
    .then((b) => {
      current = b;
      lastFetch = Date.now();
      listeners.forEach((l) => l(b));
    })
    .catch(() => {})
    .finally(() => (inflight = null));
  return inflight;
}

export function setBilling(b: BillingDTO) {
  current = b;
  lastFetch = Date.now();
  listeners.forEach((l) => l(b));
}

export function useBilling(): BillingDTO | null {
  const [b, setB] = useState(current);
  useEffect(() => {
    listeners.add(setB);
    if (!current || Date.now() - lastFetch > MAX_AGE_MS) refreshBilling();
    const t = setInterval(refreshBilling, MAX_AGE_MS);
    return () => {
      listeners.delete(setB);
      clearInterval(t);
    };
  }, []);
  return b;
}
