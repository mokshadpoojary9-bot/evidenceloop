import { supabase } from './lib/supabase';
import type {
  AddRequirementsInput,
  DashboardData,
  EvidenceKind,
  NewWorkOrderInput,
  RequirementDraftResponse,
  ReviewDecision,
  Role,
  SystemStatus,
  UploadEvidenceResponse,
  Viewer,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderSummary,
  WorkOrderTemplate,
} from './types';

const BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');

/**
 * Local development only: the role picked in the header's role switcher. The
 * backend ignores this header whenever Supabase Auth is configured.
 */
let demoRole: Role | null = null;
export const setDemoRole = (role: Role | null) => {
  demoRole = role;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: string;
  code?: string;
  issues?: { path: string; message: string }[];
}

/** The signed-in user's token, or the local demo role. */
async function authHeaders(headers: Headers): Promise<Headers> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);
  else if (demoRole) headers.set('X-Demo-Role', demoRole);
  return headers;
}

function apiError(status: number, body: ErrorBody): ApiError {
  const detail = body.issues?.map((issue) => issue.message).join('; ');
  return new ApiError(detail || body.error || `Request failed (${status})`, status, body.code);
}

/*
 * Waking the server. The deployed API (Render free tier) sleeps when idle; the first
 * requests after that hang or fail with 502/503/504 for up to about a minute. While
 * that lasts, reads are retried automatically and the UI shows "Waking up server…"
 * instead of an error. Only with a separate API host (VITE_API_BASE_URL): in local
 * development a failure means the backend is not running, and that is reported at once.
 */
const WAKE_ENABLED = BASE_URL !== '';
const WAKE_DEADLINE_MS = 90_000;
/** A request this slow before the server has ever answered is most likely a cold start. */
const WAKE_SLOW_MS = 2_500;
const WAKE_STATUSES = new Set([502, 503, 504]);

let serverAnswered = false;
let wakingCount = 0;
const wakeListeners = new Set<() => void>();

function setWaking(delta: 1 | -1) {
  const before = wakingCount > 0;
  wakingCount += delta;
  if (before !== wakingCount > 0) wakeListeners.forEach((listener) => listener());
}

