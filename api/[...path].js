require('dotenv/config');

const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const schemas = {
  auth: 'auth_service',
  inventory: 'inventory_service',
  order: 'order_service',
  reporting: 'reporting_service',
};

const MAX_JSON_BODY_BYTES = 1_000_000;
const ORDER_STATUSES = new Set([
  'PENDING',
  'PROCESSING',
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'SHIPPED',
]);
const PURCHASE_ORDER_STATUSES = new Set(['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED']);
const PRODUCT_SORT_FIELDS = {
  name: '"name"',
  category: '"category"',
  price: '"price"',
  stockLevel: '"stockLevel"',
  createdAt: '"createdAt"',
  updatedAt: '"updatedAt"',
};

let pool;
let operationalSchemaPromise;

function getPool() {
  if (pool) return pool;
  const connectionString = cleanConnectionString(
    process.env.AUTH_DIRECT_URL || process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL,
  );
  if (!connectionString) {
    throw httpError(500, 'Database connection is not configured');
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  return pool;
}

function cleanConnectionString(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.search = '';
    return url.toString();
  } catch {
    throw httpError(500, 'Database connection string is invalid');
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendEmpty(res, status = 204) {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_JSON_BODY_BYTES) {
        rejected = true;
        reject(httpError(413, 'Request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (rejected) return;
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Request body must be valid JSON'));
      }
    });
  });
}

function parseUrl(req) {
  const url = new URL(req.url, 'https://inventory.local');
  const routedPath = url.searchParams.get('...path') || url.searchParams.get('path');
  const parts = (routedPath || url.pathname.replace(/^\/api\/?/, '')).split('/').filter(Boolean);
  return { url, parts };
}

function pageParams(url) {
  const page = positiveIntegerParam(url, 'page', 1);
  const limit = positiveIntegerParam(url, 'limit', 10, 100);
  return { page, limit, offset: (page - 1) * limit };
}

function positiveIntegerParam(url, name, fallback, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw httpError(400, `${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw httpError(400, `${name} must be a positive integer`);
  }
  return max ? Math.min(value, max) : value;
}

function optionalIntegerParam(url, name, options = {}) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  if (!/^-?\d+$/.test(raw)) throw httpError(400, `${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw httpError(400, `${name} must be an integer`);
  if (options.min !== undefined && value < options.min) {
    throw httpError(400, `${name} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw httpError(400, `${name} must be at most ${options.max}`);
  }
  return value;
}

function optionalNumberParam(url, name, options = {}) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw httpError(400, `${name} must be a valid number`);
  if (options.min !== undefined && value < options.min) {
    throw httpError(400, `${name} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw httpError(400, `${name} must be at most ${options.max}`);
  }
  return value;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function number(value) {
  return Number(value ?? 0);
}

function ensureObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'Request body must be a JSON object');
  }
  return value;
}

function textField(source, field, options = {}) {
  const { required = false, nullable = true, maxLength, label = field, trim = true } = options;
  if (source[field] === undefined) {
    if (required) throw httpError(400, `${label} is required`);
    return undefined;
  }
  if (source[field] === null) {
    if (required || !nullable) throw httpError(400, `${label} is required`);
    return null;
  }
  const value = trim ? String(source[field]).trim() : String(source[field]);
  if (!value) {
    if (required || !nullable) throw httpError(400, `${label} is required`);
    return null;
  }
  if (maxLength && value.length > maxLength) {
    throw httpError(400, `${label} must be at most ${maxLength} characters`);
  }
  return value;
}

function numberField(source, field, options = {}) {
  const { required = false, integer = false, min, label = field } = options;
  if (source[field] === undefined) {
    if (required) throw httpError(400, `${label} is required`);
    return undefined;
  }
  if (source[field] === null || source[field] === '') {
    throw httpError(400, `${label} must be a valid number`);
  }
  const value = Number(source[field]);
  if (!Number.isFinite(value)) throw httpError(400, `${label} must be a valid number`);
  if (integer && !Number.isInteger(value)) {
    throw httpError(400, `${label} must be an integer`);
  }
  if (min !== undefined && value < min) {
    throw httpError(400, `${label} must be at least ${min}`);
  }
  return value;
}

function optionalUrlField(source, field, options = {}) {
  const value = textField(source, field, options);
  if (value === undefined || value === null) return value;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
    return value;
  } catch {
    throw httpError(400, `${options.label || field} must be a valid URL`);
  }
}

function parseDateParam(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (!raw) return fallback;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw httpError(400, `${name} must be a valid date`);
  return date;
}

function reportDateRange(url) {
  const to = parseDateParam(url, 'to', new Date());
  const from = parseDateParam(url, 'from', new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000));
  if (from > to) throw httpError(400, 'from must be before or equal to to');
  return { from, to };
}

