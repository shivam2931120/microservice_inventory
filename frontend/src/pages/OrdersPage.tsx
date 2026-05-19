import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Eye, Package, Plus, ShoppingCart, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { OrderForm } from '../components/OrderForm';
import { StatusBadge } from '../components/StatusBadge';
import { Toast } from '../components/Toast';
import { extractApiError, ordersApi, productsApi } from '../services/api';
import type { Order, OrderStatus, Product } from '../types/api';
import { formatCurrency } from '../utils/currency';

const statuses: Array<'' | OrderStatus> = [
  '',
  'PENDING',
  'PROCESSING',
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'SHIPPED',
];
export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const createRequested = searchParams.get('new') === '1';
  const [orders, setOrders] = useState<Order[]>([]);
  const [snapshot, setSnapshot] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<'' | OrderStatus>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' }>();

  const clearCreateIntent = useCallback(() => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const revenue = snapshot.reduce((sum, order) => sum + order.total, 0);
  const pending = snapshot.filter((order) => ['PENDING', 'PROCESSING'].includes(order.status)).length;
  const cancelled = snapshot.filter((order) => order.status === 'CANCELLED' || order.status === 'FAILED').length;

  async function load(nextPage = page) {
    setLoading(true);
    try {
      const [ordersData, snapshotData, productsData] = await Promise.all([
        ordersApi.list({ status: status || undefined, page: nextPage, limit: 10 }),
        ordersApi.list({ limit: 100 }),
        productsApi.list({ limit: 100 }),
      ]);
      setOrders(ordersData.orders);
      setSnapshot(snapshotData.orders);
      setProducts(productsData.products);
      setTotal(ordersData.total);
      setTotalPages(Math.max(1, ordersData.totalPages));
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const nextPage = 1;
    setPage(nextPage);
    void load(nextPage);
  }, [status]);

  useEffect(() => {
    if (createRequested) setCreating(true);
  }, [createRequested]);

  async function createOrder(payload: {
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    items: Array<{ productId: string; quantity: number }>;
  }) {
    try {
      await ordersApi.create(payload);
      setCreating(false);
      clearCreateIntent();
      setToast({ message: 'Order submitted to inventory saga.', tone: 'success' });
      await load();
      window.setTimeout(() => void load(), 900);
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function changeStatus(order: Order, nextStatus: OrderStatus) {
    if (order.status === nextStatus) return;
    try {
      const updated = await ordersApi.updateStatus(order.id, nextStatus);
      setSelected(updated);
      setToast({ message: 'Order status updated.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function goToPage(nextPage: number) {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    setPage(safePage);
    await load(safePage);
  }

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">Orders</h2>
          <p className="mt-1 text-on-surface-variant">View GST-ready Indian buyer orders and dispatch workflows.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition hover:bg-primaryHover active:scale-[0.99] sm:w-auto"
        >
          <Plus size={18} />
          New Order
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={ShoppingCart} label="Total Orders" value={String(snapshot.length || total)} helper="+ live records" tone="success" />
        <StatCard icon={Package} label="Pending" value={String(pending)} helper="Needs attention" tone="warning" />
        <StatCard icon={TrendingUp} label="Revenue" value={formatCurrency(revenue)} helper="Loaded orders" tone="success" />
        <StatCard icon={TrendingDown} label="Failed/Cancelled" value={String(cancelled)} helper="Review workflow" tone="danger" />
      </div>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-outline-variant bg-surface-container shadow-panel">
        <div className="flex flex-col gap-4 border-b border-outline-variant bg-surface-container-high px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="app-scrollbar flex gap-2 overflow-x-auto">
            {statuses.map((item) => (
              <button
                key={item || 'ALL'}
                onClick={() => setStatus(item)}
                className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  status === item ? 'bg-primary text-on-primary' : 'border border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {item || 'All Orders'}
              </button>
            ))}
          </div>
          <span className="text-sm text-on-surface-variant">
            Showing {orders.length} of {total} orders
          </span>
        </div>

        <div className="app-scrollbar overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead className="bg-surface-container-low text-xs font-bold uppercase tracking-wide text-on-surface-variant">
              <tr>
                <th className="px-6 py-4">Order ID</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Buyer Name</th>
                <th className="px-6 py-4">Total Amount</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slateLine">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-on-surface-variant">
                    Loading orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-14 text-center text-on-surface-variant">
                    No orders found.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="bg-surface-container transition hover:bg-surface-container-high">
                    <td className="px-6 py-4 font-mono text-sm font-bold text-primary">#{order.id.slice(0, 8).toUpperCase()}</td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{new Date(order.createdAt).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-on-surface">{order.customerName}</p>
                      <p className="text-sm text-on-surface-variant">{order.customerEmail || 'No email'}</p>
                    </td>
                    <td className="px-6 py-4 font-bold text-on-surface">{formatCurrency(order.total)}</td>
                    <td className="px-6 py-4 text-center">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelected(order)}
                        className="inline-flex items-center gap-2 rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
                        aria-label={`View order ${order.id}`}
                      >
                        <Eye size={18} />
                        <span className="sr-only">View</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-outline-variant bg-surface-container-low px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-on-surface-variant">
            Page {page} of {totalPages}
          </span>
          <div className="flex flex-wrap gap-2">
            <button disabled={page <= 1} onClick={() => void goToPage(page - 1)} className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages} onClick={() => void goToPage(page + 1)} className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      </div>

      <RecentActivity orders={snapshot.slice(0, 3)} />

      {creating && (
        <OrderForm
          products={products}
          onCancel={() => {
            setCreating(false);
            clearCreateIntent();
          }}
          onSubmit={createOrder}
        />
      )}
      {selected && (
        <OrderDetailModal
          order={selected}
          onClose={() => setSelected(null)}
          onStatusChange={(nextStatus) => void changeStatus(selected, nextStatus)}
        />
      )}
      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(undefined)} />
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: typeof ShoppingCart;
  label: string;
  value: string;
  helper: string;
  tone: 'success' | 'warning' | 'danger';
}) {
  const styles = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warningSoft text-warning',
    danger: 'bg-danger/10 text-danger',
  }[tone];

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container p-5 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{label}</span>
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${styles}`}>
          <Icon size={19} />
        </span>
      </div>
      <p className="break-words text-2xl font-semibold text-on-surface">{value}</p>
      <p className={`mt-1 text-sm ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-success'}`}>
        {helper}
      </p>
    </div>
  );
}

