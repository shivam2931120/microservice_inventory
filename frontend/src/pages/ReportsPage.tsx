import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  Download,
  DollarSign,
  ShoppingBasket,
} from 'lucide-react';
import { Toast } from '../components/Toast';
import { extractApiError, reportsApi } from '../services/api';
import type { AdvancedReport, InventoryReport, SalesReport, StockAlertReport } from '../types/api';
import { formatCurrency } from '../utils/currency';

type ReportRange = '7' | '30' | '90' | '365';

const rangeOptions: Array<{ value: ReportRange; label: string }> = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: '365', label: 'Last 12 Months' },
];

export function ReportsPage() {
  const [range, setRange] = useState<ReportRange>('30');
  const [sales, setSales] = useState<SalesReport>();
  const [inventory, setInventory] = useState<InventoryReport>();
  const [alerts, setAlerts] = useState<StockAlertReport>();
  const [advanced, setAdvanced] = useState<AdvancedReport>();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; tone: 'error' | 'success' }>();

  const dateRange = useMemo(() => getDateRange(range), [range]);

  async function load() {
    setLoading(true);
    try {
      const [salesData, inventoryData, alertData, advancedData] = await Promise.all([
        reportsApi.sales({ from: dateRange.from.toISOString(), to: dateRange.to.toISOString() }),
        reportsApi.inventory(),
        reportsApi.stockAlerts(),
        reportsApi.advanced({ from: dateRange.from.toISOString(), to: dateRange.to.toISOString() }),
      ]);
      setSales(salesData);
      setInventory(inventoryData);
      setAlerts(alertData);
      setAdvanced(advancedData);
    } catch (error) {
      setToast({ message: extractApiError(error), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [dateRange.from, dateRange.to]);

  const distribution = useMemo(() => {
    const products = inventory?.products ?? [];
    const lowStock = products.filter(
      (product) => product.lowStock && product.stockLevel > 0,
    ).length;
    const outOfStock = products.filter((product) => product.stockLevel === 0).length;
    const inStock = Math.max(0, products.length - lowStock - outOfStock);
    return { inStock, lowStock, outOfStock, total: products.length };
  }, [inventory]);

  function exportReport() {
    const reportWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!reportWindow) {
      setToast({ message: 'Allow pop-ups to export the report.', tone: 'error' });
      return;
    }

    reportWindow.document.write(
      buildReportHtml({
        alerts,
        dateRange,
        distribution,
        inventory,
        sales,
      }),
    );
    reportWindow.document.close();
    reportWindow.focus();
    window.setTimeout(() => {
      reportWindow.print();
    }, 250);
    setToast({ message: 'Report export prepared.', tone: 'success' });
  }

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h2 className="text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
            Reports & Analytics
          </h2>
          <p className="mt-1 text-on-surface-variant">
            Revenue, stock, and dispatch insights for the selected reporting period.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="relative inline-flex flex-1 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container px-4 py-2.5 text-sm font-semibold text-on-surface transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 sm:flex-none">
            <CalendarDays size={18} />
            <span className="sr-only">Report range</span>
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as ReportRange)}
              className="w-full border-0 bg-transparent p-0 text-sm font-semibold text-on-surface outline-none focus:ring-0"
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={exportReport}
            disabled={loading}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
          >
            <Download size={18} />
            Export Report
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-outline-variant bg-surface-container p-12 text-center text-on-surface-variant shadow-panel">
          Generating analytics...
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard
              icon={DollarSign}
              label="Total Sales"
              value={formatCurrency(sales?.totalSales ?? 0)}
              badge="+ live"
            />
            <KpiCard
              icon={ShoppingBasket}
              label="Order Count"
              value={String(sales?.orderCount ?? 0)}
              badge="Orders"
            />
            <KpiCard
              icon={Boxes}
              label="Active SKUs"
              value={String(inventory?.products.length ?? 0)}
              badge="Stable"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <section className="rounded-2xl border border-outline-variant bg-surface-container p-6 shadow-panel">
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-xl font-semibold text-on-surface sm:text-2xl">
                  Sales Over Time
                </h3>
                <div className="flex w-fit rounded-lg bg-surface p-1 text-sm font-semibold">
                  <span className="rounded-md bg-surface-container-high px-3 py-1 text-on-surface shadow-sm">
                    Revenue
                  </span>
                  <span className="px-3 py-1 text-on-surface-variant">Orders</span>
                </div>
              </div>
              <SalesChart days={sales?.byDay ?? []} />
            </section>

            <section className="rounded-2xl border border-outline-variant bg-surface-container p-6 shadow-panel">
              <h3 className="text-xl font-semibold text-on-surface sm:text-2xl">
                Inventory Distribution
              </h3>
              <div className="mt-6 flex flex-col items-center gap-6">
                <DistributionChart distribution={distribution} />
                <div className="w-full space-y-3">
                  <LegendRow
                    color="bg-primary"
                    label="In Stock"
                    value={`${distribution.inStock} products`}
                  />
                  <LegendRow
                    color="bg-danger"
                    label="Low Stock"
                    value={`${distribution.lowStock} products`}
                  />
                  <LegendRow
                    color="bg-slateLine"
                    label="Out of Stock"
                    value={`${distribution.outOfStock} products`}
                  />
                </div>
              </div>
            </section>
          </div>

          <section className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Boxes className="text-primary" size={24} />
              <h3 className="text-xl font-semibold text-on-surface sm:text-2xl">
                Smart Inventory Intelligence
              </h3>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <KpiCard
                icon={DollarSign}
                label="Stock Valuation"
                value={formatCurrency(advanced?.stockValuation.value ?? 0)}
                badge="Inventory"
              />
              <KpiCard
                icon={ShoppingBasket}
                label="Fastest Mover"
                value={advanced?.fastMoving[0]?.name ?? 'No sales'}
                badge={`${advanced?.fastMoving[0]?.units ?? 0} units`}
              />
              <KpiCard
                icon={AlertTriangle}
                label="Reorder Suggestions"
                value={String(advanced?.reorderSuggestions.length ?? 0)}
                badge="Action"
              />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <InsightList
                title="Recommended Reorders"
                rows={(advanced?.reorderSuggestions ?? []).map((item) => ({
                  title: item.name,
                  detail: `${item.stockLevel}/${item.reorderThreshold} units · reorder ${item.suggestedQuantity}`,
                }))}
                empty="No reorder suggestions."
              />
              <InsightList
                title="Supplier Performance"
                rows={(advanced?.supplierPerformance ?? []).map((item) => ({
                  title: item.supplierName,
                  detail: `${item.received}/${item.purchaseOrders} received · ${item.fulfilmentRate}% fulfilment`,
                }))}
                empty="No purchase order supplier history yet."
              />
            </div>
          </section>

          <section className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <AlertTriangle className="text-danger" size={24} />
              <h3 className="text-xl font-semibold text-on-surface sm:text-2xl">
                Critical Low Stock Alerts
              </h3>
              <span className="rounded-full bg-dangerSoft px-3 py-1 text-xs font-bold uppercase tracking-wide text-danger">
                {alerts?.alerts.length ?? 0} Items Requiring Action
              </span>
            </div>
            <div className="min-w-0 overflow-hidden rounded-2xl border border-outline-variant bg-surface-container shadow-panel">
              <div className="app-scrollbar overflow-x-auto">
                <table className="w-full min-w-[780px] text-left">
                  <thead className="bg-surface-container-low text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-6 py-4">Product Detail</th>
                      <th className="px-6 py-4">Current Stock</th>
                      <th className="px-6 py-4">Min. Threshold</th>
                      <th className="px-6 py-4">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slateLine">
                    {(alerts?.alerts ?? []).length === 0 ? (
                      <tr>
                        <td className="px-6 py-10 text-center text-on-surface-variant" colSpan={4}>
                          No low-stock alerts yet.
                        </td>
                      </tr>
                    ) : (
                      (alerts?.alerts ?? []).map((alert) => (
                        <tr
                          key={alert.id}
                          className="bg-surface-container transition hover:bg-surface-container-high"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="grid h-10 w-10 place-items-center rounded bg-danger/10 text-danger">
                                <AlertTriangle size={18} />
                              </div>
                              <div>
                                <p className="font-semibold text-on-surface">{alert.name}</p>
                                <p className="font-mono text-xs text-on-surface-variant">
                                  {alert.productId.slice(0, 8)}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-bold text-danger">
                            {alert.stockLevel} units
                          </td>
                          <td className="px-6 py-4 text-sm text-on-surface-variant">
                            {alert.reorderThreshold} units
                          </td>
                          <td className="px-6 py-4 text-sm text-on-surface-variant">
                            {new Date(alert.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-outline-variant bg-surface-container p-6 shadow-panel">
            <h3 className="text-xl font-semibold text-on-surface sm:text-2xl">Inventory Levels</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(inventory?.products ?? []).length === 0 ? (
                <p className="text-sm text-on-surface-variant">No inventory records available.</p>
              ) : (
                (inventory?.products ?? []).map((product) => (
                  <div
                    key={product.productId}
                    className="rounded-xl border border-outline-variant bg-surface p-4"
                  >
                    <div className="flex justify-between gap-3">
                      <p className="font-semibold text-on-surface">{product.name}</p>
                      <span className="text-sm font-semibold text-on-surface-variant">
                        {product.category}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-highest">
                      <div
                        className={product.lowStock ? 'h-full bg-danger' : 'h-full bg-primary'}
                        style={{
                          width: `${Math.min(100, (product.stockLevel / Math.max(product.reorderThreshold * 2, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-on-surface-variant">
                      {product.stockLevel} in stock · threshold {product.reorderThreshold}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      <Toast message={toast?.message} tone={toast?.tone} onClose={() => setToast(undefined)} />
    </section>
  );
}

function getDateRange(range: ReportRange) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - Number(range) + 1);
  from.setHours(0, 0, 0, 0);
  return {
    from,
    to,
    label: rangeOptions.find((option) => option.value === range)?.label ?? 'Selected Range',
  };
}

function KpiCard({
  icon: Icon,
  label,
  value,
  badge,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  badge: string;
}) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container p-6 shadow-panel">
      <div className="mb-5 flex items-start justify-between">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon size={21} />
        </span>
        <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-primary">
          {badge}
        </span>
      </div>
      <p className="text-sm font-semibold text-on-surface-variant">{label}</p>
      <p className="mt-1 break-words text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
        {value}
      </p>
    </div>
  );
}

function SalesChart({ days }: { days: SalesReport['byDay'] }) {
  const maxSales = Math.max(1, ...days.map((day) => day.totalSales));
  const points = days.length
    ? days
        .map((day, index) => {
          const x = days.length === 1 ? 50 : (index / (days.length - 1)) * 100;
          const y = 90 - (day.totalSales / maxSales) * 72;
          return `${x},${y}`;
        })
        .join(' ')
    : '0,90 100,90';

  return (
    <div className="relative h-[320px] overflow-hidden rounded-lg border border-outline-variant bg-surface p-4">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)]"
      >
        <defs>
          <linearGradient id="sales-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#68DBA9" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#68DBA9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline
          points={points}
          fill="none"
          stroke="#68DBA9"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <polygon points={`0,100 ${points} 100,100`} fill="url(#sales-fill)" />
      </svg>
      {days.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-on-surface-variant">
          No sales data for this range
        </div>
      )}
      <div className="absolute inset-x-4 bottom-4 flex justify-between text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
        {days.length ? (
          days.slice(0, 5).map((day) => <span key={day.date}>{day.date.slice(5)}</span>)
        ) : (
          <span>No data</span>
        )}
      </div>
    </div>
  );
}

function DistributionChart({
  distribution,
}: {
  distribution: { inStock: number; lowStock: number; outOfStock: number; total: number };
}) {
  const optimal =
    distribution.total === 0 ? 0 : Math.round((distribution.inStock / distribution.total) * 100);
  const low =
    distribution.total === 0 ? 0 : Math.round((distribution.lowStock / distribution.total) * 100);

  return (
    <div className="relative grid h-48 w-48 place-items-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" fill="none" r="16" stroke="#303632" strokeWidth="4" />
        <circle
          cx="18"
          cy="18"
          fill="none"
          r="16"
          stroke="#68DBA9"
          strokeDasharray={`${optimal}, 100`}
          strokeWidth="4"
        />
        <circle
          cx="18"
          cy="18"
          fill="none"
          r="16"
          stroke="#FFB4AB"
          strokeDasharray={`${low}, 100`}
          strokeDashoffset={`-${optimal}`}
          strokeWidth="4"
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-3xl font-bold text-on-surface">{optimal}%</p>
        <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">Optimal</p>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-on-surface-variant">
        <span className={`h-3 w-3 rounded-full ${color}`} />
        {label}
      </span>
      <span className="font-semibold text-on-surface">{value}</span>
    </div>
  );
}

function InsightList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ title: string; detail: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container p-5 shadow-panel">
      <h4 className="text-lg font-semibold text-on-surface">{title}</h4>
      <div className="mt-4 grid gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant">{empty}</p>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.title}-${row.detail}`}
              className="rounded-xl border border-outline-variant bg-surface p-4"
            >
              <p className="font-semibold text-on-surface">{row.title}</p>
              <p className="mt-1 text-sm text-on-surface-variant">{row.detail}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function buildReportHtml({
  alerts,
  dateRange,
  distribution,
  inventory,
  sales,
}: {
  alerts?: StockAlertReport;
  dateRange: ReturnType<typeof getDateRange>;
  distribution: { inStock: number; lowStock: number; outOfStock: number; total: number };
  inventory?: InventoryReport;
  sales?: SalesReport;
}) {
  const salesRows = sales?.byDay ?? [];
  const inventoryRows = inventory?.products ?? [];
  const alertRows = alerts?.alerts ?? [];
  const reportDate = new Date().toLocaleString();

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Inventory Report</title>
    <style>
      @page { margin: 18mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #1b211d; font-family: Inter, Arial, sans-serif; background: #ffffff; }
      main { max-width: 1080px; margin: 0 auto; padding: 24px; }
      header { border-bottom: 2px solid #1b211d; padding-bottom: 16px; margin-bottom: 20px; }
      h1 { margin: 0; font-size: 28px; }
      h2 { margin: 26px 0 10px; font-size: 18px; }
      p { margin: 4px 0; color: #4a554e; }
      .meta { display: flex; justify-content: space-between; gap: 16px; font-size: 12px; }
      .grid { display: grid; gap: 12px; grid-template-columns: repeat(3, 1fr); margin: 18px 0; }
      .card { border: 1px solid #c8d1cb; border-radius: 10px; padding: 14px; }
      .label { color: #5d6a62; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .value { margin-top: 6px; color: #0f1511; font-size: 24px; font-weight: 800; }
      .charts { display: grid; gap: 16px; grid-template-columns: 2fr 1fr; align-items: stretch; }
      .chart { border: 1px solid #c8d1cb; border-radius: 10px; padding: 16px; min-height: 220px; }
      svg { width: 100%; height: 170px; display: block; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: auto; }
      th, td { border: 1px solid #d7ded9; padding: 8px; text-align: left; font-size: 12px; vertical-align: top; }
      th { background: #eef4f0; color: #1b211d; font-weight: 800; }
      tr { page-break-inside: avoid; }
      .muted { color: #66736b; }
      .danger { color: #a33b35; font-weight: 800; }
      .bar { height: 10px; background: #e8eee9; border-radius: 999px; overflow: hidden; }
      .bar span { display: block; height: 100%; background: #209b70; }
      @media print { main { padding: 0; } button { display: none; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Microservices Inventory Management System</h1>
        <div class="meta">
          <p>${escapeHtml(dateRange.label)}: ${escapeHtml(dateRange.from.toLocaleDateString())} - ${escapeHtml(dateRange.to.toLocaleDateString())}</p>
          <p>Generated ${escapeHtml(reportDate)}</p>
        </div>
      </header>

      <section class="grid">
        <div class="card"><div class="label">Total Sales</div><div class="value">${escapeHtml(formatCurrency(sales?.totalSales ?? 0))}</div></div>
        <div class="card"><div class="label">Order Count</div><div class="value">${sales?.orderCount ?? 0}</div></div>
        <div class="card"><div class="label">Active SKUs</div><div class="value">${inventoryRows.length}</div></div>
      </section>

      <section class="charts">
        <div class="chart">
          <h2>Sales Trend</h2>
          ${buildSalesSvg(salesRows)}
        </div>
        <div class="chart">
          <h2>Inventory Distribution</h2>
          ${buildDistributionSvg(distribution)}
          <p class="muted">In stock: ${distribution.inStock} | Low stock: ${distribution.lowStock} | Out of stock: ${distribution.outOfStock}</p>
        </div>
      </section>

      <section>
        <h2>Sales By Day</h2>
        <table>
          <thead><tr><th>Date</th><th>Total Sales</th><th>Orders</th><th>Units Sold</th></tr></thead>
          <tbody>
            ${
              salesRows.length
                ? salesRows
                    .map(
                      (row) =>
                        `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(formatCurrency(row.totalSales))}</td><td>${row.orderCount}</td><td>${row.unitsSold}</td></tr>`,
                    )
                    .join('')
                : '<tr><td colspan="4" class="muted">No sales data for this range.</td></tr>'
            }
          </tbody>
        </table>
      </section>

      <section>
        <h2>Low Stock Alerts</h2>
        <table>
          <thead><tr><th>Product</th><th>Current Stock</th><th>Threshold</th><th>Created</th></tr></thead>
          <tbody>
            ${
              alertRows.length
                ? alertRows
                    .map(
                      (row) =>
                        `<tr><td>${escapeHtml(row.name)}</td><td class="danger">${row.stockLevel}</td><td>${row.reorderThreshold}</td><td>${escapeHtml(new Date(row.createdAt).toLocaleString())}</td></tr>`,
                    )
                    .join('')
                : '<tr><td colspan="4" class="muted">No low-stock alerts.</td></tr>'
            }
          </tbody>
        </table>
      </section>

      <section>
        <h2>Inventory Levels</h2>
        <table>
          <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Threshold</th><th>Status</th></tr></thead>
          <tbody>
            ${
              inventoryRows.length
                ? inventoryRows
                    .map(
                      (row) =>
                        `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.category)}</td><td>${row.stockLevel}</td><td>${row.reorderThreshold}</td><td>${row.lowStock ? 'Low stock' : 'In stock'}</td></tr>`,
                    )
                    .join('')
                : '<tr><td colspan="5" class="muted">No inventory records available.</td></tr>'
            }
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

function buildSalesSvg(rows: SalesReport['byDay']) {
  const maxSales = Math.max(1, ...rows.map((row) => row.totalSales));
  const points = rows.length
    ? rows
        .map((row, index) => {
          const x = rows.length === 1 ? 50 : 8 + (index / (rows.length - 1)) * 84;
          const y = 88 - (row.totalSales / maxSales) * 68;
          return `${x},${y}`;
        })
        .join(' ')
    : '8,88 92,88';

  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Sales trend chart">
    <polyline points="${points}" fill="none" stroke="#209b70" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>
    <polygon points="8,96 ${points} 92,96" fill="rgba(32,155,112,.12)"></polygon>
    <line x1="8" y1="88" x2="92" y2="88" stroke="#c8d1cb" stroke-width="1" vector-effect="non-scaling-stroke"></line>
  </svg>`;
}

function buildDistributionSvg(distribution: {
  inStock: number;
  lowStock: number;
  outOfStock: number;
  total: number;
}) {
  const inStockPercent =
    distribution.total === 0 ? 0 : Math.round((distribution.inStock / distribution.total) * 100);
  const lowPercent =
    distribution.total === 0 ? 0 : Math.round((distribution.lowStock / distribution.total) * 100);
  return `<svg viewBox="0 0 100 100" aria-label="Inventory distribution chart">
    <rect x="10" y="22" width="80" height="12" rx="6" fill="#e8eee9"></rect>
    <rect x="10" y="22" width="${inStockPercent * 0.8}" height="12" rx="6" fill="#209b70"></rect>
    <rect x="10" y="44" width="80" height="12" rx="6" fill="#e8eee9"></rect>
    <rect x="10" y="44" width="${lowPercent * 0.8}" height="12" rx="6" fill="#c65c55"></rect>
    <text x="10" y="75" fill="#1b211d" font-size="10">${inStockPercent}% in stock</text>
  </svg>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
