import { useEffect, useMemo, useState } from 'react';
import { PackageSearch, Search, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import { ProductImage } from '../components/ProductImage';
import { productsApi } from '../services/api';
import type { Product } from '../types/api';
import { addProductToCart, canAddToCart, cartItemCount } from '../utils/cart';
import { formatCurrency } from '../utils/currency';

export function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'name' | 'price-low' | 'price-high'>('name');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    productsApi
      .publicList()
      .then((data) => {
        if (active) {
          setProducts(data.products);
          setError('');
        }
      })
      .catch(() => {
        if (active) {
          setProducts([]);
          setError('Could not load the live catalog. Check the API gateway and inventory service.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category))).sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return products
      .filter((product) => {
        const matchesSearch =
          !normalized ||
          product.name.toLowerCase().includes(normalized) ||
          product.category.toLowerCase().includes(normalized) ||
          (product.description ?? '').toLowerCase().includes(normalized);
        return matchesSearch && (!category || product.category === category);
      })
      .sort((left, right) => {
        if (sort === 'price-low') return left.price - right.price;
        if (sort === 'price-high') return right.price - left.price;
        return left.name.localeCompare(right.name);
      });
  }, [category, products, search, sort]);

  const cartCount = useMemo(() => cartItemCount(cart), [cart]);

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">Catalog</h2>
        </div>
        <div
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-bold text-primary"
          aria-label={`${cartCount} items in cart`}
          title={`${cartCount} items in cart`}
        >
          <ShoppingCart size={18} />
          {cartCount}
        </div>
      </div>

      <div className="rounded-2xl border border-outline-variant bg-surface-container p-4 shadow-panel">
        <div className="grid gap-3 lg:grid-cols-[1fr_16rem_14rem] lg:items-center">
          <label className="relative">
            <span className="sr-only">Search catalog</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface py-2.5 pl-10 pr-4 text-on-surface outline-none transition placeholder:text-outline focus:border-primary focus:ring-4 focus:ring-primary/10"
              placeholder="Search products, categories, SKUs..."
            />
          </label>
          <label className="relative">
            <span className="sr-only">Filter category</span>
            <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={18} />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-lg border border-outline-variant bg-surface py-2.5 pl-10 pr-4 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="">All Categories</option>
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="w-full rounded-lg border border-outline-variant bg-surface px-4 py-2.5 text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
          >
            <option value="name">Sort by Name</option>
            <option value="price-low">Price Low to High</option>
            <option value="price-high">Price High to Low</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container p-12 text-center text-on-surface-variant shadow-panel">
          Loading catalog...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-danger/30 bg-dangerSoft p-12 text-center shadow-panel">
          <p className="text-xl font-semibold text-danger">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container p-12 text-center shadow-panel">
          <PackageSearch className="mx-auto text-on-surface-variant" size={42} />
          <p className="mt-3 text-xl font-semibold text-on-surface">No products found</p>
          <p className="mt-2 text-on-surface-variant">Try a different search or category.</p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((product) => {
            const canAdd = canAddToCart(cart, product);
            const inCart = cart[product.id] ?? 0;
            const actionLabel =
              product.stockLevel === 0
                ? 'Out of Stock'
                : inCart >= product.stockLevel
                  ? 'Stock Limit Reached'
                  : 'Add to Demo Cart';

            return (
              <article
                key={product.id}
                className="group overflow-hidden rounded-2xl border border-outline-variant bg-surface-container shadow-panel transition hover:-translate-y-0.5 hover:border-outline hover:shadow-elevated"
              >
                <div className="relative h-60 overflow-hidden bg-surface-container-high">
                  <ProductImage product={product} />
                  <span className="absolute left-4 top-4 rounded-full border border-primary/20 bg-surface/85 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary backdrop-blur">
                    {product.category}
                  </span>
                </div>
                <div className="flex min-h-64 flex-col p-5">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <h3 className="min-w-0 text-xl font-semibold leading-tight text-on-surface">{product.name}</h3>
                    <span className="shrink-0 text-xl font-semibold text-primary">{formatCurrency(product.price)}</span>
                  </div>
                  <p className="line-clamp-3 flex-1 text-sm leading-6 text-on-surface-variant">
                    {product.description || 'No description available.'}
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-on-surface-variant">
                      {product.stockLevel} units available
                    </span>
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                        product.stockLevel === 0
                          ? 'bg-dangerSoft text-danger'
                          : product.stockLevel < product.reorderThreshold
                            ? 'bg-danger/10 text-danger'
                            : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {product.stockLevel === 0 ? 'Out' : product.stockLevel < product.reorderThreshold ? 'Low' : 'Ready'}
                    </span>
                  </div>
                  <button
                    disabled={!canAdd}
                    onClick={() => setCart((current) => addProductToCart(current, product))}
                    className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${
                      canAdd
                        ? 'bg-primary text-on-primary hover:bg-primaryHover'
                        : 'cursor-not-allowed bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    <ShoppingCart size={18} />
                    {actionLabel}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </section>
  );
}
