import { FormEvent, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  Mail,
  MoreVertical,
  Package,
  Plus,
  Star,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import { Toast } from '../components/Toast';

type Supplier = {
  id: string;
  name: string;
  category: string;
  contact: string;
  detail: string;
  score: number;
  icon: typeof Package;
  warning: boolean;
};

type SupplierColumn = 'category' | 'contact' | 'rating';

const initialSuppliers: Supplier[] = [
  {
    id: 'SUP-IN-0014',
    name: 'Bharat Microcomponents',
    category: 'Electronics',
    contact: 'Ananya Rao',
    detail: 'ananya.rao@bharatmicro.in',
    score: 4.8,
    icon: Package,
    warning: false,
  },
  {
    id: 'SUP-IN-0082',
    name: 'Delhivery Fulfilment Services',
    category: 'Pan-India Logistics',
    contact: 'North Zone Desk',
    detail: '+91 80 4567 2834',
    score: 4.2,
    icon: Truck,
    warning: false,
  },
  {
    id: 'SUP-IN-0105',
    name: 'Udaipur Packwell Materials',
    category: 'Packaging',
    contact: 'Mehul Jain',
    detail: 'mehul@udaipurpackwell.in',
    score: 4.9,
    icon: Warehouse,
    warning: false,
  },
  {
    id: 'SUP-IN-0138',
    name: 'Jamshedpur Steel Works',
    category: 'Raw Materials',
    contact: 'Priya Menon',
    detail: 'vendor.relations@jsw-supply.in',
    score: 3.1,
    icon: AlertTriangle,
    warning: true,
  },
];

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Record<SupplierColumn, boolean>>({
    category: true,
    contact: true,
    rating: true,
  });
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' }>();

  const pendingCompliance = suppliers.filter((supplier) => supplier.warning).length;
  const topSupplier = useMemo(
    () => suppliers.reduce((best, supplier) => (supplier.score > best.score ? supplier : best), suppliers[0]),
    [suppliers],
  );

  function toggleColumn(column: SupplierColumn) {
    setVisibleColumns((current) => ({ ...current, [column]: !current[column] }));
  }

  function exportCsv() {
    const rows = [
      ['Supplier ID', 'Name', 'Category', 'Contact', 'Contact Detail', 'Reliability', 'Compliance'],
      ...suppliers.map((supplier) => [
        supplier.id,
        supplier.name,
        supplier.category,
        supplier.contact,
        supplier.detail,
        supplier.score.toFixed(1),
        supplier.warning ? 'Review required' : 'Cleared',
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'supplier-network.csv';
    link.click();
    URL.revokeObjectURL(url);
    setToast({ message: 'Supplier CSV exported.', tone: 'success' });
  }

  function copySupplierId(supplier: Supplier) {
    void navigator.clipboard.writeText(supplier.id);
    setActiveMenu(null);
    setToast({ message: `Copied ${supplier.id}.`, tone: 'success' });
  }

  function markCompliant(supplier: Supplier) {
    setSuppliers((current) =>
      current.map((item) => (item.id === supplier.id ? { ...item, warning: false } : item)),
    );
    setActiveMenu(null);
    setToast({ message: `${supplier.name} compliance cleared.`, tone: 'success' });
  }

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
            Supplier Network
          </h2>
          <p className="mt-1 text-on-surface-variant">
            Manage supplier relationships, GST readiness, and regional fulfilment coverage.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-high sm:flex-none"
          >
            <Download size={18} />
            Export
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-on-primary transition hover:bg-primaryHover sm:flex-none"
          >
            <Plus size={18} />
            Add Supplier
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Warehouse}
          label="Total Active Suppliers"
          value={String(suppliers.length)}
          helper="Tracked partners"
          tone="primary"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Pending Compliance"
          value={String(pendingCompliance)}
          helper={pendingCompliance ? 'Action required' : 'All clear'}
          tone="danger"
        />
        <div className="relative overflow-hidden rounded-2xl border border-outline-variant bg-surface-container p-5 shadow-panel transition hover:border-primary">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent" />
          <div className="relative flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
              <Star size={18} />
              Top Performing
            </span>
            <span className="text-on-surface-variant">{Math.round(topSupplier.score * 20)}/100</span>
          </div>
          <p className="relative mt-4 text-2xl font-semibold leading-tight text-on-surface">
            {topSupplier.name}
          </p>
          <p className="relative mt-1 text-sm text-on-surface-variant">{topSupplier.category}</p>
        </div>
      </div>

      <div className="min-w-0 overflow-visible rounded-2xl border border-outline-variant bg-surface-container shadow-panel">
        <div className="flex flex-col gap-3 border-b border-outline-variant bg-surface-container-high p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-on-surface">Suppliers</h3>
            <p className="text-sm text-on-surface-variant">
              Showing 1 to {suppliers.length} of {suppliers.length} entries
            </p>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnsOpen((current) => !current)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest"
              aria-expanded={columnsOpen}
            >
              <Package size={17} />
              Columns
            </button>
            {columnsOpen && (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 rounded-xl border border-outline-variant bg-surface-container p-2 shadow-elevated">
                {([
                  ['category', 'Category'],
                  ['contact', 'Primary Contact'],
                  ['rating', 'Reliability Rating'],
                ] as Array<[SupplierColumn, string]>).map(([column, label]) => (
                  <label
                    key={column}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container-high"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns[column]}
                      onChange={() => toggleColumn(column)}
                      className="rounded border-outline-variant bg-surface text-primary focus:ring-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="app-scrollbar overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-surface-container-low text-xs font-bold uppercase tracking-wide text-on-surface-variant">
              <tr>
                <th className="px-6 py-4">Supplier Details</th>
                {visibleColumns.category && <th className="px-6 py-4">Category</th>}
                {visibleColumns.contact && <th className="px-6 py-4">Primary Contact</th>}
                {visibleColumns.rating && <th className="px-6 py-4">Reliability Rating</th>}
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {suppliers.map((supplier) => {
                const Icon = supplier.icon;
                return (
                  <tr
                    key={supplier.id}
                    className="bg-surface-container transition hover:bg-surface-container-high"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`grid h-10 w-10 place-items-center rounded-lg border ${
                            supplier.warning
                              ? 'border-danger/30 bg-danger/10 text-danger'
                              : 'border-outline-variant bg-surface-variant text-on-surface-variant'
                          }`}
                        >
                          <Icon size={20} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-on-surface">
                            {supplier.name}
                          </span>
                          <span
                            className={
                              supplier.warning
                                ? 'text-xs font-semibold text-danger'
                                : 'text-xs text-on-surface-variant'
                            }
                          >
                            {supplier.warning ? 'Compliance Review' : `ID: ${supplier.id}`}
                          </span>
                        </span>
                      </div>
                    </td>
                    {visibleColumns.category && (
                      <td className="px-6 py-4">
                        <span className="rounded-md border border-outline-variant bg-secondary-container/50 px-2.5 py-1 text-xs font-semibold text-on-surface">
                          {supplier.category}
                        </span>
                      </td>
                    )}
                    {visibleColumns.contact && (
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-on-surface">{supplier.contact}</p>
                        <p className="mt-1 flex items-center gap-1 break-words text-xs text-on-surface-variant">
                          <Mail size={13} />
                          {supplier.detail}
                        </p>
                      </td>
                    )}
                    {visibleColumns.rating && (
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-2 text-on-surface">
                          <span className="inline-flex text-primary">
                            {Array.from({ length: 5 }).map((_, index) => (
                              <Star
                                key={index}
                                size={15}
                                fill={index < Math.floor(supplier.score) ? 'currentColor' : 'none'}
                              />
                            ))}
                          </span>
                          <span className="font-semibold">{supplier.score.toFixed(1)}</span>
                        </span>
                      </td>
                    )}
                    <td className="relative px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveMenu((current) => (current === supplier.id ? null : supplier.id))
                        }
                        className="rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
                        aria-label={`Open actions for ${supplier.name}`}
                        aria-expanded={activeMenu === supplier.id}
                      >
                        <MoreVertical size={18} />
                      </button>
                      {activeMenu === supplier.id && (
                        <div className="absolute right-6 top-12 z-20 w-56 overflow-hidden rounded-xl border border-outline-variant bg-surface-container text-left shadow-elevated">
                          <ActionButton
                            icon={Eye}
                            label="View profile"
                            onClick={() => {
                              setSelectedSupplier(supplier);
                              setActiveMenu(null);
                            }}
                          />
                          <ActionButton
                            icon={Copy}
                            label="Copy supplier ID"
                            onClick={() => copySupplierId(supplier)}
                          />
                          {supplier.detail.includes('@') && (
                            <ActionButton
                              icon={Mail}
                              label="Email contact"
                              onClick={() => {
                                window.location.href = `mailto:${supplier.detail}`;
                                setActiveMenu(null);
                              }}
                            />
                          )}
                          {supplier.warning && (
                            <ActionButton
                              icon={CheckCircle2}
                              label="Clear compliance"
                              onClick={() => markCompliant(supplier)}
                            />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSupplier && (
        <SupplierProfile supplier={selectedSupplier} onClose={() => setSelectedSupplier(null)} />
      )}
      {adding && (
        <AddSupplierModal
          onCancel={() => setAdding(false)}
          onAdd={(supplier) => {
            setSuppliers((current) => [supplier, ...current]);
            setAdding(false);
            setToast({ message: `${supplier.name} added.`, tone: 'success' });
          }}
        />
      )}
      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(undefined)} />
    </section>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function SupplierProfile({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="supplier-profile-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container shadow-elevated">
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface-container-high px-5 py-4">
          <div>
            <h3 id="supplier-profile-title" className="text-xl font-semibold text-on-surface">
              {supplier.name}
            </h3>
            <p className="mt-1 text-sm text-on-surface-variant">{supplier.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-highest"
            aria-label="Close supplier profile"
          >
            <X size={18} />
          </button>
        </header>
        <div className="grid gap-4 p-5">
          <ProfileRow label="Category" value={supplier.category} />
          <ProfileRow label="Primary Contact" value={supplier.contact} />
          <ProfileRow label="Contact Detail" value={supplier.detail} />
          <ProfileRow label="Reliability Rating" value={`${supplier.score.toFixed(1)} / 5.0`} />
          <ProfileRow
            label="Compliance"
            value={supplier.warning ? 'Review required' : 'Cleared'}
            danger={supplier.warning}
          />
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-outline-variant bg-surface p-3">
      <span className="text-sm text-on-surface-variant">{label}</span>
      <span className={danger ? 'text-sm font-semibold text-danger' : 'text-sm font-semibold text-on-surface'}>
        {value}
      </span>
    </div>
  );
}

function AddSupplierModal({
  onAdd,
  onCancel,
}: {
  onAdd: (supplier: Supplier) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    category: '',
    contact: '',
    detail: '',
    score: 4.0,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd({
      id: `SUP-IN-${Math.floor(1000 + Math.random() * 9000)}`,
      name: form.name,
      category: form.category,
      contact: form.contact,
      detail: form.detail,
      score: form.score,
      icon: Warehouse,
      warning: false,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-supplier-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-outline-variant bg-surface-container shadow-elevated"
      >
        <header className="flex items-center justify-between border-b border-outline-variant bg-surface-container-high px-5 py-4">
          <h3 id="add-supplier-title" className="text-xl font-semibold text-on-surface">
            Add Supplier
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-highest"
            aria-label="Close add supplier form"
          >
            <X size={18} />
          </button>
        </header>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <SupplierInput label="Supplier Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <SupplierInput label="Category" value={form.category} onChange={(category) => setForm({ ...form, category })} />
          <SupplierInput label="Primary Contact" value={form.contact} onChange={(contact) => setForm({ ...form, contact })} />
          <SupplierInput label="Email or Phone" value={form.detail} onChange={(detail) => setForm({ ...form, detail })} />
          <label className="grid gap-1.5 text-sm font-semibold text-on-surface-variant sm:col-span-2">
            Reliability Rating
            <input
              required
              min="1"
              max="5"
              step="0.1"
              type="number"
              value={form.score}
              onChange={(event) => setForm({ ...form, score: Number(event.target.value) })}
              className="rounded-lg border border-outline-variant bg-surface px-3 py-2.5 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </label>
        </div>
        <footer className="flex flex-col-reverse gap-3 border-t border-outline-variant bg-surface-container-high px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-highest"
          >
            Cancel
          </button>
          <button className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition hover:bg-primaryHover">
            Add Supplier
          </button>
        </footer>
      </form>
    </div>
  );
}

function SupplierInput({
  label,
  onChange,
  value,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-on-surface-variant">
      {label}
      <input
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-outline-variant bg-surface px-3 py-2.5 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
    </label>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: typeof Warehouse;
  label: string;
  value: string;
  helper: string;
  tone: 'primary' | 'danger';
}) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-2 text-on-surface-variant">
        <Icon className={tone === 'danger' ? 'text-danger' : 'text-primary'} size={20} />
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={
          tone === 'danger'
            ? 'text-3xl font-bold text-danger sm:text-4xl'
            : 'text-3xl font-bold text-on-surface sm:text-4xl'
        }
      >
        {value}
      </p>
      <p className={tone === 'danger' ? 'mt-2 text-sm text-on-surface-variant' : 'mt-2 text-sm text-primary'}>
        {helper}
      </p>
    </div>
  );
}
