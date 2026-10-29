import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Who reads screenshots: an API the device has a key for, Claude Code on the server, or nobody. */
export type AiProvider = '' | 'server' | 'anthropic' | 'openrouter' | 'gemini' | 'openai';

export const AI_PROVIDERS: { id: AiProvider; label: string; needsKey: boolean; modelHint?: string }[] = [
  { id: '', label: 'None', needsKey: false },
  { id: 'server', label: 'On my server', needsKey: false },
  { id: 'anthropic', label: 'Anthropic', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', needsKey: true, modelHint: 'e.g. google/gemini-2.5-flash' },
  { id: 'gemini', label: 'Gemini', needsKey: true, modelHint: 'e.g. gemini-2.5-flash' },
  { id: 'openai', label: 'OpenAI', needsKey: true, modelHint: 'e.g. gpt-4.1-mini' },
];

export type Config = { serverUrl: string; serverToken: string; aiProvider: AiProvider; aiKey: string; aiModel: string };

export type Transaction = {
  id: number;
  amount: number;
  currency: string;
  occurred_at: string;
  recipient: string;
  remark: string;
  source_app: string;
  payment_method: PaymentMethod;
  category: string;
  category_by: 'manual' | 'learned' | 'keyword' | 'ai';
  has_image: boolean;
  subscription_id: number | null;
  due_date: string | null;
};

export type Cycle = 'monthly' | 'yearly';

export type Subscription = {
  id: number;
  name: string;
  amount: number;
  currency: string;
  category: string;
  payment_method: PaymentMethod;
  cycle: Cycle;
  start_date: string; // YYYY-MM-DD
};

export type SubscriptionDraft = Pick<Subscription, 'name' | 'amount' | 'category' | 'payment_method' | 'cycle' | 'start_date'>;

/** One subscription payment in a month; transaction_id is set once it's marked as spent. */
export type Due = { subscription: Subscription; due_date: string; transaction_id: number | null };

export type PaymentMethod = 'shopee' | 'bca' | 'credit_card' | '';

export const PAYMENT_METHODS: { id: Exclude<PaymentMethod, ''>; label: string }[] = [
  { id: 'shopee', label: 'Shopee' },
  { id: 'bca', label: 'BCA transfer' },
  { id: 'credit_card', label: 'Credit card' },
];

export function paymentLabel(m: PaymentMethod) {
  return PAYMENT_METHODS.find((p) => p.id === m)?.label ?? '';
}

export type Draft = Partial<Pick<Transaction, 'amount' | 'occurred_at' | 'recipient' | 'remark' | 'category' | 'payment_method'>>;

const KEYS = {
  serverUrl: 'okane.serverUrl', serverToken: 'okane.serverToken',
  aiProvider: 'okane.aiProvider', aiKey: 'okane.aiKey', aiModel: 'okane.aiModel',
  legacyAnthropicKey: 'okane.anthropicKey', // before other providers existed
};

// SecureStore has no web implementation; the browser falls back to localStorage.
const store = Platform.OS === 'web'
  ? {
      getItemAsync: async (k: string) => localStorage.getItem(k),
      setItemAsync: async (k: string, v: string) => localStorage.setItem(k, v),
      deleteItemAsync: async (k: string) => localStorage.removeItem(k),
    }
  : SecureStore;

export async function loadConfig(): Promise<Config | null> {
  const [serverUrl, serverToken, aiProvider, aiKey, aiModel, legacy] = await Promise.all(
    [KEYS.serverUrl, KEYS.serverToken, KEYS.aiProvider, KEYS.aiKey, KEYS.aiModel, KEYS.legacyAnthropicKey].map((k) => store.getItemAsync(k)),
  );
  if (!serverUrl || !serverToken) return null;
  if (aiProvider === null && legacy) return { serverUrl, serverToken, aiProvider: 'anthropic', aiKey: legacy, aiModel: '' };
  return { serverUrl, serverToken, aiProvider: (aiProvider ?? '') as AiProvider, aiKey: aiKey ?? '', aiModel: aiModel ?? '' };
}

export async function saveConfig(c: Config): Promise<void> {
  await store.setItemAsync(KEYS.serverUrl, c.serverUrl);
  await store.setItemAsync(KEYS.serverToken, c.serverToken);
  await store.setItemAsync(KEYS.aiProvider, c.aiProvider);
  if (c.aiKey) await store.setItemAsync(KEYS.aiKey, c.aiKey);
  else await store.deleteItemAsync(KEYS.aiKey);
  await store.setItemAsync(KEYS.aiModel, c.aiModel);
  await store.deleteItemAsync(KEYS.legacyAnthropicKey);
}

function imageForm(asset: ImagePicker.ImagePickerAsset) {
  const form = new FormData();
  // The browser hands us a real File; React Native's FormData takes a { uri, name, type } descriptor instead.
  form.append('file', asset.file ?? ({ uri: asset.uri, name: 'receipt', type: asset.mimeType ?? 'image/jpeg' } as unknown as Blob));
  return form;
}

function xhr(method: string, url: string, headers: Record<string, string>, body: FormData) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const r = new XMLHttpRequest();
    r.open(method, url);
    for (const [k, v] of Object.entries(headers)) r.setRequestHeader(k, v);
    r.onload = () => {
      let parsed = null;
      try { parsed = JSON.parse(r.responseText); } catch {}
      resolve({ status: r.status, body: parsed });
    };
    r.onerror = () => reject(new Error('Network request failed'));
    r.ontimeout = () => reject(new Error('Request timed out'));
    r.send(body);
  });
}

export class Api {
  constructor(private c: Config) {}