function productCode(productId) {
  return `SKU-${String(productId).replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim()) || rows.length === 0) rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])),
    );
}

function productsToCsv(products) {
  const headers = [
    'id',
    'sku',
    'name',
    'category',
    'price',
    'stockLevel',
    'reorderThreshold',
    'description',
    'imageUrl',
    'updatedAt',
  ];
  const lines = products.map((product) =>
    [
      product.id,
      productCode(product.id),
      product.name,
      product.category,
      product.price,
      product.stockLevel,
      product.reorderThreshold,
      product.description,
      product.imageUrl,
      product.updatedAt,
    ]
      .map(csvEscape)
      .join(','),
  );
  return [headers.join(','), ...lines].join('\n');
}

function productFromRow(row) {
  return {
    id: row.id,
    sku: productCode(row.id),
    name: row.name,
    description: row.description,
    category: row.category,
    price: number(row.price),
    stockLevel: row.stockLevel,
    reorderThreshold: row.reorderThreshold,
    imageUrl: row.imageUrl,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function orderFromRows(order, items, history) {
  return {
    id: order.id,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerAddress: order.customerAddress,
    total: number(order.total),
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentReference: order.paymentReference,
    failureReason: order.failureReason,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: number(item.unitPrice),
      lineTotal: number(item.lineTotal),
    })),
    statusHistory: history.map((item) => ({
      id: item.id,
      status: item.status,
      note: item.note,
      createdAt: iso(item.createdAt),
    })),
  };
}

function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw httpError(500, 'JWT secret is not configured');
  }
  return 'local-development-jwt-secret-change-in-prod';
}

function signUser(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, jwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
}

function verifyAuth(req, roles) {
  const [type, token] = String(req.headers.authorization || '').split(' ');
  if (type !== 'Bearer' || !token) throw httpError(401, 'Missing bearer token');
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (roles?.length && !roles.includes(payload.role)) {
      throw httpError(403, 'Insufficient role');
    }
    return payload;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(401, 'Invalid or expired token');
  }
}

async function getUserByUsername(client, username) {
  const result = await client.query(
    `select * from "${schemas.auth}"."User" where "username" = $1 limit 1`,
    [username],
  );
  return result.rows[0];
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabledAt: user.disabledAt ? iso(user.disabledAt) : null,
    createdAt: iso(user.createdAt),
    updatedAt: iso(user.updatedAt),
  };
}

async function ensureOperationalSchema() {
  if (!operationalSchemaPromise) {
    operationalSchemaPromise = initializeOperationalSchema().catch((error) => {
      operationalSchemaPromise = undefined;
      throw error;
    });
  }
  return operationalSchemaPromise;
}

async function initializeOperationalSchema() {
  const client = getPool();
  await client.query(
    `alter table "${schemas.auth}"."User" add column if not exists "disabledAt" timestamp`,
  );
  await client.query(`
    create table if not exists "${schemas.auth}"."AuditLog" (
      "id" text primary key,
      "actorId" text,
      "actorUsername" text,
      "action" text not null,
      "entityType" text not null,
      "entityId" text,
      "metadata" jsonb not null default '{}'::jsonb,
      "createdAt" timestamp not null default now()
    )
  `);
  await client.query(`
    create index if not exists "AuditLog_createdAt_idx"
    on "${schemas.auth}"."AuditLog" ("createdAt" desc)
  `);
  await client.query(`
    create table if not exists "${schemas.inventory}"."Warehouse" (
      "id" text primary key,
      "name" text not null unique,
      "region" text,
      "address" text,
      "createdAt" timestamp not null default now(),
      "updatedAt" timestamp not null default now()
    )
  `);
  await client.query(`
    create table if not exists "${schemas.inventory}"."ProductWarehouseStock" (
      "id" text primary key,
      "productId" text not null,
      "warehouseId" text not null,
      "stockLevel" integer not null default 0,
      "createdAt" timestamp not null default now(),
      "updatedAt" timestamp not null default now(),
      constraint "ProductWarehouseStock_product_warehouse_key" unique ("productId", "warehouseId")
    )
  `);
  await client.query(`
    create index if not exists "ProductWarehouseStock_productId_idx"
    on "${schemas.inventory}"."ProductWarehouseStock" ("productId")
  `);
  await client.query(`
    create table if not exists "${schemas.inventory}"."StockMovement" (
      "id" text primary key,
      "productId" text not null,
      "productName" text,
      "warehouseId" text,
      "warehouseName" text,
      "type" text not null,
      "delta" integer not null,
      "balanceAfter" integer not null,
      "referenceType" text,
      "referenceId" text,
      "note" text,
      "createdBy" text,
      "createdAt" timestamp not null default now()
    )
  `);
  await client.query(`
    create index if not exists "StockMovement_createdAt_idx"
    on "${schemas.inventory}"."StockMovement" ("createdAt" desc)
  `);
  await client.query(`
    create table if not exists "${schemas.inventory}"."PurchaseOrder" (
      "id" text primary key,
      "supplierName" text not null,
      "supplierEmail" text,
      "status" text not null default 'DRAFT',
      "expectedAt" timestamp,
      "createdBy" text,
      "createdAt" timestamp not null default now(),
      "updatedAt" timestamp not null default now()
    )
  `);
  await client.query(`
    create index if not exists "PurchaseOrder_status_idx"
    on "${schemas.inventory}"."PurchaseOrder" ("status")
  `);
  await client.query(`
    create table if not exists "${schemas.inventory}"."PurchaseOrderItem" (
      "id" text primary key,
      "purchaseOrderId" text not null,
      "productId" text not null,
      "productName" text,
      "quantity" integer not null,
      "unitCost" numeric(12, 2) not null default 0
    )
  `);
  await client.query(`
    create index if not exists "PurchaseOrderItem_purchaseOrderId_idx"
    on "${schemas.inventory}"."PurchaseOrderItem" ("purchaseOrderId")
  `);
  await client.query(`
    create table if not exists "${schemas.inventory}"."Notification" (
      "id" text primary key,
      "type" text not null,
      "title" text not null,
      "message" text not null,
      "severity" text not null default 'info',
      "referenceType" text,
      "referenceId" text,
      "readAt" timestamp,
      "createdAt" timestamp not null default now()
    )
  `);
  await client.query(`
    create index if not exists "Notification_createdAt_idx"
    on "${schemas.inventory}"."Notification" ("createdAt" desc)
  `);

  const defaultWarehouse = await client.query(
    `insert into "${schemas.inventory}"."Warehouse" ("id", "name", "region", "address", "createdAt", "updatedAt")
     values ($1, 'Primary Warehouse', 'India', 'Default fulfilment location', now(), now())
     on conflict ("name") do update set "updatedAt" = now()
     returning *`,
    [randomUUID()],
  );
  await client.query(
    `insert into "${schemas.inventory}"."ProductWarehouseStock"
       ("id", "productId", "warehouseId", "stockLevel", "createdAt", "updatedAt")
     select md5(p."id" || $1), p."id", $1, p."stockLevel", now(), now()
     from "${schemas.inventory}"."Product" p
     on conflict ("productId", "warehouseId") do nothing`,
    [defaultWarehouse.rows[0].id],
  );
}

async function recordAudit(client, user, action, entityType, entityId, metadata = {}) {
  await client.query(
    `insert into "${schemas.auth}"."AuditLog"
     ("id", "actorId", "actorUsername", "action", "entityType", "entityId", "metadata", "createdAt")
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())`,
    [
      randomUUID(),
      user?.sub || user?.id || null,
      user?.username || null,
      action,
      entityType,
      entityId || null,
      JSON.stringify(metadata),
    ],
  );
}

async function createNotification(client, payload) {
  const result = await client.query(
    `insert into "${schemas.inventory}"."Notification"
     ("id", "type", "title", "message", "severity", "referenceType", "referenceId", "createdAt")
     values ($1, $2, $3, $4, $5, $6, $7, now())
     returning *`,
    [
      randomUUID(),
      payload.type,
      payload.title,
      payload.message,
      payload.severity || 'info',
      payload.referenceType || null,
      payload.referenceId || null,
    ],
  );
  return notificationFromRow(result.rows[0]);
}

async function defaultWarehouse(client) {
  const result = await client.query(
    `select * from "${schemas.inventory}"."Warehouse" where "name" = 'Primary Warehouse' limit 1`,
  );
  return result.rows[0];
}

async function upsertWarehouseStock(client, productId, warehouseId, delta, fallbackBalance) {
  const result = await client.query(
    `insert into "${schemas.inventory}"."ProductWarehouseStock"
       ("id", "productId", "warehouseId", "stockLevel", "createdAt", "updatedAt")
     values ($1, $2, $3, greatest(0, $4), now(), now())
     on conflict ("productId", "warehouseId")
     do update set "stockLevel" = greatest(0, "ProductWarehouseStock"."stockLevel" + $5),
                   "updatedAt" = now()
     returning *`,
    [randomUUID(), productId, warehouseId, fallbackBalance, delta],
  );
  return result.rows[0];
}

async function recordStockMovement(client, payload) {
  const result = await client.query(
    `insert into "${schemas.inventory}"."StockMovement"
     ("id", "productId", "productName", "warehouseId", "warehouseName", "type", "delta", "balanceAfter", "referenceType", "referenceId", "note", "createdBy", "createdAt")
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     returning *`,
    [
      randomUUID(),
      payload.productId,
      payload.productName || null,
      payload.warehouseId || null,
      payload.warehouseName || null,
      payload.type,
      payload.delta,
      payload.balanceAfter,
      payload.referenceType || null,
      payload.referenceId || null,
      payload.note || null,
      payload.createdBy || null,
    ],
  );
  return stockMovementFromRow(result.rows[0]);
}

function notificationFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    severity: row.severity,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    readAt: row.readAt ? iso(row.readAt) : null,
    createdAt: iso(row.createdAt),
  };
}

function stockMovementFromRow(row) {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    type: row.type,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

function purchaseOrderFromRows(order, items) {
  return {
    id: order.id,
    supplierName: order.supplierName,
    supplierEmail: order.supplierEmail,
    status: order.status,
    expectedAt: order.expectedAt ? iso(order.expectedAt) : null,
    createdBy: order.createdBy,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
    items: items.map((item) => ({
      id: item.id,
      purchaseOrderId: item.purchaseOrderId,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitCost: number(item.unitCost),
      lineTotal: number(item.unitCost) * item.quantity,
    })),
  };
}

async function handleAuth(req, res, parts) {
  const client = getPool();
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'login') {
    const body = ensureObject(await parseBody(req));
    const user = await getUserByUsername(client, String(body.username || ''));
    if (!user || !(await bcrypt.compare(String(body.password || ''), user.passwordHash))) {
      throw httpError(401, 'Invalid username or password');
    }
    if (user.disabledAt) throw httpError(403, 'User account is disabled');
    send(res, 200, { token: signUser(user), user: safeUser(user) });
    return true;
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'register') {
    const body = ensureObject(await parseBody(req));
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'ADMIN' ? 'ADMIN' : 'STAFF';
    if (username.length < 3) throw httpError(400, 'Username must be at least 3 characters');
    if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters');
    if (role === 'ADMIN' && process.env.ALLOW_PUBLIC_ADMIN_REGISTRATION !== 'true') {
      throw httpError(403, 'Admin users must be provisioned by an existing administrator');
    }
    if (await getUserByUsername(client, username)) {
      throw httpError(409, 'Username is already registered');
    }
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `insert into "${schemas.auth}"."User"
       ("id", "username", "passwordHash", "role", "createdAt", "updatedAt")
       values ($1, $2, $3, $4::"${schemas.auth}"."Role", now(), now())
       returning *`,
      [id, username, passwordHash, role],
    );
    send(res, 201, { user: safeUser(result.rows[0]) });
    return true;
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'me') {
    send(res, 200, { user: verifyAuth(req) });
    return true;
  }

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'verify') {
    send(res, 200, { user: verifyAuth(req) });
    return true;
  }

  return false;
}

async function listProducts(url) {
  const client = getPool();
  const { page, limit, offset } = pageParams(url);
  const filters = [];
  const params = [];
  const search = url.searchParams.get('search')?.trim();
  const category = url.searchParams.get('category')?.trim();
  const stockStatus = url.searchParams.get('stockStatus')?.trim();
  const minStock = optionalIntegerParam(url, 'minStock', { min: 0 });
  const maxStock = optionalIntegerParam(url, 'maxStock', { min: 0 });
  const minPrice = optionalNumberParam(url, 'minPrice', { min: 0 });
  const maxPrice = optionalNumberParam(url, 'maxPrice', { min: 0 });
  const sortBy = url.searchParams.get('sortBy')?.trim() || 'createdAt';
  const sortDir = url.searchParams.get('sortDir')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
  const orderField = PRODUCT_SORT_FIELDS[sortBy] || PRODUCT_SORT_FIELDS.createdAt;
  if (category) {
    params.push(category);
    filters.push(`lower("category") = lower($${params.length})`);
  }
  if (search) {
    params.push(`%${search}%`);
    filters.push(
      `("name" ilike $${params.length} or "description" ilike $${params.length} or "category" ilike $${params.length})`,
    );
  }
  if (stockStatus) {
    if (!['in', 'low', 'out'].includes(stockStatus)) throw httpError(400, 'Invalid stockStatus');
    if (stockStatus === 'out') filters.push(`"stockLevel" = 0`);
    if (stockStatus === 'low')
      filters.push(`"stockLevel" > 0 and "stockLevel" < "reorderThreshold"`);
    if (stockStatus === 'in') filters.push(`"stockLevel" >= "reorderThreshold"`);
  }
  if (minStock !== undefined) {
    params.push(minStock);
    filters.push(`"stockLevel" >= $${params.length}`);
  }
  if (maxStock !== undefined) {
    params.push(maxStock);
    filters.push(`"stockLevel" <= $${params.length}`);
  }
  if (minPrice !== undefined) {
    params.push(minPrice);
    filters.push(`"price" >= $${params.length}`);
  }
  if (maxPrice !== undefined) {
    params.push(maxPrice);
    filters.push(`"price" <= $${params.length}`);
  }
  const where = filters.length ? `where ${filters.join(' and ')}` : '';
  const countResult = await client.query(
    `select count(*)::int as count from "${schemas.inventory}"."Product" ${where}`,
    params,
  );
  const productsResult = await client.query(
    `select * from "${schemas.inventory}"."Product"
     ${where}
     order by ${orderField} ${sortDir}
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  const facetsResult = await client.query(
    `select "category", count(*)::int as count
     from "${schemas.inventory}"."Product"
     ${where}
     group by "category"
     order by "category" asc`,
    params,
  );
  const total = countResult.rows[0].count;
  return {
    products: productsResult.rows.map(productFromRow),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    facets: {
      categories: facetsResult.rows.map((row) => ({
        category: row.category,
        count: row.count,
      })),
    },
  };
}