function RecentActivity({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return null;

  return (
    <section>
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wide text-on-surface-variant">Recent Order Activity</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {orders.map((order) => (
          <div key={order.id} className="flex items-start gap-4 rounded-xl border border-dashed border-outline-variant bg-surface-container p-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <CalendarDays size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-on-surface">
                <span className="font-bold">#{order.id.slice(0, 8).toUpperCase()}</span> is{' '}
                <span className="font-semibold text-primary">{order.status.toLowerCase()}</span>
              </p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                {new Date(order.updatedAt).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OrderDetailModal({
  order,
  onClose,
  onStatusChange,
}: {
  order: Order;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => void;
}) {
  const subtotal = useMemo(() => order.items.reduce((sum, item) => sum + item.lineTotal, 0), [order.items]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container shadow-elevated">
        <header className="flex items-center justify-between gap-4 border-b border-outline-variant bg-surface-container-high px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="order-detail-title" className="text-2xl font-semibold text-on-surface">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </h2>
            <StatusBadge status={order.status} />
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-high" aria-label="Close order detail">
            <X size={20} />
          </button>
        </header>

        <div className="app-scrollbar overflow-y-auto p-6">
          <div className="grid gap-6">
            <section className="flex flex-col gap-4 rounded-lg border border-outline-variant bg-surface p-4 lg:flex-row lg:items-start lg:justify-between">
              <label className="grid gap-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                Update Order Status
                <select
                  value={order.status}
                  onChange={(event) => onStatusChange(event.target.value as OrderStatus)}
                  className="w-56 rounded-lg border border-outline-variant bg-surface-container px-4 py-2 text-sm font-normal normal-case tracking-normal text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                >
                  {statuses.filter(Boolean).map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              {order.failureReason && (
                <div className="flex flex-1 items-start gap-3 rounded-lg border border-danger/20 bg-dangerSoft/40 p-4">
                  <X className="mt-0.5 text-danger" size={20} />
                  <div>
                    <p className="text-sm font-bold text-danger">Failure Reason</p>
                    <p className="mt-1 text-sm text-danger">{order.failureReason}</p>
                  </div>
                </div>
              )}
            </section>

            <section className="grid gap-6 md:grid-cols-2">
              <InfoCard title="Customer Details" rows={[
                ['Name', order.customerName],
                ['Email', order.customerEmail || 'Not provided'],
                ['Shipping', order.customerAddress || 'Not provided'],
              ]} />
              <InfoCard title="Order Information" rows={[
                ['Order Date', new Date(order.createdAt).toLocaleString()],
                ['Last Updated', new Date(order.updatedAt).toLocaleString()],
                ['Items', String(order.items.length)],
              ]} />
            </section>

            <section className="overflow-hidden rounded-xl border border-outline-variant bg-surface">
              <div className="border-b border-outline-variant bg-surface-container-low px-5 py-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-on-surface-variant">Itemized List</h3>
              </div>
              <div className="app-scrollbar overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="bg-surface text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-5 py-3">Product</th>
                      <th className="px-5 py-3 text-center">Product ID</th>
                      <th className="px-5 py-3 text-center">Quantity</th>
                      <th className="px-5 py-3 text-right">Unit Price</th>
                      <th className="px-5 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slateLine">
                    {order.items.map((item) => (
                      <tr key={item.id} className="bg-surface transition hover:bg-surface-container-low">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="grid h-10 w-10 place-items-center rounded bg-surface-container-high text-on-surface-variant">
                              <Package size={18} />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-on-surface">{item.productName || item.productId}</p>
                              <p className="text-xs text-on-surface-variant">Order item</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center font-mono text-xs text-on-surface-variant">{item.productId.slice(0, 8)}</td>
                        <td className="px-5 py-4 text-center text-sm text-on-surface">{item.quantity}</td>
                        <td className="px-5 py-4 text-right text-sm text-on-surface">{formatCurrency(item.unitPrice)}</td>
                        <td className="px-5 py-4 text-right text-sm font-semibold text-on-surface">{formatCurrency(item.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="flex justify-end">
              <div className="w-full max-w-sm space-y-2">
                <div className="flex justify-between text-sm text-on-surface-variant">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between border-t border-outline-variant pt-4">
                  <span className="text-xl font-semibold text-on-surface">Total</span>
                  <span className="text-xl font-semibold text-primary">{formatCurrency(order.total)}</span>
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-outline-variant bg-surface-container-high px-6 py-5 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => window.print()} className="rounded-lg border border-outline-variant bg-surface px-5 py-2.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high">
            Print Order
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-on-primary transition hover:bg-primaryHover">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function InfoCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface p-5">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-primary">{title}</h3>
      <dl className="grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <dt className="text-on-surface-variant">{label}</dt>
            <dd className="max-w-[65%] break-words text-right font-medium text-on-surface">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
