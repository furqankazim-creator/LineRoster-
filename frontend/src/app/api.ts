/**
 * Thin client for the LineRoster API (server/).
 *
 * The web app stays local-first: nothing here is required for it to work.
 * When VITE_API_URL is set and the supervisor has signed in, the app can push
 * and pull its whole dataset to the shared database and ask the assistant.
 */

const TOKEN_KEY = 'shiftline.token';
const USER_KEY = 'shiftline.user';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const cloudEnabled = () => true;

export interface CloudUser {
  id: string;
  email: string;
  role: 'supervisor' | 'viewer';
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): CloudUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as CloudUser) : null;
  } catch {
    return null;
  }
}

export function signOut() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error('No API URL configured (VITE_API_URL).');
  const token = getToken();
  const res = await fetch(API_URL + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function signIn(email: string, password: string): Promise<CloudUser> {
  const { token, user } = await call<{ token: string; user: CloudUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

/** Server capabilities, so the chat can skip sign-in when the server allows it. */
export const health = async (): Promise<{ ok: boolean; ai: boolean; aiPublic: boolean }> => {
  if (API_URL) {
    try {
      const r = await fetch(API_URL + '/health');
      if (r.ok) return (await r.json()) as { ok: boolean; ai: boolean; aiPublic: boolean };
    } catch {
      /* fallback */
    }
  }
  try {
    const r = await fetch('/health');
    if (r.ok) return (await r.json()) as { ok: boolean; ai: boolean; aiPublic: boolean };
  } catch {
    /* fallback */
  }
  return { ok: true, ai: true, aiPublic: true };
};

export interface AiAction {
  employeeId: string;
  dayIndex: number;
  code: string;
  reason?: string;
}

export interface AiReply {
  answer: string;
  actions: AiAction[];
  preview: {
    errorsBefore: number;
    errorsAfter: number;
    warningsBefore: number;
    warningsAfter: number;
    rejected: { action: AiAction; why: string }[];
  } | null;
}

export const askAssistant = async (payload: {
  lineId: string;
  year: number;
  month: number;
  question: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  context: any;
}): Promise<AiReply> => {
  if (API_URL) {
    try {
      return await call<AiReply>('/ai/ask', { method: 'POST', body: JSON.stringify(payload) });
    } catch (err) {
      console.warn('Remote assistant endpoint unavailable, falling back to local engine:', err);
    }
  }

  try {
    const res = await fetch('/ai/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.answer) return data as AiReply;
    }
  } catch {
    /* fallback */
  }

  const { generateAssistantReply } = await import('@/features/assistant/assistantEngine');
  return generateAssistantReply(payload as any);
};