async function getProduct(id) {
  const result = await getPool().query(
    `select * from "${schemas.inventory}"."Product" where "id" = $1`,
    [id],
  );
  if (!result.rows[0]) throw httpError(404, 'Product not found');
  return productFromRow(result.rows[0]);
}

function validateProductPayload(body, partial = false) {
  ensureObject(body);
  const payload = {};

  const name = textField(body, 'name', {
    required: !partial,
    nullable: false,
    maxLength: 160,
  });
  if (name !== undefined) payload.name = name;

  const description = textField(body, 'description', { maxLength: 2000 });
  if (description !== undefined) payload.description = description;

  const category = textField(body, 'category', {
    required: !partial,
    nullable: false,
    maxLength: 100,
  });
  if (category !== undefined) payload.category = category;

  const imageUrl = optionalUrlField(body, 'imageUrl', { maxLength: 2048 });
  if (imageUrl !== undefined) payload.imageUrl = imageUrl;

  const price = numberField(body, 'price', { required: !partial, min: 0 });
  if (price !== undefined) payload.price = price;

  const stockLevel = numberField(body, 'stockLevel', {
    required: !partial,
    integer: true,
    min: 0,
  });
  if (stockLevel !== undefined) payload.stockLevel = stockLevel;

  const reorderThreshold = numberField(body, 'reorderThreshold', {
    required: !partial,
    integer: true,
    min: 0,
  });
  if (reorderThreshold !== undefined) payload.reorderThreshold = reorderThreshold;

  return payload;
}

