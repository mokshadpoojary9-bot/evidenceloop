import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireAuth } from './auth';
import { AppShell } from './components/AppShell';
import { Landing } from './components/Landing';
import { Login } from './components/Login';
import { WorkOrderDetail } from './components/WorkOrderDetail';
import { WorkOrderForm } from './components/WorkOrderForm';
import { WorkOrderList } from './components/WorkOrderList';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Landing />} />
            <Route path="login" element={<Login />} />
            <Route path="work-orders" element={<RequireAuth><WorkOrderList /></RequireAuth>} />
            <Route path="work-orders/new" element={<RequireAuth><WorkOrderForm /></RequireAuth>} />
            <Route path="work-orders/:id" element={<RequireAuth><WorkOrderDetail /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
