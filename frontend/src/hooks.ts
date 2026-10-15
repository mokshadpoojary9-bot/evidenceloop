import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { supabase } from './lib/supabase';
import type { SystemStatus, WorkOrderDetail } from './types';

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

const POLL_MS = 1000;

/**
 * Loads a work order and keeps it current while the agent works: Supabase
 * Realtime when configured, plus polling for as long as a run is in flight.
 */
export function useWorkOrder(id: string) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await api.getWorkOrder(id);
      if (ticket === latest.current) {
        setDetail(next);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    void refresh();
  }, [refresh]);

  const analyzing =
    detail?.workOrder.status === 'ANALYZING' ||
    detail?.runs.some((run) => run.status === 'RUNNING') === true;

  useEffect(() => {
    if (!analyzing) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [analyzing, refresh]);

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