async function exportProducts(url) {
  const rows = [];
  const exportUrl = new URL(url.toString());
  exportUrl.searchParams.set('limit', '100');
  for (let page = 1; page <= 50; page += 1) {
    exportUrl.searchParams.set('page', String(page));
    const data = await listProducts(exportUrl);
    rows.push(...data.products);
    if (page >= data.totalPages) break;
  }
  return {
    filename: `products-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: productsToCsv(rows),
    count: rows.length,
  };
}

function validateImportRows(body) {
  ensureObject(body);
  const rows = Array.isArray(body.rows)
    ? body.rows
    : typeof body.csv === 'string'
      ? parseCsv(body.csv)
      : [];
  if (!rows.length) throw httpError(400, 'Import must include CSV text or row objects');
  if (rows.length > 500) throw httpError(400, 'Import is limited to 500 products at a time');
  return rows.map((row, index) =>
    validateProductPayload(
      {
        name: row.name,
        description: row.description || undefined,
        category: row.category,
        price: row.price,
        stockLevel: row.stockLevel,
        reorderThreshold: row.reorderThreshold,
        imageUrl: row.imageUrl || undefined,
      },
      false,
      `row ${index + 1}`,
    ),
  );
}

async function handleProducts(req, res, parts, url) {
  if (
    req.method === 'GET' &&
    parts.length === 2 &&
    parts[0] === 'public' &&
    parts[1] === 'products'
  ) {
    send(res, 200, await listProducts(url));
    return true;
  }

  if (parts[0] !== 'products') return false;
  if (req.method === 'GET' && parts.length === 1) {
    verifyAuth(req);
    send(res, 200, await listProducts(url));
    return true;
  }
  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'export') {
    verifyAuth(req, ['ADMIN', 'STAFF']);
    send(res, 200, await exportProducts(url));
    return true;
  }
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'import') {
    const user = verifyAuth(req, ['ADMIN']);
    const rows = validateImportRows(await parseBody(req));
    const tx = await getPool().connect();
    try {
      await tx.query('begin');
      const warehouse = await defaultWarehouse(tx);
      const created = [];
      for (const body of rows) {
        const id = randomUUID();
        const result = await tx.query(
          `insert into "${schemas.inventory}"."Product"
           ("id", "name", "description", "price", "category", "stockLevel", "reorderThreshold", "imageUrl", "version", "createdAt", "updatedAt")
           values ($1, $2, $3, $4, $5, $6, $7, $8, 1, now(), now())
           returning *`,
          [
            id,
            body.name,
            body.description,
            body.price,
            body.category,
            body.stockLevel,
            body.reorderThreshold,
            body.imageUrl,
          ],
        );
        const product = result.rows[0];
        await upsertWarehouseStock(tx, product.id, warehouse.id, body.stockLevel, body.stockLevel);
        await recordStockMovement(tx, {
          productId: product.id,
          productName: product.name,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          type: 'IMPORT_OPENING',
          delta: body.stockLevel,
          balanceAfter: body.stockLevel,
          referenceType: 'IMPORT',
          referenceId: product.id,
          note: 'Bulk product import',
          createdBy: user.username,
        });
        created.push(productFromRow(product));
      }
      await recordAudit(tx, user, 'IMPORT_PRODUCTS', 'Product', null, { count: created.length });
      await createNotification(tx, {
        type: 'IMPORT',
        title: 'Products imported',
        message: `${created.length} products were imported into inventory.`,
        severity: 'success',
        referenceType: 'Product',
      });
      await tx.query('commit');
      send(res, 201, { imported: created.length, products: created });
    } catch (error) {
      await tx.query('rollback');
      throw error;
    } finally {
      tx.release();
    }
    return true;
  }
  if (req.method === 'GET' && parts.length === 2) {
    verifyAuth(req);
    send(res, 200, await getProduct(parts[1]));
    return true;
  }
  if (req.method === 'POST' && parts.length === 1) {
    const user = verifyAuth(req, ['ADMIN']);
    const body = validateProductPayload(await parseBody(req));
    const id = randomUUID();
    const tx = await getPool().connect();
    try {
      await tx.query('begin');
      const result = await tx.query(
        `insert into "${schemas.inventory}"."Product"
         ("id", "name", "description", "price", "category", "stockLevel", "reorderThreshold", "imageUrl", "version", "createdAt", "updatedAt")
         values ($1, $2, $3, $4, $5, $6, $7, $8, 1, now(), now())
         returning *`,
        [
          id,
          body.name,
          body.description,
          body.price,
          body.category,
          body.stockLevel,
          body.reorderThreshold,
          body.imageUrl,
        ],
      );
      const product = result.rows[0];
      const warehouse = await defaultWarehouse(tx);
      await upsertWarehouseStock(tx, product.id, warehouse.id, body.stockLevel, body.stockLevel);
      if (body.stockLevel) {
        await recordStockMovement(tx, {
          productId: product.id,
          productName: product.name,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          type: 'OPENING_STOCK',
          delta: body.stockLevel,
          balanceAfter: body.stockLevel,
          referenceType: 'Product',
          referenceId: product.id,
          note: 'Product created',
          createdBy: user.username,
        });
      }
      await recordAudit(tx, user, 'CREATE_PRODUCT', 'Product', product.id, { name: product.name });
      await tx.query('commit');
      send(res, 201, productFromRow(product));
    } catch (error) {
      await tx.query('rollback');
      throw error;
    } finally {
      tx.release();
    }
    return true;
  }
  if (req.method === 'PUT' && parts.length === 2) {
    const user = verifyAuth(req, ['ADMIN']);
    const body = validateProductPayload(await parseBody(req), true);
    const fields = [];
    const params = [];
    for (const [field, value] of Object.entries(body)) {
      params.push(value);
      fields.push(`"${field}" = $${params.length}`);
    }
    if (!fields.length) {
      send(res, 200, await getProduct(parts[1]));
      return true;
    }
    params.push(parts[1]);
    const result = await getPool().query(
      `update "${schemas.inventory}"."Product"
       set ${fields.join(', ')}, "version" = "version" + 1, "updatedAt" = now()
       where "id" = $${params.length}
       returning *`,
      params,
    );
    if (!result.rows[0]) throw httpError(404, 'Product not found');
    await recordAudit(getPool(), user, 'UPDATE_PRODUCT', 'Product', parts[1], {
      fields: Object.keys(body),
    });
    send(res, 200, productFromRow(result.rows[0]));
    return true;
  }
  if (req.method === 'DELETE' && parts.length === 2) {
    const user = verifyAuth(req, ['ADMIN']);
    const product = await getProduct(parts[1]);
    const result = await getPool().query(
      `delete from "${schemas.inventory}"."Product" where "id" = $1`,
      [parts[1]],
    );
    if (result.rowCount === 0) throw httpError(404, 'Product not found');
    await recordAudit(getPool(), user, 'DELETE_PRODUCT', 'Product', parts[1], {
      name: product.name,
    });
    await createNotification(getPool(), {
      type: 'PRODUCT_DELETED',
      title: 'Product deleted',
      message: `${product.name} was removed from the catalog.`,
      severity: 'warning',
      referenceType: 'Product',
      referenceId: parts[1],
    });
    sendEmpty(res);
    return true;
  }

  return false;
}

async function handleInventory(req, res, parts) {
  if (
    parts[0] !== 'inventory' ||
    req.method !== 'PUT' ||
    parts.length !== 3 ||
    parts[2] !== 'stock'
  ) {
    return false;
  }
  const user = verifyAuth(req, ['ADMIN']);
  const body = ensureObject(await parseBody(req));
  const delta = numberField(body, 'delta', { required: true, integer: true });
  if (delta === 0) throw httpError(400, 'Stock delta cannot be zero');
  const note = textField(body, 'note', { maxLength: 300 });
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const current = await client.query(
      `select * from "${schemas.inventory}"."Product" where "id" = $1 for update`,
      [parts[1]],
    );
    const product = current.rows[0];
    if (!product) throw httpError(404, 'Product not found');
    const expectedVersion = numberField(body, 'expectedVersion', { integer: true, min: 1 });
    if (expectedVersion !== undefined && expectedVersion !== product.version) {
      throw httpError(409, 'Product version has changed');
    }
    const nextStock = product.stockLevel + delta;
    if (nextStock < 0) throw httpError(400, 'Stock cannot be negative');
    const warehouseId =
      textField(body, 'warehouseId', { maxLength: 100 }) || (await defaultWarehouse(client)).id;
    const warehouseResult = await client.query(
      `select * from "${schemas.inventory}"."Warehouse" where "id" = $1`,
      [warehouseId],
    );
    const warehouse = warehouseResult.rows[0];
    if (!warehouse) throw httpError(404, 'Warehouse not found');
    const updated = await client.query(
      `update "${schemas.inventory}"."Product"
       set "stockLevel" = $1, "version" = "version" + 1, "updatedAt" = now()
       where "id" = $2
       returning *`,
      [nextStock, parts[1]],
    );
    await upsertWarehouseStock(client, parts[1], warehouse.id, delta, nextStock);
    await recordStockMovement(client, {
      productId: product.id,
      productName: product.name,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      type: 'MANUAL_ADJUSTMENT',
      delta,
      balanceAfter: nextStock,
      referenceType: 'Product',
      referenceId: product.id,
      note: note || 'Manual stock adjustment',
      createdBy: user.username,
    });
    await recordAudit(client, user, 'ADJUST_STOCK', 'Product', product.id, {
      delta,
      balanceAfter: nextStock,
      warehouseId: warehouse.id,
    });
    if (nextStock < product.reorderThreshold) {
      await createNotification(client, {
        type: 'LOW_STOCK',
        title: 'Low stock alert',
        message: `${product.name} has ${nextStock} units left against threshold ${product.reorderThreshold}.`,
        severity: nextStock === 0 ? 'danger' : 'warning',
        referenceType: 'Product',
        referenceId: product.id,
      });
    }
    await client.query('commit');
    send(res, 200, productFromRow(updated.rows[0]));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return true;
}

async function loadOrders(whereSql, params, limit, offset) {
  const client = getPool();
  const countResult = await client.query(
    `select count(*)::int as count from "${schemas.order}"."Order" ${whereSql}`,
    params,
  );
  const ordersResult = await client.query(
    `select * from "${schemas.order}"."Order"
     ${whereSql}
     order by "createdAt" desc
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  const orderIds = ordersResult.rows.map((row) => row.id);
  if (!orderIds.length) return { orders: [], total: countResult.rows[0].count };
  const items = await client.query(
    `select * from "${schemas.order}"."OrderItem" where "orderId" = any($1) order by "id" asc`,
    [orderIds],
  );
  const history = await client.query(
    `select * from "${schemas.order}"."OrderStatusHistory" where "orderId" = any($1) order by "createdAt" asc`,
    [orderIds],
  );
  return {
    orders: ordersResult.rows.map((order) =>
      orderFromRows(
        order,
        items.rows.filter((item) => item.orderId === order.id),
        history.rows.filter((item) => item.orderId === order.id),
      ),
    ),
    total: countResult.rows[0].count,
  };
}

function validateOrderPayload(body) {
  ensureObject(body);
  const customerName = textField(body, 'customerName', {
    required: true,
    nullable: false,
    maxLength: 160,
  });
  const customerEmail = textField(body, 'customerEmail', { maxLength: 320 });
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw httpError(400, 'customerEmail must be a valid email address');
  }
  const customerAddress = textField(body, 'customerAddress', { maxLength: 500 });
  if (!Array.isArray(body.items) || !body.items.length) {
    throw httpError(400, 'At least one order item is required');
  }

  const seen = new Set();
  const items = body.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw httpError(400, `items[${index}] must be an object`);
    }
    const productId = textField(item, 'productId', {
      required: true,
      nullable: false,
      maxLength: 100,
      label: `items[${index}].productId`,
    });
    if (seen.has(productId)) {
      throw httpError(400, 'Duplicate product IDs are not allowed in a single order');
    }
    seen.add(productId);
    const quantity = numberField(item, 'quantity', {
      required: true,
      integer: true,
      min: 1,
      label: `items[${index}].quantity`,
    });
    return { productId, quantity };
  });

  return {
    customerName,
    customerEmail,
    customerAddress,
    items,
  };
}

