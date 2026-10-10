import { supabase } from './lib/supabase';
import type {
  EvidenceKind,
  NewWorkOrderInput,
  SystemStatus,
  UploadEvidenceResponse,
  WorkOrderDetail,
  WorkOrderSummary,
  WorkOrderTemplate,
} from './types';

const BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Cannot reach the EvidenceLoop API. Is the backend running?', 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    const detail = body.issues?.map((issue) => issue.message).join('; ');
    throw new ApiError(
      detail || body.error || `Request failed (${response.status})`,
      response.status,
      body.code,
    );
  }
  return (await response.json()) as T;
}

/** Local-development file URLs are relative to the API; signed Supabase URLs are absolute. */
export const fileUrl = (url: string | null) => (url?.startsWith('/') ? `${BASE_URL}${url}` : url);

export const api = {
  system: () => request<SystemStatus>('/api/system'),
  templates: () =>
    request<{ templates: WorkOrderTemplate[] }>('/api/templates').then((r) => r.templates),
  listWorkOrders: () =>
    request<{ workOrders: WorkOrderSummary[] }>('/api/work-orders').then((r) => r.workOrders),
  getWorkOrder: (id: string) => request<WorkOrderDetail>(`/api/work-orders/${id}`),
  createWorkOrder: (input: NewWorkOrderInput) =>
    request<WorkOrderDetail>('/api/work-orders', { method: 'POST', body: JSON.stringify(input) }),
  analyze: (id: string) =>
    request<{ runId: string | null; queued: boolean }>(`/api/work-orders/${id}/analyze`, {
      method: 'POST',
    }),
  uploadEvidence: (
    id: string,
    input: { file: File; kind: EvidenceKind; note: string; requestId: string | null },
  ) => {
    const form = new FormData();
    form.set('kind', input.kind);
    form.set('note', input.note);
    if (input.requestId) form.set('requestId', input.requestId);
    form.set('file', input.file);
    return request<UploadEvidenceResponse>(`/api/work-orders/${id}/evidence`, {
      method: 'POST',
      body: form,
    });
  },
};
