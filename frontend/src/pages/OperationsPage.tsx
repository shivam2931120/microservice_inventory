import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  Bell,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileUp,
  KeyRound,
  QrCode,
  ShieldCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { Toast } from '../components/Toast';
import {
  auditLogsApi,
  extractApiError,
  notificationsApi,
  productsApi,
  purchaseOrdersApi,
  stockMovementsApi,
  usersApi,
  warehousesApi,
} from '../services/api';
import { useAppSelector } from '../store';
import type {
  AuditLog,
  Product,
  PurchaseOrder,
  StockMovement,
  User,
  Warehouse,
  WorkspaceNotification,
} from '../types/api';
import { formatCurrency } from '../utils/currency';

type RoleValue = 'ADMIN' | 'STAFF';

export function OperationsPage() {
  const canManage = useAppSelector((state) => state.auth.user?.role === 'ADMIN');
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' }>();
  const [warehouseForm, setWarehouseForm] = useState({ name: '', region: 'India', address: '' });
  const [poForm, setPoForm] = useState({
    supplierName: '',
    supplierEmail: '',
    productId: '',
    quantity: 10,
    unitCost: 0,
  });
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    role: 'STAFF' as RoleValue,
  });
  const [importCsv, setImportCsv] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? products[0],
    [products, selectedProductId],
  );

  async function load() {
    setLoading(true);
    try {
      const [
        productData,
        warehouseData,
        movementData,
        poData,
        notificationData,
        auditData,
        userData,
      ] = await Promise.all([
        productsApi.list({ limit: 100, sortBy: 'updatedAt', sortDir: 'desc' }),
        warehousesApi.list(),
        stockMovementsApi.list({ limit: 12 }),
        purchaseOrdersApi.list({ limit: 12 }),
        notificationsApi.list({ limit: 12 }),
        canManage ? auditLogsApi.list({ limit: 12 }) : Promise.resolve({ logs: [] }),
        canManage ? usersApi.list() : Promise.resolve({ users: [] }),
      ]);
      setProducts(productData.products);
      setWarehouses(warehouseData.warehouses);
      setMovements(movementData.movements);
      setPurchaseOrders(poData.purchaseOrders);
      setNotifications(notificationData.notifications);
      setAuditLogs(auditData.logs);
      setUsers(userData.users);
      if (!selectedProductId && productData.products[0])
        setSelectedProductId(productData.products[0].id);
      if (!poForm.productId && productData.products[0]) {
        setPoForm((current) => ({ ...current, productId: productData.products[0].id }));
      }
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canManage]);

  async function createWarehouse() {
    if (!warehouseForm.name.trim()) return;
    try {
      await warehousesApi.create(warehouseForm);
      setWarehouseForm({ name: '', region: 'India', address: '' });
      setToast({ message: 'Warehouse saved.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function createPurchaseOrder() {
    if (!poForm.supplierName.trim() || !poForm.productId) return;
    try {
      await purchaseOrdersApi.create({
        supplierName: poForm.supplierName,
        supplierEmail: poForm.supplierEmail || undefined,
        items: [
          {
            productId: poForm.productId,
            quantity: poForm.quantity,
            unitCost: poForm.unitCost,
          },
        ],
      });
      setPoForm((current) => ({ ...current, supplierName: '', supplierEmail: '' }));
      setToast({ message: 'Purchase order created.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function receivePurchaseOrder(id: string) {
    try {
      await purchaseOrdersApi.receive(id);
      setToast({ message: 'Purchase order received and stock increased.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function cancelPurchaseOrder(id: string) {
    try {
      await purchaseOrdersApi.cancel(id);
      setToast({ message: 'Purchase order cancelled.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function createUser() {
    if (!userForm.username.trim() || userForm.password.length < 8) return;
    try {
      await usersApi.create(userForm);
      setUserForm({ username: '', password: '', role: 'STAFF' });
      setToast({ message: 'User created.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function updateUser(user: User, payload: { role?: RoleValue; disabled?: boolean }) {
    if (!user.id) return;
    try {
      await usersApi.update(user.id, payload);
      setToast({ message: 'User updated.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function exportProducts() {
    try {
      const data = await productsApi.exportCsv();
      downloadText(data.filename, data.csv, 'text/csv;charset=utf-8');
      setToast({ message: `Exported ${data.count} products.`, tone: 'success' });
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function importProducts() {
    try {
      const data = await productsApi.importCsv(importCsv);
      setImportCsv('');
      setToast({ message: `Imported ${data.imported} products.`, tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function markNotificationsRead() {
    try {
      await notificationsApi.markAllRead();
      setToast({ message: 'Notifications marked read.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
            Operations
          </h2>
          <p className="mt-1 text-on-surface-variant">
            Stock ledger, purchasing, warehouses, notifications, imports, codes, audit, and users.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface transition hover:border-primary hover:text-primary"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container p-10 text-center text-on-surface-variant">
          Loading operational controls...
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={Activity} label="Ledger Events" value={String(movements.length)} />
            <SummaryCard
              icon={ClipboardCheck}
              label="Purchase Orders"
              value={String(purchaseOrders.length)}
            />
            <SummaryCard icon={Building2} label="Warehouses" value={String(warehouses.length)} />
            <SummaryCard
              icon={Bell}
              label="Unread Alerts"
              value={String(notifications.filter((item) => !item.readAt).length)}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel title="Purchase Orders" icon={ClipboardCheck}>
              {canManage && (
                <div className="mb-4 grid gap-3 rounded-xl border border-outline-variant bg-surface p-4 md:grid-cols-5">
                  <input
                    className="form-input md:col-span-1"
                    placeholder="Supplier"
                    value={poForm.supplierName}
                    onChange={(event) => setPoForm({ ...poForm, supplierName: event.target.value })}
                  />
                  <input
                    className="form-input md:col-span-1"
                    placeholder="supplier@email.com"
                    value={poForm.supplierEmail}
                    onChange={(event) =>
                      setPoForm({ ...poForm, supplierEmail: event.target.value })
                    }
                  />
                  <select
                    className="form-input md:col-span-1"
                    value={poForm.productId}
                    onChange={(event) => setPoForm({ ...poForm, productId: event.target.value })}
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-input"
                    min={1}
                    type="number"
                    value={poForm.quantity}
                    onChange={(event) =>
                      setPoForm({ ...poForm, quantity: Number(event.target.value) })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => void createPurchaseOrder()}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                  >
                    Create PO
                  </button>
                </div>
              )}
              <DataTable
                empty="No purchase orders yet."
                headers={['Supplier', 'Items', 'Status', 'Created', 'Actions']}
                rows={purchaseOrders.map((order) => [
                  order.supplierName,
                  `${order.items.length} lines · ${formatCurrency(order.items.reduce((sum, item) => sum + item.lineTotal, 0))}`,
                  order.status,
                  new Date(order.createdAt).toLocaleDateString(),
                  canManage && order.status === 'SENT' ? (
                    <div className="flex gap-2" key={order.id}>
                      <IconButton
                        label="Receive"
                        icon={CheckCircle2}
                        onClick={() => void receivePurchaseOrder(order.id)}
                      />
                      <IconButton
                        label="Cancel"
                        icon={XCircle}
                        onClick={() => void cancelPurchaseOrder(order.id)}
                      />
                    </div>
                  ) : (
                    'No action'
                  ),
                ])}
              />
            </Panel>

            <Panel title="Warehouses" icon={Building2}>
              {canManage && (
                <div className="mb-4 grid gap-3 rounded-xl border border-outline-variant bg-surface p-4">
                  <input
                    className="form-input"
                    placeholder="Warehouse name"
                    value={warehouseForm.name}
                    onChange={(event) =>
                      setWarehouseForm({ ...warehouseForm, name: event.target.value })
                    }
                  />
                  <input
                    className="form-input"
                    placeholder="Region"
                    value={warehouseForm.region}
                    onChange={(event) =>
                      setWarehouseForm({ ...warehouseForm, region: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => void createWarehouse()}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                  >
                    Save Warehouse
                  </button>
                </div>
              )}
              <div className="grid gap-3">
                {warehouses.map((warehouse) => (
                  <div
                    key={warehouse.id}
                    className="rounded-xl border border-outline-variant bg-surface p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-on-surface">{warehouse.name}</p>
                        <p className="text-sm text-on-surface-variant">
                          {warehouse.region || 'No region'}
                        </p>
                      </div>
                      <p className="text-right text-sm font-bold text-primary">
                        {warehouse.totalStock} units
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-on-surface-variant">
                      {warehouse.skuCount} SKUs assigned
                    </p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Stock Movement Ledger" icon={Activity}>
              <DataTable
                empty="No stock movements yet."
                headers={['Product', 'Type', 'Delta', 'Balance', 'When']}
                rows={movements.map((movement) => [
                  movement.productName || movement.productId.slice(0, 8),
                  movement.type.replace(/_/g, ' '),
                  movement.delta > 0 ? `+${movement.delta}` : String(movement.delta),
                  `${movement.balanceAfter} units`,
                  new Date(movement.createdAt).toLocaleString(),
                ])}
              />
            </Panel>

            <Panel title="Notifications" icon={Bell}>
              <button
                type="button"
                onClick={() => void markNotificationsRead()}
                className="mb-4 rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold text-on-surface-variant transition hover:border-primary hover:text-primary"
              >
                Mark all read
              </button>
              <div className="grid gap-3">
                {notifications.length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No notifications yet.</p>
                ) : (
                  notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className="rounded-xl border border-outline-variant bg-surface p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold text-on-surface">{notification.title}</p>
                        {!notification.readAt && (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-on-surface-variant">{notification.message}</p>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Bulk Import / Export" icon={FileUp}>
              <div className="grid gap-3">
                <textarea
                  value={importCsv}
                  onChange={(event) => setImportCsv(event.target.value)}
                  className="min-h-36 rounded-lg border border-outline-variant bg-surface p-3 text-sm text-on-surface outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  placeholder="name,category,price,stockLevel,reorderThreshold,description,imageUrl"
                />
                <div className="flex flex-wrap gap-3">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void importProducts()}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                    >
                      <FileUp size={16} /> Import CSV
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void exportProducts()}
                    className="inline-flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 text-sm font-bold text-on-surface"
                  >
                    <Download size={16} /> Export CSV
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="Barcode / QR Codes" icon={QrCode}>
              <select
                className="form-input mb-4"
                value={selectedProduct?.id ?? ''}
                onChange={(event) => setSelectedProductId(event.target.value)}
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
              {selectedProduct ? (
                <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                  <QrMatrix value={selectedProduct.id} />
                  <div>
                    <p className="text-lg font-semibold text-on-surface">{selectedProduct.name}</p>
                    <p className="font-mono text-sm text-on-surface-variant">
                      {selectedProduct.sku}
                    </p>
                    <Barcode value={selectedProduct.sku ?? selectedProduct.id.slice(0, 12)} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-on-surface-variant">
                  Create a product to generate codes.
                </p>
              )}
            </Panel>
          </div>

          {canManage && (
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel title="User Management" icon={UserPlus}>
                <div className="mb-4 grid gap-3 rounded-xl border border-outline-variant bg-surface p-4 md:grid-cols-4">
                  <input
                    className="form-input"
                    placeholder="Username"
                    value={userForm.username}
                    onChange={(event) => setUserForm({ ...userForm, username: event.target.value })}
                  />
                  <input
                    className="form-input"
                    placeholder="Password"
                    type="password"
                    value={userForm.password}
                    onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                  />
                  <select
                    className="form-input"
                    value={userForm.role}
                    onChange={(event) =>
                      setUserForm({ ...userForm, role: event.target.value as RoleValue })
                    }
                  >
                    <option value="STAFF">Staff</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void createUser()}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary"
                  >
                    Create User
                  </button>
                </div>
                <DataTable
                  empty="No users found."
                  headers={['Username', 'Role', 'Status', 'Actions']}
                  rows={users.map((user) => [
                    user.username,
                    user.role,
                    user.disabledAt ? 'Disabled' : 'Active',
                    <div className="flex gap-2" key={user.id ?? user.username}>
                      <IconButton
                        label="Toggle role"
                        icon={ShieldCheck}
                        onClick={() =>
                          void updateUser(user, { role: user.role === 'ADMIN' ? 'STAFF' : 'ADMIN' })
                        }
                      />
                      <IconButton
                        label={user.disabledAt ? 'Enable' : 'Disable'}
                        icon={KeyRound}
                        onClick={() => void updateUser(user, { disabled: !user.disabledAt })}
                      />
                    </div>,
                  ])}
                />
              </Panel>

              <Panel title="Audit Logs" icon={ShieldCheck}>
                <DataTable
                  empty="No audit activity yet."
                  headers={['Actor', 'Action', 'Entity', 'When']}
                  rows={auditLogs.map((log) => [
                    log.actorUsername || 'system',
                    log.action.replace(/_/g, ' '),
                    `${log.entityType}${log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ''}`,
                    new Date(log.createdAt).toLocaleString(),
                  ])}
                />
              </Panel>
            </div>
          )}
        </>
      )}

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(undefined)} />
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container p-5 shadow-panel">
      <Icon className="text-primary" size={22} />
      <p className="mt-4 text-sm font-semibold text-on-surface-variant">{label}</p>
      <p className="mt-1 text-2xl font-bold text-on-surface">{value}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Activity;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-outline-variant bg-surface-container p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon size={19} />
        </span>
        <h3 className="text-xl font-semibold text-on-surface">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  empty: string;
}) {
  return (
    <div className="app-scrollbar overflow-x-auto rounded-xl border border-outline-variant">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface-container-low text-xs font-bold uppercase tracking-wide text-on-surface-variant">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slateLine bg-surface">
          {rows.length === 0 ? (
            <tr>
              <td
                className="px-4 py-8 text-center text-on-surface-variant"
                colSpan={headers.length}
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index} className="transition hover:bg-surface-container-high">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-3 text-on-surface-variant">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof CheckCircle2;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-high hover:text-primary"
      aria-label={label}
      title={label}
    >
      <Icon size={16} />
    </button>
  );
}

function QrMatrix({ value }: { value: string }) {
  const cells = Array.from({ length: 121 }, (_, index) => {
    const code = value.charCodeAt(index % value.length) || index;
    return (code + index * 17) % 5 < 2;
  });
  return (
    <div className="grid h-40 w-40 grid-cols-11 gap-0.5 rounded-xl border border-outline-variant bg-white p-3">
      {cells.map((filled, index) => (
        <span key={index} className={filled ? 'bg-[#10251c]' : 'bg-white'} />
      ))}
    </div>
  );
}

function Barcode({ value }: { value: string }) {
  return (
    <div className="mt-5 flex h-16 items-end gap-0.5 rounded-lg bg-white p-3">
      {value.split('').map((char, index) => (
        <span
          key={`${char}-${index}`}
          className="w-1 bg-[#10251c]"
          style={{ height: `${22 + (char.charCodeAt(0) % 28)}px` }}
        />
      ))}
    </div>
  );
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