async function handleOrders(req, res, parts, url) {
  if (parts[0] !== 'orders') return false;
  const user = verifyAuth(req, ['ADMIN', 'STAFF']);
  const client = getPool();

  if (req.method === 'GET' && parts.length === 1) {
    const { page, limit, offset } = pageParams(url);
    const status = url.searchParams.get('status')?.trim();
    if (status && !ORDER_STATUSES.has(status)) throw httpError(400, 'Invalid order status');
    const params = [];
    const whereSql = status ? `where "status" = $1::"${schemas.order}"."OrderStatus"` : '';
    if (status) params.push(status);
    const data = await loadOrders(whereSql, params, limit, offset);
    send(res, 200, {
      orders: data.orders,
      page,
      limit,
      total: data.total,
      totalPages: Math.ceil(data.total / limit),
    });
    return true;
  }

  if (req.method === 'GET' && parts.length === 2) {
    const data = await loadOrders('where "id" = $1', [parts[1]], 1, 0);
    if (!data.orders[0]) throw httpError(404, 'Order not found');
    send(res, 200, data.orders[0]);
    return true;
  }

  if (req.method === 'POST' && parts.length === 1) {
    const body = validateOrderPayload(await parseBody(req));
    const items = body.items;

    const tx = await client.connect();
    try {
      await tx.query('begin');
      const warehouse = await defaultWarehouse(tx);
      const productIds = items.map((item) => item.productId);
      const productResult = await tx.query(
        `select * from "${schemas.inventory}"."Product" where "id" = any($1) for update`,
        [productIds],
      );
      const products = new Map(productResult.rows.map((row) => [row.id, row]));
      let total = 0;
      const orderItems = items.map((item) => {
        const product = products.get(item.productId);
        if (!product) throw httpError(400, `Product ${item.productId} was not found`);
        const quantity = Number(item.quantity);
        if (product.stockLevel < quantity)
          throw httpError(400, `${product.name} does not have enough stock`);
        const unitPrice = number(product.price);
        const lineTotal = quantity * unitPrice;
        total += lineTotal;
        return { product, quantity, unitPrice, lineTotal };
      });

      const orderId = randomUUID();
      for (const item of orderItems) {
        const nextStock = item.product.stockLevel - item.quantity;
        await tx.query(
          `update "${schemas.inventory}"."Product"
           set "stockLevel" = "stockLevel" - $1, "version" = "version" + 1, "updatedAt" = now()
           where "id" = $2`,
          [item.quantity, item.product.id],
        );
        await upsertWarehouseStock(tx, item.product.id, warehouse.id, -item.quantity, nextStock);
        await recordStockMovement(tx, {
          productId: item.product.id,
          productName: item.product.name,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          type: 'ORDER_RESERVATION',
          delta: -item.quantity,
          balanceAfter: nextStock,
          referenceType: 'Order',
          referenceId: orderId,
          note: `Reserved for order ${orderId.slice(0, 8).toUpperCase()}`,
          createdBy: user.username,
        });
        if (nextStock < item.product.reorderThreshold) {
          await createNotification(tx, {
            type: 'LOW_STOCK',
            title: 'Low stock after order',
            message: `${item.product.name} dropped to ${nextStock} units after order confirmation.`,
            severity: nextStock === 0 ? 'danger' : 'warning',
            referenceType: 'Product',
            referenceId: item.product.id,
          });
        }
      }

      const paymentReference = `PAY-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const orderResult = await tx.query(
        `insert into "${schemas.order}"."Order"
         ("id", "customerName", "customerEmail", "customerAddress", "total", "status", "paymentStatus", "paymentReference", "failureReason", "createdAt", "updatedAt")
         values ($1, $2, $3, $4, $5, $6::"${schemas.order}"."OrderStatus", $7::"${schemas.order}"."PaymentStatus", $8, null, now(), now())
         returning *`,
        [
          orderId,
          body.customerName,
          body.customerEmail,
          body.customerAddress,
          total,
          'CONFIRMED',
          'AUTHORIZED',
          paymentReference,
        ],
      );
      for (const item of orderItems) {
        await tx.query(
          `insert into "${schemas.order}"."OrderItem"
           ("id", "orderId", "productId", "productName", "quantity", "unitPrice", "lineTotal")
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            orderId,
            item.product.id,
            item.product.name,
            item.quantity,
            item.unitPrice,
            item.lineTotal,
          ],
        );
      }
      await tx.query(
        `insert into "${schemas.order}"."OrderStatusHistory"
         ("id", "orderId", "status", "note", "createdAt")
         values ($1, $2, $3::"${schemas.order}"."OrderStatus", $4, now())`,
        [
          randomUUID(),
          orderId,
          'CONFIRMED',
          `Payment authorized (${paymentReference}) and stock reserved`,
        ],
      );
      await recordAudit(tx, user, 'CREATE_ORDER', 'Order', orderId, {
        customerName: body.customerName,
        itemCount: orderItems.length,
        total,
      });
      await createNotification(tx, {
        type: 'ORDER_CREATED',
        title: 'Order confirmed',
        message: `Order ${orderId.slice(0, 8).toUpperCase()} was confirmed for ${body.customerName}.`,
        severity: 'success',
        referenceType: 'Order',
        referenceId: orderId,
      });
      await tx.query('commit');
      const data = await loadOrders('where "id" = $1', [orderResult.rows[0].id], 1, 0);
      send(res, 201, data.orders[0]);
    } catch (error) {
      await tx.query('rollback');
      throw error;
    } finally {
      tx.release();
    }
    return true;
  }

  if (req.method === 'PUT' && parts.length === 3 && parts[2] === 'status') {
    const body = ensureObject(await parseBody(req));
    const status = String(body.status || '');
    if (!ORDER_STATUSES.has(status)) {
      throw httpError(400, 'Invalid order status');
    }
    const result = await client.query(
      `update "${schemas.order}"."Order"
       set "status" = $1::"${schemas.order}"."OrderStatus", "updatedAt" = now()
       where "id" = $2
       returning *`,
      [status, parts[1]],
    );
    if (!result.rows[0]) throw httpError(404, 'Order not found');
    await client.query(
      `insert into "${schemas.order}"."OrderStatusHistory"
       ("id", "orderId", "status", "note", "createdAt")
       values ($1, $2, $3::"${schemas.order}"."OrderStatus", 'Manual status update', now())`,
      [randomUUID(), parts[1], status],
    );
    await recordAudit(client, user, 'UPDATE_ORDER_STATUS', 'Order', parts[1], { status });
    await createNotification(client, {
      type: 'ORDER_STATUS',
      title: 'Order status updated',
      message: `Order ${parts[1].slice(0, 8).toUpperCase()} moved to ${status}.`,
      severity: status === 'FAILED' || status === 'CANCELLED' ? 'warning' : 'info',
      referenceType: 'Order',
      referenceId: parts[1],
    });
    const data = await loadOrders('where "id" = $1', [parts[1]], 1, 0);
    send(res, 200, data.orders[0]);
    return true;
  }

  if (req.method === 'DELETE' && parts.length === 2) {
    verifyAuth(req, ['ADMIN']);
    const result = await client.query(`delete from "${schemas.order}"."Order" where "id" = $1`, [
      parts[1],
    ]);
    if (result.rowCount === 0) throw httpError(404, 'Order not found');
    await recordAudit(client, user, 'DELETE_ORDER', 'Order', parts[1]);
    sendEmpty(res);
    return true;
  }

  return false;
}

async function handleWarehouses(req, res, parts) {
  if (parts[0] !== 'warehouses') return false;
  const user = verifyAuth(req, ['ADMIN', 'STAFF']);
  const client = getPool();

  if (req.method === 'GET' && parts.length === 1) {
    const result = await client.query(
      `select w.*,
              coalesce(sum(s."stockLevel"), 0)::int as "totalStock",
              count(s."productId")::int as "skuCount"
       from "${schemas.inventory}"."Warehouse" w
       left join "${schemas.inventory}"."ProductWarehouseStock" s on s."warehouseId" = w."id"
       group by w."id"
       order by w."name" asc`,
    );
    send(res, 200, {
      warehouses: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        region: row.region,
        address: row.address,
        totalStock: row.totalStock,
        skuCount: row.skuCount,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      })),
    });
    return true;
  }

  if (req.method === 'POST' && parts.length === 1) {
    verifyAuth(req, ['ADMIN']);
    const body = ensureObject(await parseBody(req));
    const name = textField(body, 'name', { required: true, nullable: false, maxLength: 120 });
    const region = textField(body, 'region', { maxLength: 120 });
    const address = textField(body, 'address', { maxLength: 500 });
    const result = await client.query(
      `insert into "${schemas.inventory}"."Warehouse"
       ("id", "name", "region", "address", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, now(), now())
       on conflict ("name") do update set "region" = excluded."region",
                                     "address" = excluded."address",
                                     "updatedAt" = now()
       returning *`,
      [randomUUID(), name, region, address],
    );
    await recordAudit(client, user, 'UPSERT_WAREHOUSE', 'Warehouse', result.rows[0].id, { name });
    send(res, 201, {
      warehouse: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        region: result.rows[0].region,
        address: result.rows[0].address,
        totalStock: 0,
        skuCount: 0,
        createdAt: iso(result.rows[0].createdAt),
        updatedAt: iso(result.rows[0].updatedAt),
      },
    });
    return true;
  }

  return false;
}

