import * as SecureStore from 'expo-secure-store';

export type Config = { serverUrl: string; serverToken: string; anthropicKey: string };

export type Transaction = {
  id: number;
  amount: number;
  currency: string;
  occurred_at: string;
  recipient: string;
  remark: string;
  source_app: string;
  category: string;
  category_by: 'manual' | 'learned' | 'keyword' | 'ai';
  has_image: boolean;
};

export type Draft = Partial<Pick<Transaction, 'amount' | 'occurred_at' | 'recipient' | 'remark' | 'category'>>;

const KEYS = { serverUrl: 'okane.serverUrl', serverToken: 'okane.serverToken', anthropicKey: 'okane.anthropicKey' };

export async function loadConfig(): Promise<Config | null> {
  const [serverUrl, serverToken, anthropicKey] = await Promise.all([
    SecureStore.getItemAsync(KEYS.serverUrl),
    SecureStore.getItemAsync(KEYS.serverToken),
    SecureStore.getItemAsync(KEYS.anthropicKey),
  ]);
  if (!serverUrl || !serverToken) return null;
  return { serverUrl, serverToken, anthropicKey: anthropicKey ?? '' };
}

export async function saveConfig(c: Config): Promise<void> {
  await SecureStore.setItemAsync(KEYS.serverUrl, c.serverUrl);
  await SecureStore.setItemAsync(KEYS.serverToken, c.serverToken);
  if (c.anthropicKey) await SecureStore.setItemAsync(KEYS.anthropicKey, c.anthropicKey);
  else await SecureStore.deleteItemAsync(KEYS.anthropicKey);
}

export class Api {
  constructor(private c: Config) {}

  get canScan() {
    return this.c.anthropicKey !== '';
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.c.serverUrl.replace(/\/+$/, '') + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.c.serverToken}`, ...(init.headers as Record<string, string>) },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.detail;
      throw new Error(typeof detail === 'string' ? detail : `Server error ${res.status}`);
    }
    return body as T;
  }

  categories() {
    return this.req<string[]>('/categories');
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

  scan(uri: string, mimeType: string) {
    const form = new FormData();
    // React Native's FormData accepts a { uri, name, type } file descriptor.
    form.append('file', { uri, name: 'receipt', type: mimeType } as unknown as Blob);
    return this.req<Transaction>('/transactions/scan', {
      method: 'POST',
      headers: { 'X-Anthropic-Key': this.c.anthropicKey },
      body: form,
    });
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

  imageSource(id: number) {
    return {
      uri: `${this.c.serverUrl.replace(/\/+$/, '')}/transactions/${id}/image`,
      headers: { Authorization: `Bearer ${this.c.serverToken}` },
    };
  }
}

export function rupiah(n: number) {
  return 'Rp ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function localIso(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
