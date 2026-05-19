import {
  BarChart3,
  Bell,
  Boxes,
  CircleHelp,
  LogOut,
  Menu,
  PackagePlus,
  PackageCheck,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ordersApi, productsApi } from '../services/api';
import { logout } from '../store/authSlice';
import { useAppDispatch, useAppSelector } from '../store';

const navItems = [
  { to: '/products', label: 'Products', icon: Boxes },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['ADMIN'] },
  { to: '/catalog', label: 'Catalog', icon: PackageSearch },
];

type HeaderPanel = 'notifications' | 'settings' | 'help';

type SearchSuggestion =
  | { kind: 'product'; id: string; title: string; subtitle: string; to: string }
  | { kind: 'order'; id: string; title: string; subtitle: string; to: string }
  | { kind: 'page'; id: string; title: string; subtitle: string; to: string };

export function Layout() {
  const user = useAppSelector((state) => state.auth.user);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('inventory_sidebar_collapsed') === 'true',
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [activePanel, setActivePanel] = useState<HeaderPanel | null>(null);
  const [notificationSnapshot, setNotificationSnapshot] = useState({
    lowStock: 0,
    pendingOrders: 0,
    activeProducts: 0,
    loading: false,
    error: '',
  });

  const visibleNav = useMemo(
    () => navItems.filter((item) => !item.roles || (user && item.roles.includes(user.role))),
    [user],
  );
  const quickAction = useMemo(
    () =>
      user?.role === 'ADMIN'
        ? { to: '/products?new=1', label: 'New Product', icon: PackagePlus }
        : { to: '/orders?new=1', label: 'New Order', icon: ShoppingCart },
    [user?.role],
  );

  useEffect(() => {
    localStorage.setItem('inventory_sidebar_collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (activePanel !== 'notifications') return;

    let cancelled = false;
    setNotificationSnapshot((current) => ({ ...current, loading: true, error: '' }));

    Promise.all([productsApi.list({ limit: 100 }), ordersApi.list({ limit: 100 })])
      .then(([productData, orderData]) => {
        if (cancelled) return;
        setNotificationSnapshot({
          lowStock: productData.products.filter(
            (product) => product.stockLevel < product.reorderThreshold,
          ).length,
          pendingOrders: orderData.orders.filter((order) =>
            ['PENDING', 'PROCESSING'].includes(order.status),
          ).length,
          activeProducts: productData.products.length,
          loading: false,
          error: '',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setNotificationSnapshot((current) => ({
            ...current,
            loading: false,
            error: 'Could not refresh live alerts. Check API connectivity.',
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePanel]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchLoading(false);
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(() => {
      setSearchLoading(true);
      Promise.all([productsApi.list({ search: query, limit: 5 }), ordersApi.list({ limit: 12 })])
        .then(([productData, orderData]) => {
          if (cancelled) return;
          const normalized = query.toLowerCase();
          const productSuggestions: SearchSuggestion[] = productData.products
            .slice(0, 5)
            .map((product) => ({
              kind: 'product',
              id: `product-${product.id}`,
              title: product.name,
              subtitle: `${product.category} · ${product.stockLevel} in stock`,
              to: `/products?q=${encodeURIComponent(product.name)}`,
            }));
          const orderSuggestions: SearchSuggestion[] = orderData.orders
            .filter((order) => {
              const shortId = order.id.slice(0, 8).toLowerCase();
              return (
                shortId.includes(normalized) ||
                order.customerName.toLowerCase().includes(normalized) ||
                (order.customerEmail ?? '').toLowerCase().includes(normalized)
              );
            })
            .slice(0, 4)
            .map((order) => ({
              kind: 'order',
              id: `order-${order.id}`,
              title: `#${order.id.slice(0, 8).toUpperCase()}`,
              subtitle: `${order.customerName} · ${order.status}`,
              to: '/orders',
            }));
          const pageSuggestions: SearchSuggestion[] = visibleNav
            .filter((item) => item.label.toLowerCase().includes(normalized))
            .map((item) => ({
              kind: 'page',
              id: `page-${item.to}`,
              title: item.label,
              subtitle: 'Open workspace page',
              to: item.to,
            }));
          setSuggestions(
            [...productSuggestions, ...orderSuggestions, ...pageSuggestions].slice(0, 7),
          );
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [searchQuery, visibleNav]);

  function signOut() {
    setActivePanel(null);
    setMobileSidebarOpen(false);
    dispatch(logout());
    navigate('/login');
  }

  function runSearch() {
    const query = searchQuery.trim();
    if (!query) return;
    setActivePanel(null);
    setSearchOpen(false);
    navigate(`/products?q=${encodeURIComponent(query)}`);
  }

  function openSuggestion(suggestion: SearchSuggestion) {
    setActivePanel(null);
    setMobileSidebarOpen(false);
    setSearchQuery('');
    setSuggestions([]);
    setSearchOpen(false);
    navigate(suggestion.to);
  }

  function togglePanel(panel: HeaderPanel) {
    setSearchOpen(false);
    setActivePanel((current) => (current === panel ? null : panel));
  }

  function goToPanelTarget(to: string) {
    setActivePanel(null);
    setMobileSidebarOpen(false);
    navigate(to);
  }

  function renderHeaderPanel() {
    if (!activePanel) return null;

    const panelTitle = {
      notifications: 'Notifications',
      settings: 'Workspace Settings',
      help: 'Help',
    }[activePanel];

    return (
      <div
        id="workspace-header-panel"
        className="absolute right-0 top-[calc(100%+0.75rem)] z-[90] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container shadow-elevated"
      >
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-high px-4 py-3">
          <p className="text-sm font-bold uppercase tracking-wide text-on-surface">{panelTitle}</p>
          <button
            type="button"
            onClick={() => setActivePanel(null)}
            className="grid h-8 w-8 place-items-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
            aria-label="Close panel"
          >
            <X size={16} />
          </button>
        </div>

        {activePanel === 'notifications' && (
          <div className="grid gap-3 p-4">
            {notificationSnapshot.error ? (
              <div className="rounded-xl border border-danger/30 bg-dangerSoft p-3 text-sm font-semibold text-danger">
                {notificationSnapshot.error}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">
                {notificationSnapshot.loading
                  ? 'Checking live inventory and order queues...'
                  : notificationSnapshot.lowStock || notificationSnapshot.pendingOrders
                    ? 'Live workspace alerts.'
                    : 'No notifications right now.'}
              </p>
            )}

            {!notificationSnapshot.loading &&
              !notificationSnapshot.error &&
              notificationSnapshot.lowStock === 0 &&
              notificationSnapshot.pendingOrders === 0 && (
                <div className="rounded-xl border border-dashed border-outline-variant bg-surface p-5 text-center">
                  <Bell className="mx-auto text-on-surface-variant" size={24} />
                  <p className="mt-2 text-sm font-semibold text-on-surface">Queue is clear</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Low-stock and pending-order alerts will appear here when they need attention.
                  </p>
                </div>
              )}

            {notificationSnapshot.lowStock > 0 && (
              <button
                type="button"
                onClick={() => goToPanelTarget('/products')}
                className="flex w-full items-start gap-3 rounded-xl border border-outline-variant bg-surface p-3 text-left transition hover:border-primary hover:bg-surface-container-high"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-danger/10 text-danger">
                  <Boxes size={18} />
                </span>
                <span>
                  <span className="block font-semibold text-on-surface">Low stock alerts</span>
                  <span className="text-sm text-on-surface-variant">
                    {notificationSnapshot.lowStock} products need replenishment.
                  </span>
                </span>
              </button>
            )}

            {notificationSnapshot.pendingOrders > 0 && (
              <button
                type="button"
                onClick={() => goToPanelTarget('/orders')}
                className="flex w-full items-start gap-3 rounded-xl border border-outline-variant bg-surface p-3 text-left transition hover:border-primary hover:bg-surface-container-high"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <ShoppingCart size={18} />
                </span>
                <span>
                  <span className="block font-semibold text-on-surface">Order queue</span>
                  <span className="text-sm text-on-surface-variant">
                    {notificationSnapshot.pendingOrders} pending or processing orders.
                  </span>
                </span>
              </button>
            )}

            {user?.role === 'ADMIN' &&
              (notificationSnapshot.lowStock > 0 || notificationSnapshot.pendingOrders > 0) && (
              <button
                type="button"
                onClick={() => goToPanelTarget('/reports')}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition hover:bg-primaryHover"
              >
                Open Reports
              </button>
            )}
          </div>
        )}

        {activePanel === 'settings' && (
          <div className="grid gap-4 p-4">
            <div className="rounded-xl border border-dashed border-outline-variant bg-surface p-5 text-center">
              <Settings className="mx-auto text-on-surface-variant" size={24} />
              <p className="mt-2 text-sm font-semibold text-on-surface">
                No in-app workspace settings
              </p>
              <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                Runtime configuration is handled by deployment environment variables. Account
                details, roles, and localisation are not shown in this menu.
              </p>
            </div>
          </div>
        )}

        {activePanel === 'help' && (
          <div className="grid gap-3 p-4">
            <div className="rounded-xl border border-outline-variant bg-surface p-4">
              <p className="font-semibold text-on-surface">Quick workflow</p>
              <p className="mt-1 text-sm leading-6 text-on-surface-variant">
                Use Products for stock master data, Orders for Indian buyer dispatches, Suppliers
                for vendors, Reports for admin analytics, and Catalog for the internal demo catalog.
              </p>
            </div>
            <button
              type="button"
              onClick={() => goToPanelTarget('/catalog')}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition hover:bg-primaryHover"
            >
              Open Catalog
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderSearchBox() {
    return (
      <div className="relative w-full">
        <label className="relative block w-full">
          <span className="sr-only">Search workspace</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            size={18}
          />
          <input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => {
              setActivePanel(null);
              setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
              if (event.key === 'Escape') setSearchOpen(false);
            }}
            className="w-full rounded-full border border-outline-variant bg-surface-container py-2.5 pl-10 pr-10 text-sm text-on-surface outline-none transition placeholder:text-outline focus:border-primary focus:ring-4 focus:ring-primary/10"
            placeholder="Search inventory..."
            type="search"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSuggestions([]);
                setSearchOpen(false);
              }}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </label>

        {searchOpen && searchQuery.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[80] overflow-hidden rounded-xl border border-outline-variant bg-surface-container shadow-elevated">
            <div className="border-b border-outline-variant px-3 py-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
              {searchLoading ? 'Searching live data...' : 'Suggestions'}
            </div>
            {suggestions.length === 0 && !searchLoading ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={runSearch}
                className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
              >
                <Search size={17} />
                Search products for "{searchQuery.trim()}"
              </button>
            ) : (
              suggestions.map((suggestion) => {
                const Icon =
                  suggestion.kind === 'product'
                    ? Boxes
                    : suggestion.kind === 'order'
                      ? ShoppingCart
                      : PackageSearch;
                return (
                  <button
                    key={suggestion.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openSuggestion(suggestion)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-surface-container-high"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-on-surface">
                        {suggestion.title}
                      </span>
                      <span className="block truncate text-xs text-on-surface-variant">
                        {suggestion.subtitle}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  function renderSidebarContent(isMobile = false) {
    const compact = !isMobile && collapsed;
    const QuickActionIcon = quickAction.icon;

    function navigateFromSidebar(to: string) {
      setActivePanel(null);
      setSearchOpen(false);
      if (isMobile) setMobileSidebarOpen(false);
      navigate(to);
    }

    return (
      <>
        <div
          className={`mb-6 flex items-center gap-3 px-2 ${compact ? 'justify-center' : 'justify-between'}`}
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-on-primary">
            <PackageCheck size={22} />
          </div>
          {!compact && (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold leading-tight text-primary">
                  <span className="block">Microservices</span>
                  <span className="block">Inventory</span>
                </p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                  Management System
                </p>
              </div>
              <button
                type="button"
                onClick={() => (isMobile ? setMobileSidebarOpen(false) : setCollapsed(true))}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
                aria-label={isMobile ? 'Close sidebar' : 'Collapse sidebar'}
              >
                {isMobile ? <X size={18} /> : <PanelLeftClose size={18} />}
              </button>
            </>
          )}
        </div>

        {compact && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mb-5 grid h-10 w-full place-items-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={18} />
          </button>
        )}

        <button
          type="button"
          onClick={() => navigateFromSidebar(quickAction.to)}
          title={compact ? quickAction.label : undefined}
          className={`mb-8 flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-bold text-on-primary shadow-sm transition hover:bg-primaryHover ${
            compact ? '' : 'gap-2'
          }`}
        >
          <QuickActionIcon size={18} />
          {!compact && quickAction.label}
        </button>

        <nav
          aria-label={isMobile ? 'Mobile navigation' : 'Primary navigation'}
          className="grid gap-1"
        >
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={compact ? label : undefined}
              onClick={() => {
                setActivePanel(null);
                setSearchOpen(false);
                if (isMobile) setMobileSidebarOpen(false);
              }}
              className={({ isActive }) =>
                `flex min-h-11 items-center rounded-lg px-3 py-3 text-sm font-semibold transition ${compact ? 'justify-center' : 'gap-3'} ${
                  isActive
                    ? 'border border-primary/20 bg-primary/10 text-primary shadow-[0_0_10px_rgba(104,219,169,0.08)]'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                }`
              }
            >
              <Icon className="shrink-0" size={19} />
              {!compact && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-outline-variant pt-4">
          <button
            type="button"
            onClick={signOut}
            title={compact ? 'Logout' : undefined}
            className={`flex w-full items-center rounded-lg px-3 py-3 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface ${
              compact ? 'justify-center' : 'gap-3'
            }`}
          >
            <LogOut className="shrink-0" size={19} />
            {!compact && 'Logout'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background text-on-background">
      <div
        className={`fixed inset-0 z-[80] bg-background/70 backdrop-blur-sm transition-opacity lg:hidden ${
          mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setMobileSidebarOpen(false)}
        aria-hidden="true"
      />

      <aside
        id="workspace-mobile-sidebar"
        className={`fixed left-0 top-0 z-[90] flex h-dvh w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-outline-variant bg-surface-container px-4 py-6 shadow-elevated transition-transform duration-200 lg:hidden ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Mobile sidebar"
        aria-hidden={!mobileSidebarOpen}
      >
        {renderSidebarContent(true)}
      </aside>

      <aside
        id="workspace-sidebar"
        className={`fixed left-0 top-0 z-50 hidden h-full flex-col border-r border-outline-variant bg-surface-container py-6 transition-[width,padding] duration-200 lg:flex ${
          collapsed ? 'w-[88px] px-3' : 'w-[280px] px-4'
        }`}
        aria-label="Workspace sidebar"
      >
        {renderSidebarContent(false)}
      </aside>

      <div
        className={`min-h-screen transition-[margin] duration-200 ${collapsed ? 'lg:ml-[88px]' : 'lg:ml-[280px]'}`}
      >
        <header className="sticky top-0 z-40 border-b border-outline-variant bg-surface-container-low/95 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3 lg:hidden">
              <button
                type="button"
                onClick={() => {
                  setActivePanel(null);
                  setMobileSidebarOpen(true);
                }}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-outline-variant bg-surface-container text-on-surface-variant transition hover:border-primary hover:text-primary"
                aria-label="Open sidebar"
                aria-controls="workspace-mobile-sidebar"
                aria-expanded={mobileSidebarOpen}
              >
                <Menu size={19} />
              </button>
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-on-primary">
                <PackageCheck size={20} />
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="font-bold leading-none text-primary">
                  Microservices Inventory
                </p>
                <p className="text-xs text-on-surface-variant">Management System</p>
              </div>
            </div>

            <div className="hidden w-full max-w-md items-center lg:flex">{renderSearchBox()}</div>

            <div className="relative ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
              <button
                type="button"
                onClick={() => togglePanel('notifications')}
                className="grid h-10 w-10 place-items-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
                aria-label="Notifications"
                aria-controls="workspace-header-panel"
                aria-expanded={activePanel === 'notifications'}
              >
                <Bell size={19} />
              </button>
              <button
                type="button"
                onClick={() => togglePanel('settings')}
                className="grid h-10 w-10 place-items-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
                aria-label="Settings"
                aria-controls="workspace-header-panel"
                aria-expanded={activePanel === 'settings'}
              >
                <Settings size={19} />
              </button>
              <button
                type="button"
                onClick={() => togglePanel('help')}
                className="hidden h-10 w-10 place-items-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface sm:grid"
                aria-label="Help"
                aria-controls="workspace-header-panel"
                aria-expanded={activePanel === 'help'}
              >
                <CircleHelp size={19} />
              </button>
              <div className="hidden h-8 w-px bg-outline-variant sm:block" />
              <span className="hidden rounded-full bg-surface-container px-3 py-1.5 text-sm font-semibold text-on-surface sm:inline-flex">
                {user?.username} · {user?.role}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container text-sm font-semibold text-on-surface-variant transition hover:border-primary hover:text-primary sm:w-auto sm:px-3"
                aria-label="Logout"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Logout</span>
              </button>
              {renderHeaderPanel()}
            </div>
          </div>

          <div className="border-t border-outline-variant px-4 py-3 lg:hidden">
            {renderSearchBox()}
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 md:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
