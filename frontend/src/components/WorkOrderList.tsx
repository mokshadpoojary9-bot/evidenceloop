import { motion } from 'framer-motion';
import { ClipboardList, MapPin, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useSystem } from '../hooks';
import type { WorkOrderSummary } from '../types';
import { REQUIREMENT_STATUS, WORK_ORDER_STATUS, formatDate } from './labels';
import { StatusBadge } from './StatusBadge';
import { AiBanner } from './SystemStatus';

export function WorkOrderList() {
  const { system } = useSystem();
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listWorkOrders().then(setWorkOrders, (err: Error) => setError(err.message));
  }, []);

  return (
    <div className="space-y-5">
      <AiBanner system={system} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">Work orders</h1>
        <Link to="/work-orders/new" className="btn btn-primary">
          <Plus className="size-4" aria-hidden /> New work order
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {workOrders === null && !error && <p className="py-10 text-center text-slate-400">Loading…</p>}

      {workOrders?.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <ClipboardList className="size-10 text-slate-500" aria-hidden />
          <p className="text-lg font-semibold text-white">No work orders yet</p>
          <p className="max-w-md text-sm text-slate-400">
            Start with the demo scenario — “Replace emergency light in Room 204” — and see which requirements the
            evidence actually proves.
          </p>
          <Link to="/work-orders/new" className="btn btn-primary mt-2">
            <Plus className="size-4" aria-hidden /> Create the demo work order
          </Link>
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {workOrders?.map((workOrder, index) => (
          <motion.li
            key={workOrder.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.04, 0.3) }}
          >
            <Link
              to={`/work-orders/${workOrder.id}`}
              className="card block p-4 transition-colors hover:border-slate-500"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-semibold text-white">{workOrder.title}</h2>
                <StatusBadge
                  meta={WORK_ORDER_STATUS[workOrder.status]}
                  simulated={workOrder.simulated && workOrder.status !== 'AWAITING_EVIDENCE'}
                />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                {workOrder.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden /> {workOrder.location}
                  </span>
                )}
                <span>{formatDate(workOrder.createdAt)}</span>
                {workOrder.openRequestCount > 0 && (
                  <span className="text-amber-300">
                    {workOrder.openRequestCount} evidence request{workOrder.openRequestCount === 1 ? '' : 's'} open
                  </span>
                )}
              </p>
              <div
                className="mt-3 flex gap-1.5"
                aria-label={`${workOrder.requirementStatuses.filter((s) => s === 'PROVEN').length} of ${workOrder.requirementStatuses.length} requirements proven`}
              >
                {workOrder.requirementStatuses.map((status, i) => (
                  <span
                    key={i}
                    className="h-1.5 flex-1 rounded-full"
                    style={{ backgroundColor: REQUIREMENT_STATUS[status].hex }}
                    title={`Requirement ${i + 1}: ${REQUIREMENT_STATUS[status].label}`}
                  />
                ))}
              </div>
            </Link>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
