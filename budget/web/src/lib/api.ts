// All API URLs are relative to the page so the app works under the Home Assistant Ingress prefix.
const API_BASE = new URL('api/', document.baseURI).toString();

/** Absolute URL of an API path, for plain links such as downloads. Stays under the Ingress prefix. */
export function apiUrl(path: string): string {
  return new URL(path.replace(/^\//, ''), API_BASE).toString();
}

export const ME_STORAGE_KEY = 'budget.me';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function readStoredPerson(): string | null {
  try {
    return localStorage.getItem(ME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storePerson(id: string): void {
  try {
    localStorage.setItem(ME_STORAGE_KEY, id);
  } catch {
    // storage can be unavailable (private mode); the selector will simply ask again
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const me = readStoredPerson();
  if (me) headers['X-Budget-Person'] = me;

  let res: Response;
  try {
    res = await fetch(new URL(path.replace(/^\//, ''), API_BASE), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'network', 'Connexion impossible au serveur');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, err.error ?? 'error', err.message ?? `Erreur ${res.status}`);
  }
  return data as T;
}

/** Sends a raw text body (CSV). */
export async function postText<T>(path: string, text: string, contentType = 'text/csv'): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  const me = readStoredPerson();
  if (me) headers['X-Budget-Person'] = me;
  const res = await fetch(new URL(path.replace(/^\//, ''), API_BASE), { method: 'POST', headers, body: text });
  const raw = await res.text();
  const data: unknown = raw ? JSON.parse(raw) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, err.error ?? 'error', err.message ?? `Erreur ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body),
  delete: <T = void>(path: string): Promise<T> => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}
