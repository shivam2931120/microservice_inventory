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

let pool;

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

function productFromRow(row) {
  return {
    id: row.id,
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
    createdAt: iso(user.createdAt),
    updatedAt: iso(user.updatedAt),
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
  const where = filters.length ? `where ${filters.join(' and ')}` : '';
  const countResult = await client.query(
    `select count(*)::int as count from "${schemas.inventory}"."Product" ${where}`,
    params,
  );
  const productsResult = await client.query(
    `select * from "${schemas.inventory}"."Product"
     ${where}
     order by "createdAt" desc
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
  if (req.method === 'GET' && parts.length === 2) {
    verifyAuth(req);
    send(res, 200, await getProduct(parts[1]));
    return true;
  }
  if (req.method === 'POST' && parts.length === 1) {
    verifyAuth(req, ['ADMIN']);
    const body = validateProductPayload(await parseBody(req));
    const id = randomUUID();
    const result = await getPool().query(
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
    send(res, 201, productFromRow(result.rows[0]));
    return true;
  }
  if (req.method === 'PUT' && parts.length === 2) {
    verifyAuth(req, ['ADMIN']);
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
    send(res, 200, productFromRow(result.rows[0]));
    return true;
  }
  if (req.method === 'DELETE' && parts.length === 2) {
    verifyAuth(req, ['ADMIN']);
    const result = await getPool().query(
      `delete from "${schemas.inventory}"."Product" where "id" = $1`,
      [parts[1]],
    );
    if (result.rowCount === 0) throw httpError(404, 'Product not found');
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
  verifyAuth(req, ['ADMIN']);
  const body = ensureObject(await parseBody(req));
  const delta = numberField(body, 'delta', { required: true, integer: true });
  if (delta === 0) throw httpError(400, 'Stock delta cannot be zero');
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
    const updated = await client.query(
      `update "${schemas.inventory}"."Product"
       set "stockLevel" = $1, "version" = "version" + 1, "updatedAt" = now()
       where "id" = $2
       returning *`,
      [nextStock, parts[1]],
    );
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
  verifyAuth(req, ['ADMIN', 'STAFF']);
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

      for (const item of orderItems) {
        await tx.query(
          `update "${schemas.inventory}"."Product"
           set "stockLevel" = "stockLevel" - $1, "version" = "version" + 1, "updatedAt" = now()
           where "id" = $2`,
          [item.quantity, item.product.id],
        );
      }

      const orderId = randomUUID();
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
    sendEmpty(res);
    return true;
  }

  return false;
}

async function handleReports(req, res, parts, url) {
  if (parts[0] !== 'reports' || req.method !== 'GET') return false;
  verifyAuth(req, ['ADMIN']);
  const client = getPool();

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
    const { url, parts } = parseUrl(req);
    const handled =
      (parts[0] === 'auth' && (await handleAuth(req, res, parts))) ||
      (await handleProducts(req, res, parts, url)) ||
      (await handleInventory(req, res, parts)) ||
      (await handleOrders(req, res, parts, url)) ||
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
  reportDateRange,
  textField,
  numberField,
  validateOrderPayload,
  validateProductPayload,
};
