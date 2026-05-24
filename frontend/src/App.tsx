import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute, RoleRoute } from './components/ProtectedRoute';
import { CatalogPage } from './pages/CatalogPage';
import { LoginPage } from './pages/LoginPage';
import { OrdersPage } from './pages/OrdersPage';
import { OperationsPage } from './pages/OperationsPage';
import { ProductsPage } from './pages/ProductsPage';
import { PublicCatalogPage } from './pages/PublicCatalogPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { AUTH_EXPIRED_EVENT } from './services/api';
import { useAppDispatch, useAppSelector } from './store';
import { logout, validateSession } from './store/authSlice';

export default function App() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const token = useAppSelector((state) => state.auth.token);
  const authStatus = useAppSelector((state) => state.auth.status);

  useEffect(() => {
    if (token && authStatus === 'checking') {
      void dispatch(validateSession());
    }
  }, [authStatus, dispatch, token]);

  useEffect(() => {
    const handleAuthExpired = () => {
      dispatch(logout());
      navigate('/login', { replace: true });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [dispatch, navigate]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/public" element={<PublicCatalogPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route
            path="/reports"
            element={
              <RoleRoute roles={['ADMIN']}>
                <ReportsPage />
              </RoleRoute>
            }
          />
          <Route path="/" element={<Navigate to="/products" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/products" replace />} />
    </Routes>
  );
}
