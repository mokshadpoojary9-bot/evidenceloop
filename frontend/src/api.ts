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

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  await authHeaders(headers);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Cannot reach the EvidenceLoop API. Is the backend running?', 0);
  }

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
    xhr.onerror = () => reject(new ApiError('Cannot reach the EvidenceLoop API. Is the backend running?', 0));
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
