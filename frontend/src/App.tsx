import { MotionConfig } from 'framer-motion';
import { lazy, type ComponentType } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireAuth } from './auth';
import { AppLayout, PublicLayout } from './components/AppShell';
import { Landing } from './components/Landing';
import { Login } from './components/Login';
import { ReviewerOnly, RoleHome } from './components/RoleRoutes';
import { WakingBanner } from './components/SystemStatus';
import { ToastProvider } from './components/ui';
import { ViewerProvider } from './viewer';

// Pages load on demand, so the first visit downloads only the shell and the page it opens.
// The layouts show a skeleton while a page's code arrives. The landing and sign-in pages
// stay in the main bundle: they are where most visits start.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));

const AuditLog = page(() => import('./components/AuditLog'), 'AuditLog');
const AuthCallback = page(() => import('./components/AuthCallback'), 'AuthCallback');
const Dashboard = page(() => import('./components/Dashboard'), 'Dashboard');
const PrivacyPage = page(() => import('./components/Legal'), 'PrivacyPage');
const TermsPage = page(() => import('./components/Legal'), 'TermsPage');
const ReviewQueue = page(() => import('./components/ReviewQueue'), 'ReviewQueue');
const WorkOrderDetail = page(() => import('./components/WorkOrderDetail'), 'WorkOrderDetail');
const WorkOrderForm = page(() => import('./components/WorkOrderForm'), 'WorkOrderForm');
const WorkOrderList = page(() => import('./components/WorkOrderList'), 'WorkOrderList');

export function App() {
  return (
    <AuthProvider>
      <ViewerProvider>
        <BrowserRouter>
          {/* Animations honour prefers-reduced-motion everywhere. */}
          <MotionConfig reducedMotion="user">
            <ToastProvider>
              <WakingBanner />
              <Routes>
                <Route element={<PublicLayout />}>
                  <Route index element={<Landing />} />
                  <Route path="login" element={<Login />} />
                  <Route path="auth/callback" element={<AuthCallback />} />
                  <Route path="privacy" element={<PrivacyPage />} />
                  <Route path="terms" element={<TermsPage />} />
                </Route>
                <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                  <Route path="home" element={<RoleHome />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="review" element={<ReviewerOnly><ReviewQueue /></ReviewerOnly>} />
                  <Route path="audit" element={<ReviewerOnly><AuditLog /></ReviewerOnly>} />
                  <Route path="work-orders" element={<WorkOrderList />} />
                  <Route path="work-orders/new" element={<WorkOrderForm />} />
                  <Route path="work-orders/:id" element={<WorkOrderDetail />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ToastProvider>
          </MotionConfig>
        </BrowserRouter>
      </ViewerProvider>
    </AuthProvider>
  );
}
