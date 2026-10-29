import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, serverWake } from './api';
import { useToast } from './components/ui';
import { fetchCached, readCache } from './lib/cache';
import type { CaptureInfo } from './lib/capture';
import { CACHE_KEYS } from './lib/prefetch';
import { supabase } from './lib/supabase';
import type { EvidenceKind, ReanalysisOutcome, SystemStatus, WorkOrderDetail } from './types';

let systemPromise: Promise<SystemStatus> | null = null;
const SYSTEM_RECHECK_MS = 3000;

/**
 * System status (AI mode, persistence, auth). Fetched once per page load, and
 * re-fetched while the backend's live AI connection test is still running.
 */
export function useSystem() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      systemPromise ??= api.system();
      systemPromise.then(
        (value) => {
          if (cancelled) return;
          setSystem(value);
          if (value.ai.live.state === 'checking') {
            timer = setTimeout(() => {
              systemPromise = null;
              load();
            }, SYSTEM_RECHECK_MS);
          }
        },
        (err: Error) => {
          systemPromise = null; // allow a retry on the next mount
          if (!cancelled) setError(err.message);
        },
      );
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { system, error };
}

/** True while requests wait for a sleeping API server (Render free tier) to wake up. */
export function useServerWaking() {
  return useSyncExternalStore(serverWake.subscribe, serverWake.isWaking);
}

/** While a run is in flight: follow the agent closely. */
const RUN_POLL_MS = 1000;
/** Local mode (no Supabase Realtime): pick up changes from other tabs or the API. */
export const LOCAL_POLL_MS = 5000;
/** Without Supabase there is no Realtime channel, so the pages poll instead. */
export const realtimeAvailable = supabase !== null;

/**
 * Loads a work order and keeps it current: Supabase Realtime when configured,
 * otherwise polling every 5 s; and every second while a run is in flight.
 * Polling pauses while the tab is hidden.
 */
export function useWorkOrder(id: string) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(() => readCache<WorkOrderDetail>(CACHE_KEYS.workOrder(id)) ?? null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchCached(CACHE_KEYS.workOrder(id), () => api.getWorkOrder(id));
      if (ticket === latest.current) {
        setDetail(next);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [id]);

  useEffect(() => {
    // Another work order: show its last data at once (if any) while the fresh copy loads.
    setDetail(readCache<WorkOrderDetail>(CACHE_KEYS.workOrder(id)) ?? null);
    void refresh();
  }, [id, refresh]);

  const analyzing =
    detail?.workOrder.status === 'ANALYZING' ||
    detail?.runs.some((run) => run.status === 'RUNNING') === true;

  const poll = useCallback(() => void refresh(), [refresh]);
  usePolling(poll, analyzing ? RUN_POLL_MS : LOCAL_POLL_MS, analyzing || !realtimeAvailable);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let channel = client.channel(`work-order-${id}`);
    for (const table of ['requirements', 'evidence_requests', 'audit_events']) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `work_order_id=eq.${id}` },
        () => void refresh(),
      );
    }
    channel = channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'work_orders', filter: `id=eq.${id}` },
      () => void refresh(),
    );
    channel.subscribe();
    return () => void client.removeChannel(channel);
  }, [id, refresh]);

  return { detail, error, analyzing, refresh };
}

/**
 * Calls `poll` every `intervalMs` while `enabled` and the tab is visible. Hidden tabs
 * don't poll; when the tab comes back, it polls once at once and then resumes. Stops on
 * unmount. The latest `poll` is always the one called.
 */
export function usePolling(poll: () => void, intervalMs: number, enabled: boolean) {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => latest.current(), intervalMs);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else if (timer === undefined) {
        latest.current();
        start();
      }
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}

/**
 * Keeps a page current. With Supabase: a Realtime subscription to `tables` (row-level
 * security limits what arrives), removed on unmount. Without it: polling every 5 s while
 * the tab is visible. Pass `tables` as a module-level constant.
 */
export function useLiveRefresh(refresh: () => void, channelName: string, tables: readonly string[]) {
  usePolling(refresh, LOCAL_POLL_MS, !realtimeAvailable);
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let channel = client.channel(channelName);
    for (const table of tables) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => latest.current());
    }
    channel.subscribe();
    return () => void client.removeChannel(channel);
  }, [channelName, tables]);
}

export interface UploadInput {
  file: File;
  kind: EvidenceKind;
  note: string;
  requestId: string | null;
  /** Taken with the in-app camera; recorded in the audit trail. */
  capture?: CaptureInfo | null;
}

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; fileName: string; progress: number }
  | { phase: 'failed'; fileName: string; error: string }
  | { phase: 'done'; fileName: string; message: string };

const OUTCOME_MESSAGE: Record<ReanalysisOutcome, string> = {
  started: 'Re-analysing the affected requirements…',
  queued: 'It will be included in a re-analysis as soon as the current run finishes.',
  skipped_no_prior_run: 'Run verification when your evidence is complete.',
  skipped_ai_not_configured: 'It was not analysed: production AI is not configured.',
};

/**
 * One evidence upload with progress, a toast for the outcome, and a retry of the same
 * file after a failure. `onUploaded` runs after a successful upload.
 */
export function useEvidenceUpload(workOrderId: string, onUploaded: () => void) {
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const last = useRef<UploadInput | null>(null);
  const toast = useToast();

  const start = useCallback(
    async (input: UploadInput) => {
      last.current = input;
      const fileName = input.file.name;
      setState({ phase: 'uploading', fileName, progress: 0 });
      try {
        const result = await api.uploadEvidence(workOrderId, input, (progress) =>
          setState({ phase: 'uploading', fileName, progress }),
        );
        const message = OUTCOME_MESSAGE[result.reanalysis];
        setState({ phase: 'done', fileName, message });
        toast.success(`Uploaded ${fileName}. ${message}`);
        onUploaded();
        return true;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Upload failed';
        setState({ phase: 'failed', fileName, error });
        toast.error(`Upload of ${fileName} failed: ${error}`);
        return false;
      }
    },
    [workOrderId, onUploaded, toast],
  );

  const retry = useCallback(() => (last.current ? start(last.current) : Promise.resolve(false)), [start]);
  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, start, retry, reset };
}
