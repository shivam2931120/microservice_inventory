import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn, PackageCheck, Search, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import { ProductImage } from '../components/ProductImage';
import { productsApi } from '../services/api';
import type { Product } from '../types/api';
import { addProductToCart, canAddToCart, cartItemCount } from '../utils/cart';
import { formatCurrency } from '../utils/currency';

export function PublicCatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'name' | 'price-low' | 'price-high'>('name');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    productsApi
      .publicList()
      .then((data) => setProducts(data.products))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
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

  const count = useMemo(() => cartItemCount(cart), [cart]);

  return (
    <main className="min-h-screen bg-background text-on-surface">
      <header className="sticky top-0 z-40 border-b border-outline-variant bg-surface-container-low/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/public" className="flex min-w-0 items-center gap-3">
            <PackageCheck className="text-primary" size={28} />
            <span className="hidden truncate text-xl font-bold text-primary sm:inline">
              Microservices Inventory Management System
            </span>
          </Link>
          <div className="hidden max-w-md flex-1 sm:block">
            <label className="relative block">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
                size={18}
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-full border border-outline-variant bg-surface-container py-2 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                placeholder="Search catalog..."
              />
            </label>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
              <ShoppingCart size={17} />
              {count}
            </span>
            <Link
              to="/login"
              className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-on-primary transition hover:bg-primaryHover sm:w-auto sm:px-4"
            >
              <LogIn size={17} />
              <span className="hidden sm:inline">Login</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
        <section className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
              Catalog
            </h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="relative sm:hidden">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
                size={18}
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container py-2.5 pl-10 pr-4 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                placeholder="Search products..."
              />
            </label>
            <label className="relative">
              <SlidersHorizontal
                className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
                size={18}
              />
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container py-2.5 pl-10 pr-4 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
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
              className="rounded-lg border border-outline-variant bg-surface-container px-4 py-2.5 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="name">Sort by Name</option>
              <option value="price-low">Price Low to High</option>
              <option value="price-high">Price High to Low</option>
            </select>
          </div>
        </section>

        {loading ? (
          <div className="rounded-2xl border border-outline-variant bg-surface-container p-12 text-center text-on-surface-variant shadow-panel">
            Loading public catalog...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-outline-variant bg-surface-container p-12 text-center shadow-panel">
            <p className="text-xl font-semibold text-on-surface">No products found</p>
            <p className="mt-2 text-on-surface-variant">Try a different search or category.</p>
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                  className="group flex overflow-hidden rounded-2xl border border-outline-variant bg-surface-container shadow-panel transition hover:-translate-y-0.5 hover:border-outline hover:shadow-elevated"
                >
                  <div className="flex w-full flex-col">
                    <div className="relative h-64 overflow-hidden bg-surface-container-high">
                      <ProductImage product={product} />
                      <span className="absolute left-4 top-4 rounded-full border border-primary/20 bg-surface/85 px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary backdrop-blur">
                        {product.category}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                        <h2 className="min-w-0 text-xl font-semibold leading-tight text-on-surface">
                          {product.name}
                        </h2>
                        <span className="shrink-0 text-xl font-semibold text-primary">
                          {formatCurrency(product.price)}
                        </span>
                      </div>
                      <p className="line-clamp-2 flex-1 text-sm leading-6 text-on-surface-variant">
                        {product.description || 'No description available.'}
                      </p>
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
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
