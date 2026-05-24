import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Download,
  DollarSign,
  Filter,
  PackagePlus,
  Pencil,
  Search,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ProductForm } from '../components/ProductForm';
import { ProductImage } from '../components/ProductImage';
import { Toast } from '../components/Toast';
import { extractApiError, productsApi } from '../services/api';
import { useAppSelector } from '../store';
import type { Product } from '../types/api';
import { formatCurrency } from '../utils/currency';

export function ProductsPage() {
  const canManage = useAppSelector((state) => state.auth.user?.role === 'ADMIN');
  const [searchParams, setSearchParams] = useSearchParams();
  const querySearch = searchParams.get('q') ?? '';
  const createRequested = searchParams.get('new') === '1';
  const [products, setProducts] = useState<Product[]>([]);
  const [snapshot, setSnapshot] = useState<Product[]>([]);
  const [categoryFacets, setCategoryFacets] = useState<Array<{ category: string; count: number }>>(
    [],
  );
  const [searchText, setSearchText] = useState(querySearch);
  const [search, setSearch] = useState(querySearch);
  const [category, setCategory] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null | undefined>();
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

  const metricProducts = snapshot.length ? snapshot : products;
  const categories = useMemo(
    () =>
      categoryFacets.length
        ? categoryFacets.map((facet) => facet.category)
        : Array.from(new Set(metricProducts.map((product) => product.category))).sort(),
    [categoryFacets, metricProducts],
  );
  const lowStockCount = metricProducts.filter(
    (product) => product.stockLevel < product.reorderThreshold,
  ).length;
  const inventoryValue = metricProducts.reduce(
    (sum, product) => sum + product.price * product.stockLevel,
    0,
  );

  async function load(nextPage = page) {
    setLoading(true);
    try {
      const data = await productsApi.list({
        search: search || undefined,
        category: category || undefined,
        stockStatus: stockStatus || undefined,
        sortBy,
        sortDir,
        page: nextPage,
        limit: 10,
      });
      setProducts(data.products);
      setTotal(data.total);
      setTotalPages(Math.max(1, data.totalPages));
      setCategoryFacets(data.facets?.categories ?? []);
      if (!search && !category) setSnapshot(data.products);
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
  }, [search, category, stockStatus, sortBy, sortDir]);

  useEffect(() => {
    setSearchText(querySearch);
  }, [querySearch]);

  useEffect(() => {
    if (!createRequested) return;
    if (canManage) {
      setEditing(null);
      return;
    }
    clearCreateIntent();
  }, [canManage, clearCreateIntent, createRequested]);

  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchText.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [searchText]);

  useEffect(() => {
    let active = true;
    productsApi
      .publicList()
      .then((data) => {
        if (active) setSnapshot(data.products);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function save(payload: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'version'>) {
    try {
      if (editing) await productsApi.update(editing.id, payload);
      else await productsApi.create(payload);
      setEditing(undefined);
      clearCreateIntent();
      setToast({ message: editing ? 'Product updated.' : 'Product created.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function adjustStock(product: Product) {
    const value = window.prompt(`Adjust stock for ${product.name}. Use +10 or -5.`, '0');
    if (!value) return;
    const delta = Number(value.trim());
    if (!Number.isInteger(delta)) {
      setToast({ message: 'Enter a whole-number stock adjustment.', tone: 'error' });
      return;
    }
    if (delta === 0) return;
    try {
      await productsApi.adjustStock(product.id, delta, product.version);
      setToast({ message: 'Stock updated atomically.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    try {
      await productsApi.remove(product.id);
      setToast({ message: 'Product deleted.', tone: 'success' });
      await load();
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    }
  }

  async function exportCsv() {
    try {
      const data = await productsApi.exportCsv({
        search: search || undefined,
        category: category || undefined,
        stockStatus: stockStatus || undefined,
        sortBy,
        sortDir,
      });
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = data.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast({ message: `Exported ${data.count} products.`, tone: 'success' });
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
          <h2 className="text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
            Products
          </h2>
          <p className="mt-1 text-on-surface-variant">
            Manage inventory items, stock levels, and categorization.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setEditing(null)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition hover:bg-primaryHover active:scale-[0.99] sm:w-auto"
          >
            <PackagePlus size={18} />
            Add Product
          </button>
        )}
        <button
          onClick={() => void exportCsv()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant px-5 py-3 text-sm font-bold text-on-surface-variant transition hover:border-primary hover:text-primary sm:w-auto"
        >
          <Download size={18} />
          Export
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={Boxes}
          label="Total SKUs"
          value={String(total || snapshot.length)}
          accent="primary"
          helper="Catalog records"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Low Stock Alerts"
          value={String(lowStockCount)}
          accent="danger"
          helper="Action required"
        />
        <MetricCard
          icon={DollarSign}
          label="Inventory Value"
          value={formatCurrency(inventoryValue)}
          accent="tertiary"
          helper="Current stock x price"
        />
      </div>

      <div className="rounded-2xl border border-outline-variant bg-surface-container p-4 shadow-panel">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search products</span>
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
              size={18}
            />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search products..."
              className="w-full rounded-lg border border-outline-variant bg-surface py-2.5 pl-10 pr-4 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </label>
          <label className="md:w-64">
            <span className="sr-only">Filter by category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface px-4 py-2.5 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="">All Categories</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="md:w-52">
            <span className="sr-only">Filter by stock status</span>
            <select
              value={stockStatus}
              onChange={(event) => setStockStatus(event.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface px-4 py-2.5 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="">All Stock</option>
              <option value="in">In Stock</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
            </select>
          </label>
          <label className="md:w-52">
            <span className="sr-only">Sort products</span>
            <select
              value={`${sortBy}:${sortDir}`}
              onChange={(event) => {
                const [field, direction] = event.target.value.split(':');
                setSortBy(field);
                setSortDir(direction === 'asc' ? 'asc' : 'desc');
              }}
              className="w-full rounded-lg border border-outline-variant bg-surface px-4 py-2.5 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="updatedAt:desc">Recently Updated</option>
              <option value="name:asc">Name A-Z</option>
              <option value="stockLevel:asc">Lowest Stock</option>
              <option value="stockLevel:desc">Highest Stock</option>
              <option value="price:desc">Highest Price</option>
            </select>
          </label>
          <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-on-surface-variant md:ml-auto">
            <Filter className="mr-1 inline" size={14} />
            Displaying {products.length} of {total} products
          </span>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-outline-variant bg-surface-container shadow-panel">
        <div className="app-scrollbar overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="border-b border-outline-variant bg-surface-container-low text-xs font-bold uppercase tracking-wide text-on-surface-variant">
              <tr>
                <th className="px-6 py-4">Product</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Price</th>
                <th className="px-6 py-4">Stock Level</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slateLine">
              {loading ? (
                <tr>
                  <td className="px-6 py-12 text-center text-on-surface-variant" colSpan={6}>
                    Fetching live inventory...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td className="px-6 py-16 text-center" colSpan={6}>
                    <div className="mx-auto grid max-w-sm justify-items-center gap-3">
                      <div className="grid h-16 w-16 place-items-center rounded-full bg-surface-container-high text-outline">
                        <Boxes size={32} />
                      </div>
                      <p className="text-xl font-semibold text-on-surface">No items found</p>
                      <p className="text-sm text-on-surface-variant">
                        Adjust the search or category filter to find products.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const low = product.stockLevel < product.reorderThreshold;
                  const out = product.stockLevel === 0;
                  const fill = Math.min(
                    100,
                    Math.round(
                      (product.stockLevel / Math.max(product.reorderThreshold * 2, 1)) * 100,
                    ),
                  );
                  return (
                    <tr
                      key={product.id}
                      className="bg-surface-container transition hover:bg-surface-container-high"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-high">
                            <ProductImage product={product} variant="thumb" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-on-surface">{product.name}</p>
                            <p className="max-w-md truncate text-sm text-on-surface-variant">
                              {product.description ?? 'No description'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {product.category}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-on-surface">
                        {formatCurrency(product.price)}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => canManage && adjustStock(product)}
                          className={`grid gap-1 text-left text-sm ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <span
                            className={
                              low ? 'font-semibold text-danger' : 'font-semibold text-on-surface'
                            }
                          >
                            {out ? 'Out of stock' : `${product.stockLevel} units`}
                          </span>
                          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-container-highest">
                            <span
                              className={`block h-full ${low ? 'bg-danger' : 'bg-primary'}`}
                              style={{ width: `${fill}%` }}
                            />
                          </span>
                          <span
                            className={
                              low
                                ? 'text-[11px] font-semibold text-danger'
                                : 'text-[11px] text-on-surface-variant'
                            }
                          >
                            Threshold: {product.reorderThreshold}
                          </span>
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                            out
                              ? 'bg-dangerSoft text-danger'
                              : low
                                ? 'bg-danger/10 text-danger'
                                : 'bg-success/10 text-success'
                          }`}
                        >
                          {out ? 'Out of Stock' : low ? 'Low Stock' : 'In Stock'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {canManage ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditing(product)}
                              className="rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
                              aria-label={`Edit ${product.name}`}
                            >
                              <Pencil size={18} />
                            </button>
                            <button
                              onClick={() => remove(product)}
                              className="rounded-lg p-2 text-on-surface-variant transition hover:bg-dangerSoft hover:text-danger"
                              aria-label={`Delete ${product.name}`}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-sm font-semibold text-on-surface-variant">
                            Read-only
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-outline-variant bg-surface-container-low px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-on-surface-variant">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => void goToPage(page - 1)}
              className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => void goToPage(page + 1)}
              className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {editing !== undefined && (
        <ProductForm
          product={editing}
          onCancel={() => {
            setEditing(undefined);
            clearCreateIntent();
          }}
          onSubmit={save}
        />
      )}
      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(undefined)} />
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
  accent,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  helper: string;
  accent: 'primary' | 'danger' | 'tertiary';
}) {
  const colors = {
    primary: 'bg-primary/10 text-primary',
    danger: 'bg-danger/10 text-danger',
    tertiary: 'bg-tertiary/10 text-tertiary',
  }[accent];

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container p-6 shadow-panel">
      <div className="flex items-start justify-between">
        <div className={`grid h-12 w-12 place-items-center rounded-xl ${colors}`}>
          <Icon size={22} />
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-success">
          <TrendingUp size={14} />
          Live
        </span>
      </div>
      <p className="mt-5 text-sm text-on-surface-variant">{label}</p>
      <p className="mt-1 break-words text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-xs text-on-surface-variant">{helper}</p>
    </div>
  );
}