async function handleStockMovements(req, res, parts, url) {
  if (parts[0] !== 'stock-movements' || req.method !== 'GET' || parts.length !== 1) return false;
  verifyAuth(req, ['ADMIN', 'STAFF']);
  const { page, limit, offset } = pageParams(url);
  const params = [];
  const filters = [];
  const productId = url.searchParams.get('productId')?.trim();
  const type = url.searchParams.get('type')?.trim();
  if (productId) {
    params.push(productId);
    filters.push(`"productId" = $${params.length}`);
  }
  if (type) {
    params.push(type);
    filters.push(`"type" = $${params.length}`);
  }
  const where = filters.length ? `where ${filters.join(' and ')}` : '';
  const count = await getPool().query(
    `select count(*)::int as count from "${schemas.inventory}"."StockMovement" ${where}`,
    params,
  );
  const result = await getPool().query(
    `select * from "${schemas.inventory}"."StockMovement"
     ${where}
     order by "createdAt" desc
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  send(res, 200, {
    movements: result.rows.map(stockMovementFromRow),
    page,
    limit,
    total: count.rows[0].count,
    totalPages: Math.ceil(count.rows[0].count / limit),
  });
  return true;
}

function validatePurchaseOrderPayload(body) {
  ensureObject(body);
  const supplierName = textField(body, 'supplierName', {
    required: true,
    nullable: false,
    maxLength: 160,
  });
  const supplierEmail = textField(body, 'supplierEmail', { maxLength: 320 });
  if (supplierEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail)) {
    throw httpError(400, 'supplierEmail must be a valid email address');
  }
  const expectedAt = body.expectedAt
    ? parseDateParam(new URL(`https://inventory.local/?d=${body.expectedAt}`), 'd')
    : null;
  if (!Array.isArray(body.items) || !body.items.length) {
    throw httpError(400, 'At least one purchase order item is required');
  }
  const items = body.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw httpError(400, `items[${index}] must be an object`);
    }
    return {
      productId: textField(item, 'productId', {
        required: true,
        nullable: false,
        maxLength: 100,
        label: `items[${index}].productId`,
      }),
      quantity: numberField(item, 'quantity', {
        required: true,
        integer: true,
        min: 1,
        label: `items[${index}].quantity`,
      }),
      unitCost: numberField(item, 'unitCost', { min: 0, label: `items[${index}].unitCost` }) ?? 0,
    };
  });
  return { supplierName, supplierEmail, expectedAt, items };
}

async function loadPurchaseOrders(whereSql = '', params = [], limit = 20, offset = 0) {
  const client = getPool();
  const count = await client.query(
    `select count(*)::int as count from "${schemas.inventory}"."PurchaseOrder" ${whereSql}`,
    params,
  );
  const orders = await client.query(
    `select * from "${schemas.inventory}"."PurchaseOrder"
     ${whereSql}
     order by "createdAt" desc
     limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  const ids = orders.rows.map((row) => row.id);
  const items = ids.length
    ? await client.query(
        `select * from "${schemas.inventory}"."PurchaseOrderItem"
         where "purchaseOrderId" = any($1)
         order by "id" asc`,
        [ids],
      )
    : { rows: [] };
  return {
    purchaseOrders: orders.rows.map((order) =>
      purchaseOrderFromRows(
        order,
        items.rows.filter((item) => item.purchaseOrderId === order.id),
      ),
    ),
    total: count.rows[0].count,
  };
}

async function handlePurchaseOrders(req, res, parts, url) {
  if (parts[0] !== 'purchase-orders') return false;
  const user = verifyAuth(req, ['ADMIN', 'STAFF']);
  const client = getPool();

  if (req.method === 'GET' && parts.length === 1) {
    const { page, limit, offset } = pageParams(url);
    const status = url.searchParams.get('status')?.trim();
    if (status && !PURCHASE_ORDER_STATUSES.has(status))
      throw httpError(400, 'Invalid purchase order status');
    const params = [];
    const whereSql = status ? `where "status" = $1` : '';
    if (status) params.push(status);
    const data = await loadPurchaseOrders(whereSql, params, limit, offset);
    send(res, 200, {
      purchaseOrders: data.purchaseOrders,
      page,
      limit,
      total: data.total,
      totalPages: Math.ceil(data.total / limit),
    });
    return true;
  }

  if (req.method === 'POST' && parts.length === 1) {
    verifyAuth(req, ['ADMIN']);
    const body = validatePurchaseOrderPayload(await parseBody(req));
    const tx = await client.connect();
    try {
      await tx.query('begin');
      const productIds = body.items.map((item) => item.productId);
      const products = await tx.query(
        `select * from "${schemas.inventory}"."Product" where "id" = any($1)`,
        [productIds],
      );
      const productById = new Map(products.rows.map((row) => [row.id, row]));
      const missing = productIds.find((id) => !productById.has(id));
      if (missing) throw httpError(400, `Product ${missing} was not found`);
      const id = randomUUID();
      const order = await tx.query(
        `insert into "${schemas.inventory}"."PurchaseOrder"
         ("id", "supplierName", "supplierEmail", "status", "expectedAt", "createdBy", "createdAt", "updatedAt")
         values ($1, $2, $3, 'SENT', $4, $5, now(), now())
         returning *`,
        [id, body.supplierName, body.supplierEmail, body.expectedAt, user.username],
      );
      for (const item of body.items) {
        const product = productById.get(item.productId);
        await tx.query(
          `insert into "${schemas.inventory}"."PurchaseOrderItem"
           ("id", "purchaseOrderId", "productId", "productName", "quantity", "unitCost")
           values ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), id, item.productId, product.name, item.quantity, item.unitCost],
        );
      }
      await recordAudit(tx, user, 'CREATE_PURCHASE_ORDER', 'PurchaseOrder', id, {
        supplierName: body.supplierName,
        itemCount: body.items.length,
      });
      await createNotification(tx, {
        type: 'PURCHASE_ORDER',
        title: 'Purchase order sent',
        message: `Purchase order ${id.slice(0, 8).toUpperCase()} was created for ${body.supplierName}.`,
        severity: 'info',
        referenceType: 'PurchaseOrder',
        referenceId: id,
      });
      await tx.query('commit');
      const data = await loadPurchaseOrders('where "id" = $1', [id], 1, 0);
      send(res, 201, data.purchaseOrders[0] || purchaseOrderFromRows(order.rows[0], []));
    } catch (error) {
      await tx.query('rollback');
      throw error;
    } finally {
      tx.release();
    }
    return true;
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'receive') {
    verifyAuth(req, ['ADMIN']);
    const tx = await client.connect();
    try {
      await tx.query('begin');
      const orderResult = await tx.query(
        `select * from "${schemas.inventory}"."PurchaseOrder" where "id" = $1 for update`,
        [parts[1]],
      );
      const order = orderResult.rows[0];
      if (!order) throw httpError(404, 'Purchase order not found');
      if (order.status === 'RECEIVED') throw httpError(409, 'Purchase order is already received');
      if (order.status === 'CANCELLED')
        throw httpError(409, 'Cancelled purchase orders cannot be received');
      const items = await tx.query(
        `select * from "${schemas.inventory}"."PurchaseOrderItem" where "purchaseOrderId" = $1`,
        [parts[1]],
      );
      const warehouse = await defaultWarehouse(tx);
      for (const item of items.rows) {
        const product = await tx.query(
          `update "${schemas.inventory}"."Product"
           set "stockLevel" = "stockLevel" + $1,
               "version" = "version" + 1,
               "updatedAt" = now()
           where "id" = $2
           returning *`,
          [item.quantity, item.productId],
        );
        const updatedProduct = product.rows[0];
        if (!updatedProduct) continue;
        await upsertWarehouseStock(
          tx,
          item.productId,
          warehouse.id,
          item.quantity,
          updatedProduct.stockLevel,
        );
        await recordStockMovement(tx, {
          productId: item.productId,
          productName: item.productName,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          type: 'PURCHASE_RECEIPT',
          delta: item.quantity,
          balanceAfter: updatedProduct.stockLevel,
          referenceType: 'PurchaseOrder',
          referenceId: parts[1],
          note: `Received from ${order.supplierName}`,
          createdBy: user.username,
        });
      }
      await tx.query(
        `update "${schemas.inventory}"."PurchaseOrder"
         set "status" = 'RECEIVED', "updatedAt" = now()
         where "id" = $1`,
        [parts[1]],
      );
      await recordAudit(tx, user, 'RECEIVE_PURCHASE_ORDER', 'PurchaseOrder', parts[1], {
        supplierName: order.supplierName,
      });
      await createNotification(tx, {
        type: 'PURCHASE_RECEIVED',
        title: 'Purchase order received',
        message: `Stock from ${order.supplierName} was received and added to inventory.`,
        severity: 'success',
        referenceType: 'PurchaseOrder',
        referenceId: parts[1],
      });
      await tx.query('commit');
      const data = await loadPurchaseOrders('where "id" = $1', [parts[1]], 1, 0);
      send(res, 200, data.purchaseOrders[0]);
    } catch (error) {
      await tx.query('rollback');
      throw error;
    } finally {
      tx.release();
    }
    return true;
  }

  if (req.method === 'POST' && parts.length === 3 && parts[2] === 'cancel') {
    verifyAuth(req, ['ADMIN']);
    const result = await client.query(
      `update "${schemas.inventory}"."PurchaseOrder"
       set "status" = 'CANCELLED', "updatedAt" = now()
       where "id" = $1 and "status" <> 'RECEIVED'
       returning *`,
      [parts[1]],
    );
    if (!result.rows[0]) throw httpError(404, 'Purchase order not found or already received');
    await recordAudit(client, user, 'CANCEL_PURCHASE_ORDER', 'PurchaseOrder', parts[1]);
    const data = await loadPurchaseOrders('where "id" = $1', [parts[1]], 1, 0);
    send(res, 200, data.purchaseOrders[0]);
    return true;
  }

  return false;
}

