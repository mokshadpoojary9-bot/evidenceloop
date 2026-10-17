import type { WorkOrderStatus, WorkOrderSummary } from '../types';

/** `active` = every non-archived work order; a status shows non-archived ones in that status. */
export type StatusFilter = 'active' | 'archived' | 'all' | WorkOrderStatus;
export type SortOrder = 'newest' | 'oldest' | 'updated';

export interface WorkOrderQuery {
  search: string;
  status: StatusFilter;
  sort: SortOrder;
}

export const DEFAULT_QUERY: WorkOrderQuery = { search: '', status: 'active', sort: 'newest' };

export function queryWorkOrders(workOrders: WorkOrderSummary[], query: WorkOrderQuery): WorkOrderSummary[] {
  const terms = query.search.toLowerCase().split(/\s+/).filter(Boolean);

  const matches = workOrders.filter((workOrder) => {
    const archived = workOrder.archivedAt !== null;
    if (query.status === 'archived' && !archived) return false;
    if (query.status !== 'archived' && query.status !== 'all' && archived) return false;
    if (query.status !== 'active' && query.status !== 'archived' && query.status !== 'all' && workOrder.status !== query.status) {
      return false;
    }
    const haystack = `${workOrder.title} ${workOrder.location} ${workOrder.description}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  const key = query.sort === 'updated' ? 'updatedAt' : 'createdAt';
  const direction = query.sort === 'oldest' ? 1 : -1;
  return matches.sort((a, b) => (a[key] < b[key] ? -direction : a[key] > b[key] ? direction : 0));
}
