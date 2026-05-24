export type Role = 'ADMIN' | 'STAFF';
export type OrderStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SHIPPED';
export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'DECLINED' | 'REFUNDED';

export interface User {
  id?: string;
  sub?: string;
  username: string;
  role: Role;
  disabledAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  sku?: string;
  name: string;
  description?: string | null;
  category: string;
  price: number;
  stockLevel: number;
  reorderThreshold: number;
  imageUrl?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  products: Product[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  facets?: {
    categories: Array<{ category: string; count: number }>;
  };
}

export interface OrderItem {
  id: string;
  productId: string;
  productName?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerEmail?: string | null;
  customerAddress?: string | null;
  total: number;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  paymentReference?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  statusHistory?: Array<{
    id: string;
    status: OrderStatus;
    note?: string | null;
    createdAt: string;
  }>;
}

export interface OrderListResponse {
  orders: Order[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SalesReport {
  from: string;
  to: string;
  totalSales: number;
  orderCount: number;
  unitsSold: number;
  byDay: Array<{ date: string; totalSales: number; orderCount: number; unitsSold: number }>;
}

export interface InventoryReport {
  products: Array<{
    productId: string;
    name: string;
    category: string;
    stockLevel: number;
    reorderThreshold: number;
    lowStock: boolean;
    updatedAt: string;
  }>;
}

export interface StockAlertReport {
  alerts: Array<{
    id: string;
    productId: string;
    name: string;
    stockLevel: number;
    reorderThreshold: number;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

export interface Warehouse {
  id: string;
  name: string;
  region?: string | null;
  address?: string | null;
  totalStock: number;
  skuCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;
  type: string;
  delta: number;
  balanceAfter: number;
  referenceType?: string | null;
  referenceId?: string | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  productName?: string | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseOrder {
  id: string;
  supplierName: string;
  supplierEmail?: string | null;
  status: 'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED';
  expectedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItem[];
}

export interface WorkspaceNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'danger' | string;
  referenceType?: string | null;
  referenceId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId?: string | null;
  actorUsername?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AdvancedReport {
  from: string;
  to: string;
  stockValuation: {
    value: number;
    skuCount: number;
    lowStockCount: number;
  };
  fastMoving: Array<{
    productId: string;
    name: string;
    category: string;
    units: number;
    revenue: number;
  }>;
  deadStock: Product[];
  categoryRevenue: Array<{ category: string; revenue: number; units: number }>;
  reorderSuggestions: Array<{
    productId: string;
    name: string;
    category: string;
    stockLevel: number;
    reorderThreshold: number;
    suggestedQuantity: number;
    priority: string;
  }>;
  supplierPerformance: Array<{
    supplierName: string;
    purchaseOrders: number;
    received: number;
    cancelled: number;
    fulfilmentRate: number;
  }>;
  warehouseUtilization: Array<{
    id: string;
    name: string;
    region?: string | null;
    totalStock: number;
    skuCount: number;
  }>;
}