async function handleNotifications(req, res, parts, url) {
  if (parts[0] !== 'notifications') return false;
  verifyAuth(req, ['ADMIN', 'STAFF']);
  const client = getPool();

  if (req.method === 'GET' && parts.length === 1) {
    const { page, limit, offset } = pageParams(url);
    const unread = url.searchParams.get('unread') === 'true';
    const where = unread ? 'where "readAt" is null' : '';
    const count = await client.query(
      `select count(*)::int as count from "${schemas.inventory}"."Notification" ${where}`,
    );
    const result = await client.query(
      `select * from "${schemas.inventory}"."Notification"
       ${where}
       order by "createdAt" desc
       limit $1 offset $2`,
      [limit, offset],
    );
    send(res, 200, {
      notifications: result.rows.map(notificationFromRow),
      unread: result.rows.filter((row) => !row.readAt).length,
      page,
      limit,
      total: count.rows[0].count,
      totalPages: Math.ceil(count.rows[0].count / limit),
    });
    return true;
  }

  if (req.method === 'PUT' && parts.length === 2 && parts[1] === 'read-all') {
    await client.query(
      `update "${schemas.inventory}"."Notification"
       set "readAt" = coalesce("readAt", now())
       where "readAt" is null`,
    );
    send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'PUT' && parts.length === 3 && parts[2] === 'read') {
    const result = await client.query(
      `update "${schemas.inventory}"."Notification"
       set "readAt" = coalesce("readAt", now())
       where "id" = $1
       returning *`,
      [parts[1]],
    );
    if (!result.rows[0]) throw httpError(404, 'Notification not found');
    send(res, 200, notificationFromRow(result.rows[0]));
    return true;
  }

  return false;
}

async function handleAuditLogs(req, res, parts, url) {
  if (parts[0] !== 'audit-logs' || req.method !== 'GET' || parts.length !== 1) return false;
  verifyAuth(req, ['ADMIN']);
  const { page, limit, offset } = pageParams(url);
  const count = await getPool().query(
    `select count(*)::int as count from "${schemas.auth}"."AuditLog"`,
  );
  const result = await getPool().query(
    `select * from "${schemas.auth}"."AuditLog"
     order by "createdAt" desc
     limit $1 offset $2`,
    [limit, offset],
  );
  send(res, 200, {
    logs: result.rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorUsername: row.actorUsername,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: row.metadata,
      createdAt: iso(row.createdAt),
    })),
    page,
    limit,
    total: count.rows[0].count,
    totalPages: Math.ceil(count.rows[0].count / limit),
  });
  return true;
}

async function handleUsers(req, res, parts) {
  if (parts[0] !== 'users') return false;
  const user = verifyAuth(req, ['ADMIN']);
  const client = getPool();

  if (req.method === 'GET' && parts.length === 1) {
    const result = await client.query(
      `select * from "${schemas.auth}"."User" order by "createdAt" desc`,
    );
    send(res, 200, { users: result.rows.map(safeUser) });
    return true;
  }

  if (req.method === 'POST' && parts.length === 1) {
    const body = ensureObject(await parseBody(req));
    const username = textField(body, 'username', {
      required: true,
      nullable: false,
      maxLength: 80,
    });
    const password = String(body.password || '');
    const role = body.role === 'ADMIN' ? 'ADMIN' : 'STAFF';
    if (username.length < 3) throw httpError(400, 'Username must be at least 3 characters');
    if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters');
    if (await getUserByUsername(client, username))
      throw httpError(409, 'Username is already registered');
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `insert into "${schemas.auth}"."User"
       ("id", "username", "passwordHash", "role", "createdAt", "updatedAt")
       values ($1, $2, $3, $4::"${schemas.auth}"."Role", now(), now())
       returning *`,
      [id, username, passwordHash, role],
    );
    await recordAudit(client, user, 'CREATE_USER', 'User', id, { username, role });
    send(res, 201, { user: safeUser(result.rows[0]) });
    return true;
  }

  if (req.method === 'PUT' && parts.length === 2) {
    const body = ensureObject(await parseBody(req));
    const role = body.role === 'ADMIN' || body.role === 'STAFF' ? body.role : undefined;
    const disabled = body.disabled === true || body.disabled === false ? body.disabled : undefined;
    if (parts[1] === user.sub && disabled === true)
      throw httpError(400, 'You cannot disable your own account');
    const fields = [];
    const params = [];
    if (role) {
      params.push(role);
      fields.push(`"role" = $${params.length}::"${schemas.auth}"."Role"`);
    }
    if (disabled !== undefined) {
      fields.push(`"disabledAt" = ${disabled ? 'now()' : 'null'}`);
    }
    if (!fields.length) throw httpError(400, 'No user changes provided');
    params.push(parts[1]);
    const result = await client.query(
      `update "${schemas.auth}"."User"
       set ${fields.join(', ')}, "updatedAt" = now()
       where "id" = $${params.length}
       returning *`,
      params,
    );
    if (!result.rows[0]) throw httpError(404, 'User not found');
    await recordAudit(client, user, 'UPDATE_USER', 'User', parts[1], { role, disabled });
    send(res, 200, { user: safeUser(result.rows[0]) });
    return true;
  }

  return false;
}