/** For useSyncExternalStore: whether the UI should say "Waking up server…". */
export const serverWake = {
  subscribe(listener: () => void) {
    wakeListeners.add(listener);
    return () => void wakeListeners.delete(listener);
  },
  isWaking: () => wakingCount > 0,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const UNREACHABLE = 'Cannot reach the EvidenceLoop API. Is the backend running?';

/** fetch, retried while a sleeping server wakes up. Writes are never retried. */
async function fetchWithWake(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (!WAKE_ENABLED || (method !== 'GET' && method !== 'HEAD')) {
    try {
      const response = await fetch(url, init);
      serverAnswered = true;
      return response;
    } catch {
      throw new ApiError(UNREACHABLE, 0);
    }
  }

  const started = Date.now();
  let waking = false;
  const startWaking = () => {
    if (!waking) {
      waking = true;
      setWaking(1);
    }
  };
  const slowTimer = serverAnswered ? undefined : setTimeout(startWaking, WAKE_SLOW_MS);
  try {
    for (let attempt = 0; ; attempt++) {
      const outOfTime = Date.now() - started > WAKE_DEADLINE_MS;
      try {
        const response = await fetch(url, init);
        if (!WAKE_STATUSES.has(response.status) || outOfTime) {
          serverAnswered = true;
          return response;
        }
      } catch {
        if (outOfTime) throw new ApiError(`${UNREACHABLE} It did not wake up within ${WAKE_DEADLINE_MS / 1000} s.`, 0);
      }
      startWaking();
      await sleep(Math.min(1000 * 2 ** attempt, 5000));
    }
  } finally {
    clearTimeout(slowTimer);
    if (waking) setWaking(-1);
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  await authHeaders(headers);

  const response = await fetchWithWake(`${BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) throw apiError(response.status, (await response.json().catch(() => ({}))) as ErrorBody);
  return response;
}

/** A form upload that reports progress (fetch cannot), as a fraction 0–1. */
async function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  const headers = await authHeaders(new Headers());
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}${path}`);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError(UNREACHABLE, 0));
    xhr.onload = () => {
      let body: unknown = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: handled as an error body below
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(apiError(xhr.status, body as ErrorBody));
    };
    xhr.send(form);
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Saves a response body as a file in the browser. */
async function download(path: string, fallbackName: string) {
  const response = await send(path);
  const name = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Local-development file URLs are relative to the API; signed Supabase URLs are absolute. */
export const fileUrl = (url: string | null) => (url?.startsWith('/') ? `${BASE_URL}${url}` : url);

export const api = {
  system: () => request<SystemStatus>('/api/system'),
  me: () => request<Viewer>('/api/me'),
  submitForReview: (id: string, note: string) =>
    request<WorkOrderDetail>(`/api/work-orders/${id}/reviews`, { method: 'POST', body: JSON.stringify({ note }) }),
  decideReview: (
    id: string,
    body: { decision: ReviewDecision; note: string; request?: { kind: EvidenceKind; instruction: string } },
  ) => request<WorkOrderDetail>(`/api/work-orders/${id}/reviews/decision`, { method: 'POST', body: JSON.stringify(body) }),
  templates: () =>
    request<{ templates: WorkOrderTemplate[] }>('/api/templates').then((r) => r.templates),
  dashboard: () => request<DashboardData>('/api/dashboard'),
  listWorkOrders: () =>
    request<{ workOrders: WorkOrderSummary[] }>('/api/work-orders').then((r) => r.workOrders),
  getWorkOrder: (id: string) => request<WorkOrderDetail>(`/api/work-orders/${id}`),
  createWorkOrder: (input: NewWorkOrderInput) =>
    request<WorkOrderDetail>('/api/work-orders', { method: 'POST', body: JSON.stringify(input) }),
  editWorkOrder: (id: string, patch: Partial<Pick<WorkOrder, 'title' | 'description' | 'location'>>) =>
    request<WorkOrderDetail>(`/api/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  archive: (id: string) => request<WorkOrderDetail>(`/api/work-orders/${id}/archive`, { method: 'POST' }),
  unarchive: (id: string) => request<WorkOrderDetail>(`/api/work-orders/${id}/unarchive`, { method: 'POST' }),
  deleteWorkOrder: (id: string) => request<void>(`/api/work-orders/${id}`, { method: 'DELETE' }),
  downloadReport: (id: string) => download(`/api/work-orders/${id}/report.pdf`, 'evidenceloop-report.pdf'),
  draftRequirements: (file: File, context: { title: string; description: string; location: string }) => {
    const form = new FormData();
    form.set('title', context.title);
    form.set('description', context.description);
    form.set('location', context.location);
    form.set('file', file);
    return request<RequirementDraftResponse>('/api/requirements/draft', { method: 'POST', body: form });
  },
  addRequirements: (id: string, input: AddRequirementsInput) =>
    request<WorkOrderDetail>(`/api/work-orders/${id}/requirements`, { method: 'POST', body: JSON.stringify(input) }),
  analyze: (id: string) =>
    request<{ runId: string | null; queued: boolean }>(`/api/work-orders/${id}/analyze`, {
      method: 'POST',
    }),
  uploadEvidence: (
    id: string,
    input: { file: File; kind: EvidenceKind; note: string; requestId: string | null },
    onProgress?: (fraction: number) => void,
  ) => {
    const form = new FormData();
    form.set('kind', input.kind);
    form.set('note', input.note);
    if (input.requestId) form.set('requestId', input.requestId);
    form.set('file', input.file);
    return upload<UploadEvidenceResponse>(`/api/work-orders/${id}/evidence`, form, onProgress);
  },
};
