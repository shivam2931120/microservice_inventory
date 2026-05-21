import axios from 'axios';
import type {
  InventoryReport,
  Order,
  OrderListResponse,
  Product,
  ProductListResponse,
  SalesReport,
  StockAlertReport,
  User,
} from '../types/api';

export const AUTH_EXPIRED_EVENT = 'inventory-auth-expired';

function resolveApiBaseUrl() {
  const runtimeUrl = window.__INVENTORY_CONFIG__?.apiUrl?.trim();
  const buildUrl = import.meta.env.VITE_API_URL?.trim();
  return runtimeUrl || buildUrl || (import.meta.env.PROD ? '/api' : 'http://localhost:3000');
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 30_000,
});

function clearStoredSession() {
  localStorage.removeItem('inventory_token');
  localStorage.removeItem('inventory_user');
}

function isAuthEndpoint(url?: string) {
  return Boolean(url?.startsWith('/auth/login') || url?.startsWith('/auth/register'));
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('inventory_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !isAuthEndpoint(error.config?.url)
    ) {
      clearStoredSession();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  },
);

export interface LoginResponse {
  token: string;
  user: User;
}

export const authApi = {
  login: async (username: string, password: string) =>
    (await api.post<LoginResponse>('/auth/login', { username, password })).data,
  register: async (username: string, password: string, role: 'ADMIN' | 'STAFF') =>
    (await api.post<{ user: User }>('/auth/register', { username, password, role })).data,
  me: async () => (await api.get<{ user: User }>('/auth/me')).data,
};

export const productsApi = {
  list: async (params?: Record<string, string | number | undefined>) =>
    (await api.get<ProductListResponse>('/products', { params })).data,
  publicList: async (params?: Record<string, string | number | undefined>) =>
    (await api.get<ProductListResponse>('/public/products', { params: { limit: 100, ...params } }))
      .data,
  create: async (payload: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'version'>) =>
    (await api.post<Product>('/products', payload)).data,
  update: async (
    id: string,
    payload: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'version'>>,
  ) => (await api.put<Product>(`/products/${id}`, payload)).data,
  remove: async (id: string) => api.delete(`/products/${id}`),
  adjustStock: async (id: string, delta: number, expectedVersion?: number) =>
    (await api.put<Product>(`/inventory/${id}/stock`, { delta, expectedVersion })).data,
};

export const ordersApi = {
  list: async (params?: Record<string, string | number | undefined>) =>
    (await api.get<OrderListResponse>('/orders', { params })).data,
  create: async (payload: {
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    items: Array<{ productId: string; quantity: number }>;
  }) => (await api.post<Order>('/orders', payload)).data,
  get: async (id: string) => (await api.get<Order>(`/orders/${id}`)).data,
  updateStatus: async (id: string, status: string) =>
    (await api.put<Order>(`/orders/${id}/status`, { status })).data,
};

export const reportsApi = {
  sales: async (params?: { from?: string; to?: string }) =>
    (await api.get<SalesReport>('/reports/sales', { params })).data,
  inventory: async () => (await api.get<InventoryReport>('/reports/inventory')).data,
  stockAlerts: async () => (await api.get<StockAlertReport>('/reports/stock-alerts')).data,
};

export function extractApiError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string })?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message ?? error.message;
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

export default api;