async function buildAdvancedReport(url) {
  const client = getPool();
  const { from, to } = reportDateRange(url);
  const valuation = await client.query(
    `select coalesce(sum("price" * "stockLevel"), 0)::numeric as value,
            count(*)::int as "skuCount",
            coalesce(sum(case when "stockLevel" < "reorderThreshold" then 1 else 0 end), 0)::int as "lowStockCount"
     from "${schemas.inventory}"."Product"`,
  );
  const fastMoving = await client.query(
    `select oi."productId",
            coalesce(max(oi."productName"), p."name") as name,
            coalesce(p."category", 'Uncategorised') as category,
            sum(oi."quantity")::int as units,
            sum(oi."lineTotal")::numeric as revenue
     from "${schemas.order}"."OrderItem" oi
     join "${schemas.order}"."Order" o on o."id" = oi."orderId"
     left join "${schemas.inventory}"."Product" p on p."id" = oi."productId"
     where o."createdAt" >= $1 and o."createdAt" <= $2
       and o."status" not in ('FAILED', 'CANCELLED')
     group by oi."productId", p."name", p."category"
     order by units desc
     limit 8`,
    [from, to],
  );
  const deadStock = await client.query(
    `select p.*
     from "${schemas.inventory}"."Product" p
     where p."stockLevel" > 0
       and not exists (
         select 1
         from "${schemas.order}"."OrderItem" oi
         join "${schemas.order}"."Order" o on o."id" = oi."orderId"
         where oi."productId" = p."id"
           and o."createdAt" >= $1
           and o."status" not in ('FAILED', 'CANCELLED')
       )
     order by p."stockLevel" desc
     limit 8`,
    [from],
  );
  const categoryRevenue = await client.query(
    `select coalesce(p."category", 'Uncategorised') as category,
            sum(oi."lineTotal")::numeric as revenue,
            sum(oi."quantity")::int as units
     from "${schemas.order}"."OrderItem" oi
     join "${schemas.order}"."Order" o on o."id" = oi."orderId"
     left join "${schemas.inventory}"."Product" p on p."id" = oi."productId"
     where o."createdAt" >= $1 and o."createdAt" <= $2
       and o."status" not in ('FAILED', 'CANCELLED')
     group by coalesce(p."category", 'Uncategorised')
     order by revenue desc
     limit 8`,
    [from, to],
  );
  const reorderSuggestions = await client.query(
    `select *,
            greatest("reorderThreshold" * 2 - "stockLevel", "reorderThreshold")::int as "suggestedQuantity",
            case
              when "stockLevel" = 0 then 'urgent'
              when "stockLevel" < "reorderThreshold" then 'soon'
              else 'healthy'
            end as priority
     from "${schemas.inventory}"."Product"
     where "stockLevel" < "reorderThreshold"
     order by "stockLevel" asc
     limit 10`,
  );
  const supplierPerformance = await client.query(
    `select "supplierName",
            count(*)::int as "purchaseOrders",
            sum(case when "status" = 'RECEIVED' then 1 else 0 end)::int as received,
            sum(case when "status" = 'CANCELLED' then 1 else 0 end)::int as cancelled
     from "${schemas.inventory}"."PurchaseOrder"
     group by "supplierName"
     order by received desc, "purchaseOrders" desc
     limit 8`,
  );
  const warehouseUtilization = await client.query(
    `select w."id", w."name", w."region",
            coalesce(sum(s."stockLevel"), 0)::int as "totalStock",
            count(s."productId")::int as "skuCount"
     from "${schemas.inventory}"."Warehouse" w
     left join "${schemas.inventory}"."ProductWarehouseStock" s on s."warehouseId" = w."id"
     group by w."id"
     order by "totalStock" desc`,
  );

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    stockValuation: {
      value: number(valuation.rows[0].value),
      skuCount: valuation.rows[0].skuCount,
      lowStockCount: valuation.rows[0].lowStockCount,
    },
    fastMoving: fastMoving.rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      category: row.category,
      units: row.units,
      revenue: number(row.revenue),
    })),
    deadStock: deadStock.rows.map(productFromRow),
    categoryRevenue: categoryRevenue.rows.map((row) => ({
      category: row.category,
      revenue: number(row.revenue),
      units: row.units,
    })),
    reorderSuggestions: reorderSuggestions.rows.map((row) => ({
      productId: row.id,
      name: row.name,
      category: row.category,
      stockLevel: row.stockLevel,
      reorderThreshold: row.reorderThreshold,
      suggestedQuantity: row.suggestedQuantity,
      priority: row.priority,
    })),
    supplierPerformance: supplierPerformance.rows.map((row) => ({
      supplierName: row.supplierName,
      purchaseOrders: row.purchaseOrders,
      received: row.received,
      cancelled: row.cancelled,
      fulfilmentRate: row.purchaseOrders
        ? Math.round((row.received / row.purchaseOrders) * 100)
        : 0,
    })),
    warehouseUtilization: warehouseUtilization.rows.map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region,
      totalStock: row.totalStock,
      skuCount: row.skuCount,
    })),
  };
}

async function handleReports(req, res, parts, url) {
  if (parts[0] !== 'reports' || req.method !== 'GET') return false;
  verifyAuth(req, ['ADMIN']);
  const client = getPool();

  if (parts.length === 2 && parts[1] === 'advanced') {
    send(res, 200, await buildAdvancedReport(url));
    return true;
  }

  if (parts.length === 2 && parts[1] === 'sales') {
    const { from, to } = reportDateRange(url);
    const result = await client.query(
      `select date_trunc('day', "createdAt") as date,
              sum("total")::numeric as "totalSales",
              count(*)::int as "orderCount",
              coalesce(sum(items.units), 0)::int as "unitsSold"
       from "${schemas.order}"."Order" o
       left join (
         select "orderId", sum("quantity") as units
         from "${schemas.order}"."OrderItem"
         group by "orderId"
       ) items on items."orderId" = o."id"
       where o."createdAt" >= $1 and o."createdAt" <= $2
         and o."status" not in ('FAILED', 'CANCELLED')
       group by date_trunc('day', "createdAt")
       order by date asc`,
      [from, to],
    );
    const byDay = result.rows.map((row) => ({
      date: iso(row.date).slice(0, 10),
      totalSales: number(row.totalSales),
      orderCount: row.orderCount,
      unitsSold: row.unitsSold,
    }));
    send(res, 200, {
      from: from.toISOString(),
      to: to.toISOString(),
      totalSales: byDay.reduce((sum, day) => sum + day.totalSales, 0),
      orderCount: byDay.reduce((sum, day) => sum + day.orderCount, 0),
      unitsSold: byDay.reduce((sum, day) => sum + day.unitsSold, 0),
      byDay,
    });
    return true;
  }

  if (parts.length === 2 && parts[1] === 'inventory') {
    const result = await client.query(
      `select * from "${schemas.inventory}"."Product" order by "updatedAt" desc`,
    );
    send(res, 200, {
      products: result.rows.map((row) => ({
        productId: row.id,
        name: row.name,
        category: row.category,
        stockLevel: row.stockLevel,
        reorderThreshold: row.reorderThreshold,
        lowStock: row.stockLevel < row.reorderThreshold,
        updatedAt: iso(row.updatedAt),
      })),
    });
    return true;
  }

  if (parts.length === 2 && parts[1] === 'stock-alerts') {
    const result = await client.query(
      `select * from "${schemas.inventory}"."Product"
       where "stockLevel" < "reorderThreshold"
       order by "updatedAt" desc
       limit 50`,
    );
    send(res, 200, {
      alerts: result.rows.map((row) => ({
        id: row.id,
        productId: row.id,
        name: row.name,
        stockLevel: row.stockLevel,
        reorderThreshold: row.reorderThreshold,
        createdAt: iso(row.updatedAt),
        resolvedAt: null,
      })),
    });
    return true;
  }

  return false;
}

async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204);
    return;
  }

  try {
    await ensureOperationalSchema();
    const { url, parts } = parseUrl(req);
    const handled =
      (parts[0] === 'auth' && (await handleAuth(req, res, parts))) ||
      (await handleProducts(req, res, parts, url)) ||
      (await handleInventory(req, res, parts)) ||
      (await handleOrders(req, res, parts, url)) ||
      (await handleWarehouses(req, res, parts)) ||
      (await handleStockMovements(req, res, parts, url)) ||
      (await handlePurchaseOrders(req, res, parts, url)) ||
      (await handleNotifications(req, res, parts, url)) ||
      (await handleAuditLogs(req, res, parts, url)) ||
      (await handleUsers(req, res, parts)) ||
      (await handleReports(req, res, parts, url));

    if (!handled) throw httpError(404, 'Endpoint not found');
  } catch (error) {
    const status = error.status || 500;
    const message =
      status >= 500 && process.env.NODE_ENV === 'production'
        ? 'Unexpected error'
        : error.message || 'Unexpected error';
    send(res, status, { message });
  }
}

module.exports = handler;
module.exports.__test = {
  cleanConnectionString,
  ensureObject,
  httpError,
  jwtSecret,
  pageParams,
  parseDateParam,
  parseCsv,
  productsToCsv,
  reportDateRange,
  textField,
  numberField,
  validatePurchaseOrderPayload,
  validateOrderPayload,
  validateProductPayload,
};
