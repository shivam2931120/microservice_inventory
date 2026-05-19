import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Info, Minus, Package, Plus, Trash2, User, X } from 'lucide-react';
import type { Product } from '../types/api';
import { formatCurrency } from '../utils/currency';

interface OrderFormProps {
  products: Product[];
  onCancel: () => void;
  onSubmit: (payload: {
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    items: Array<{ productId: string; quantity: number }>;
  }) => Promise<void>;
}

export function OrderForm({ products, onCancel, onSubmit }: OrderFormProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [items, setItems] = useState([{ productId: products[0]?.id ?? '', quantity: 1 }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!items[0]?.productId && products[0]) {
      setItems([{ productId: products[0].id, quantity: 1 }]);
    }
  }, [items, products]);

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        return sum + (product?.price ?? 0) * item.quantity;
      }, 0),
    [items, products],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        customerName,
        customerEmail: customerEmail || undefined,
        customerAddress: customerAddress || undefined,
        items: items.filter((item) => item.productId && item.quantity > 0),
      });
    } finally {
      setSaving(false);
    }
  }

  function updateItem(index: number, next: { productId?: string; quantity?: number }) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              productId: next.productId ?? item.productId,
              quantity: Math.max(1, next.quantity ?? item.quantity),
            }
          : item,
      ),
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-form-title"
    >
      <form
        onSubmit={submit}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container shadow-elevated lg:flex-row"
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface-container px-6 py-5">
            <div>
              <h2
                id="order-form-title"
                className="text-2xl font-semibold tracking-tight text-on-surface"
              >
                Create New Order
              </h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                GST-ready order draft for Indian buyer fulfilment.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg p-2 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
              aria-label="Close order form"
            >
              <X size={20} />
            </button>
          </header>

          <div className="app-scrollbar flex-1 overflow-y-auto bg-surface-container p-6">
            <div className="grid gap-8">
              <section className="grid gap-4">
                <div className="flex items-center gap-2 text-primary">
                  <User size={20} />
                  <h3 className="text-sm font-bold uppercase tracking-wide">Buyer Information</h3>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Buyer Name
                    <input
                      required
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      className="rounded-lg border border-outline-variant bg-surface px-4 py-3 text-base font-normal normal-case tracking-normal text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Buyer Email
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      className="rounded-lg border border-outline-variant bg-surface px-4 py-3 text-base font-normal normal-case tracking-normal text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-variant md:col-span-2">
                    Address
                    <input
                      value={customerAddress}
                      onChange={(event) => setCustomerAddress(event.target.value)}
                      className="rounded-lg border border-outline-variant bg-surface px-4 py-3 text-base font-normal normal-case tracking-normal text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                    />
                  </label>
                </div>
              </section>

              <section className="grid gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Package size={20} />
                    <h3 className="text-sm font-bold uppercase tracking-wide">
                      Product Line Items
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setItems([...items, { productId: products[0]?.id ?? '', quantity: 1 }])
                    }
                    className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
                  >
                    <Plus size={17} />
                    Add Item
                  </button>
                </div>

                <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-sm">
                  <div className="hidden grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_2.5rem] gap-3 bg-surface-container-low px-5 py-3 text-xs font-bold uppercase tracking-wide text-on-surface-variant lg:grid">
                    <span>Product</span>
                    <span>Quantity</span>
                    <span className="text-right">Unit Price</span>
                    <span className="text-right">Subtotal</span>
                    <span />
                  </div>
                  <div className="divide-y divide-outline-variant">
                    {items.map((item, index) => {
                      const product = products.find((candidate) => candidate.id === item.productId);
                      return (
                        <div
                          key={`${item.productId}-${index}`}
                          className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_2.5rem] lg:items-center"
                        >
                          <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-on-surface-variant lg:gap-0">
                            <span className="lg:sr-only">Product</span>
                            <select
                              required
                              value={item.productId}
                              onChange={(event) =>
                                updateItem(index, { productId: event.target.value })
                              }
                              className="w-full rounded-lg border border-outline-variant bg-surface-container px-3 py-2.5 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                            >
                              {products.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name} · {candidate.stockLevel} units available
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="flex w-32 overflow-hidden rounded-lg border border-outline-variant lg:w-full">
                            <button
                              type="button"
                              onClick={() => updateItem(index, { quantity: item.quantity - 1 })}
                              className="grid h-10 w-10 place-items-center bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container-high"
                              aria-label="Decrease quantity"
                            >
                              <Minus size={15} />
                            </button>
                            <input
                              required
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(event) =>
                                updateItem(index, { quantity: Number(event.target.value) })
                              }
                              className="h-10 w-12 border-0 bg-surface text-center text-sm text-on-surface focus:ring-0"
                            />
                            <button
                              type="button"
                              onClick={() => updateItem(index, { quantity: item.quantity + 1 })}
                              className="grid h-10 w-10 place-items-center bg-surface-container-low text-on-surface-variant transition hover:bg-surface-container-high"
                              aria-label="Increase quantity"
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                          <p className="text-left text-sm text-on-surface-variant lg:text-right">
                            {formatCurrency(product?.price ?? 0)}
                          </p>
                          <p className="text-left font-bold text-on-surface lg:text-right">
                            {formatCurrency((product?.price ?? 0) * item.quantity)}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setItems(items.filter((_, itemIndex) => itemIndex !== index))
                            }
                            className="rounded-lg p-2 text-danger transition hover:bg-dangerSoft"
                            aria-label="Remove item"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-6 md:flex-row md:items-start">
                <div className="flex-1 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <Info className="mt-0.5 text-primary" size={20} />
                    <div>
                      <p className="text-sm font-bold text-primary">Stock Availability Note</p>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        The order service will reserve stock before the dispatch workflow moves
                        ahead.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <footer className="flex flex-col-reverse gap-3 border-t border-outline-variant bg-surface-container px-6 py-5 sm:flex-row sm:justify-end lg:hidden">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-outline-variant px-5 py-2.5 text-sm font-semibold text-on-surface transition hover:bg-surface-container-high"
            >
              Discard Draft
            </button>
            <button
              disabled={saving || products.length === 0 || items.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-on-primary transition hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 size={18} />
              {saving ? 'Creating...' : 'Create Order'}
            </button>
          </footer>
        </div>

        <aside className="hidden w-[360px] flex-col border-l border-outline-variant bg-surface-container-high p-6 lg:flex">
          <h3 className="text-xl font-semibold text-on-surface">Order Summary</h3>
          <div className="mt-6 flex-1 space-y-4">
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>Line items</span>
              <span>{items.length}</span>
            </div>
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>Subtotal</span>
              <span className="text-on-surface">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>Stock reservation</span>
              <span className="text-on-surface">Pending</span>
            </div>
            <div className="border-t border-outline-variant pt-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-on-surface">Total</span>
                <span className="text-2xl font-bold text-primary">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <button
              disabled={saving || products.length === 0 || items.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-on-primary transition hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 size={18} />
              {saving ? 'Creating...' : 'Create Order'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full rounded-xl border border-outline-variant px-5 py-3 text-sm font-semibold text-on-surface transition hover:bg-surface-container-highest"
            >
              Discard Draft
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}
