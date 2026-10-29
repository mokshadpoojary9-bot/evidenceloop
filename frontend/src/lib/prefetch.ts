import { api } from '../api';
import { prefetchCached } from './cache';

// Cache keys shared by the pages and the prefetch.
export const CACHE_KEYS = {
  dashboard: 'dashboard',
  workOrders: 'work-orders',
  reviewQueue: 'review-queue',
  workOrder: (id: string) => `work-order:${id}`,
} as const;

/**
 * Right after sign-in: load the landing page's code and data for this role while the
 * redirect happens, so the dashboard (or the review queue) appears already filled in.
 */
export function prefetchHome() {
  void api.me().then(
    (viewer) => {
      if (viewer.role === 'reviewer') {
        void import('../components/ReviewQueue');
        prefetchCached(CACHE_KEYS.reviewQueue, api.reviewQueue);
      } else {
        void import('../components/Dashboard');
        prefetchCached(CACHE_KEYS.dashboard, api.dashboard);
      }
    },
    () => {},
  );
}
