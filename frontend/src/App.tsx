import { MotionConfig } from 'framer-motion';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireAuth } from './auth';
import { AppLayout, PublicLayout } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import { Landing } from './components/Landing';
import { Login } from './components/Login';
import { WakingBanner } from './components/SystemStatus';
import { ToastProvider } from './components/ui';
import { WorkOrderDetail } from './components/WorkOrderDetail';
import { WorkOrderForm } from './components/WorkOrderForm';
import { WorkOrderList } from './components/WorkOrderList';
import { ViewerProvider } from './viewer';

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
                </Route>
                <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                  <Route path="dashboard" element={<Dashboard />} />
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