  get canScan() {
    return this.c.aiProvider === 'server' || (this.c.aiProvider !== '' && this.c.aiKey !== '');
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = this.c.serverUrl.replace(/\/+$/, '') + path;
    const headers = { Authorization: `Bearer ${this.c.serverToken}`, ...(init.headers as Record<string, string>) };
    // Expo's fetch can't send React Native's { uri } file parts, so phone uploads go through XMLHttpRequest.
    const { status, body } = init.body instanceof FormData && Platform.OS !== 'web'
      ? await xhr(init.method ?? 'POST', url, headers, init.body)
      : await fetch(url, { ...init, headers }).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => null),
      }));
    if (status < 200 || status >= 300) {
      const detail = body?.detail;
      throw new Error(typeof detail === 'string' ? detail : `Server error ${status}`);
    }
    return body as T;
  }

  /** Older servers have no /capabilities; treat that as no server-side scanning. */
  capabilities() {
    return this.req<{ server_scan: boolean }>('/capabilities').catch(() => ({ server_scan: false }));
  }

  categories() {
    return this.req<string[]>('/categories');
  }

  /** Older servers have no /settings; they store everything as rupiah. */
  settings() {
    return this.req<{ currency: string }>('/settings').catch(() => ({ currency: 'IDR' }));
  }

  saveSettings(currency: string) {
    return this.req<{ currency: string }>('/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency }),
    });
  }

  list(month: string) {
    return this.req<Transaction[]>(`/transactions?month=${month}`);
  }

  addManual(d: Draft) {
    return this.req<Transaction>('/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
  }

  scan(asset: ImagePicker.ImagePickerAsset) {
    const form = imageForm(asset);
    return this.req<Transaction>('/transactions/scan', {
      method: 'POST',
      // the key only travels with scans; the server passes it on and never stores it
      headers: { 'X-AI-Provider': this.c.aiProvider, 'X-AI-Key': this.c.aiKey, 'X-AI-Model': this.c.aiModel },
      body: form,
    });
  }

  /** Store a screenshot on an expense as-is (no AI reading). Replaces any existing one. */
  attachImage(id: number, asset: ImagePicker.ImagePickerAsset) {
    return this.req<Transaction>(`/transactions/${id}/image`, { method: 'PUT', body: imageForm(asset) });
  }

  removeImage(id: number) {
    return this.req<Transaction>(`/transactions/${id}/image`, { method: 'DELETE' });
  }

  update(id: number, d: Draft) {
    return this.req<Transaction>(`/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
  }

  remove(id: number) {
    return this.req<{ deleted: number }>(`/transactions/${id}`, { method: 'DELETE' });
  }

  subscriptions() {
    return this.req<Subscription[]>('/subscriptions');
  }

  due(month: string) {
    return this.req<Due[]>(`/subscriptions/due?month=${month}`);
  }

  saveSubscription(d: SubscriptionDraft, id?: number) {
    return this.req<Subscription>(id ? `/subscriptions/${id}` : '/subscriptions', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
  }

  removeSubscription(id: number) {
    return this.req<{ deleted: number }>(`/subscriptions/${id}`, { method: 'DELETE' });
  }

  /** Mark a due date as spent: creates the expense, or links `transactionId` if you already logged it. */
  markSpent(id: number, dueDate: string, transactionId?: number) {
    return this.req<Transaction>(`/subscriptions/${id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: dueDate, transaction_id: transactionId }),
    });
  }

  imageSource(id: number) {
    return {
      uri: `${this.c.serverUrl.replace(/\/+$/, '')}/transactions/${id}/image`,
      headers: { Authorization: `Bearer ${this.c.serverToken}` },
    };
  }
}

const SYMBOLS: Record<string, string> = {
  IDR: 'Rp', USD: '$', SGD: 'S$', EUR: '€', JPY: '¥', MYR: 'RM', AUD: 'A$', GBP: '£', KRW: '₩', CNY: 'CN¥',
  THB: '฿', PHP: '₱', VND: '₫', INR: '₹', HKD: 'HK$', TWD: 'NT$', CAD: 'C$', CHF: 'CHF', NZD: 'NZ$',
};
export const CURRENCIES = Object.keys(SYMBOLS);
const NO_CENTS = ['IDR', 'JPY', 'KRW', 'VND'];

/** The currency every amount is stored in, set from the server's settings when the app starts. */
let home = 'IDR';
export const homeCurrency = () => home;
export function setHomeCurrency(c: string) { home = c; }

export const hasCents = (c: string) => !NO_CENTS.includes(c);

/** What the user typed, as a number: "25.000" is 25000 in rupiah, "12,99" is 12.99 in dollars. */
export function parseAmount(text: string, currency: string) {
  return hasCents(currency) ? Number(text.replace(',', '.').replace(/[^\d.]/g, '')) : Number(text.replace(/\D/g, ''));
}

/** Amount in `currency` (default: home) styled the local way, e.g. "Rp 25.000" or "$ 1,250.50". */
export function money(n: number, currency = home) {
  const cents = hasCents(currency);
  const [whole, frac] = Math.abs(n).toFixed(cents ? 2 : 0).split('.');
  const sep = currency === 'IDR' || currency === 'VND' || currency === 'EUR' ? ['.', ','] : [',', '.'];
  const text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep[0]) + (frac && frac !== '00' ? sep[1] + frac : '');
  return `${n < 0 ? '-' : ''}${SYMBOLS[currency] ?? currency} ${text}`;
}

/** Today's value of 1 `from` in `to` (free daily rates, no key needed). */
export async function exchangeRate(from: string, to: string) {
  if (from === to) return 1;
  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  const body = await res.json();
  const rate = body?.rates?.[to];
  if (body?.result !== 'success' || typeof rate !== 'number') throw new Error("Couldn't get today's exchange rate");
  return rate as number;
}

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthName(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
}

export function localIso(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
