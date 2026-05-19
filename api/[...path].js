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

let pool;

function getPool() {
  if (pool) return pool;
  const connectionString = cleanConnectionString(
    process.env.AUTH_DIRECT_URL ||
      process.env.AUTH_DATABASE_URL ||
      process.env.DATABASE_URL,
  );
  if (!connectionString) {
    throw httpError(500, 'Database connection is not configured');
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  return pool;
}

function cleanConnectionString(value) {
  if (!value) return value;
  const url = new URL(value);
  url.search = '';
  return url.toString();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendEmpty(res, status = 204) {
  res.statusCode = status;
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
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
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 10)));
  return { page, limit, offset: (page - 1) * limit };
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function number(value) {
  return Number(value ?? 0);
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

function signUser(user) {
  const secret = process.env.JWT_SECRET || 'local-development-jwt-secret-change-in-prod';
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' },
  );
}

function verifyAuth(req, roles) {
  const [type, token] = String(req.headers.authorization || '').split(' ');
  if (type !== 'Bearer' || !token) throw httpError(401, 'Missing bearer token');
  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || 'local-development-jwt-secret-change-in-prod',
    );
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
  if (req.method === 'POST' && parts[1] === 'login') {
    const body = await parseBody(req);
    const user = await getUserByUsername(client, String(body.username || ''));
    if (!user || !(await bcrypt.compare(String(body.password || ''), user.passwordHash))) {
      throw httpError(401, 'Invalid username or password');
    }
    send(res, 200, { token: signUser(user), user: safeUser(user) });
    return true;
  }

  if (req.method === 'POST' && parts[1] === 'register') {
    const body = await parseBody(req);
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

  if (req.method === 'GET' && parts[1] === 'me') {
    send(res, 200, { user: verifyAuth(req) });
    return true;
  }

  if (req.method === 'POST' && parts[1] === 'verify') {
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
  const payload = {};
  for (const field of ['name', 'description', 'category', 'imageUrl']) {
    if (body[field] !== undefined) payload[field] = body[field] ? String(body[field]).trim() : null;
  }
  for (const field of ['price', 'stockLevel', 'reorderThreshold']) {
    if (body[field] !== undefined) payload[field] = Number(body[field]);
  }
  if (!partial) {
    for (const field of ['name', 'category', 'price', 'stockLevel', 'reorderThreshold']) {
      if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
        throw httpError(400, `${field} is required`);
      }
    }
  }
  if (payload.price !== undefined && payload.price < 0) throw httpError(400, 'price must be positive');
  if (payload.stockLevel !== undefined && payload.stockLevel < 0) throw httpError(400, 'stockLevel cannot be negative');
  if (payload.reorderThreshold !== undefined && payload.reorderThreshold < 0) throw httpError(400, 'reorderThreshold cannot be negative');
  return payload;
}

async function handleProducts(req, res, parts, url) {
  if (req.method === 'GET' && parts[0] === 'public' && parts[1] === 'products') {
    send(res, 200, await listProducts(url));
    return true;
  }

  if (parts[0] !== 'products') return false;
  if (req.method === 'GET' && parts.length === 1) {
    verifyAuth(req);
    send(res, 200, await listProducts(url));
    return true;
  }
  if (req.method === 'GET' && parts[1]) {
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
      [id, body.name, body.description, body.price, body.category, body.stockLevel, body.reorderThreshold, body.imageUrl],
    );
    send(res, 201, productFromRow(result.rows[0]));
    return true;
  }
  if (req.method === 'PUT' && parts[1]) {
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
  if (req.method === 'DELETE' && parts[1]) {
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
  if (parts[0] !== 'inventory' || req.method !== 'PUT' || parts[2] !== 'stock') return false;
  verifyAuth(req, ['ADMIN']);
  const body = await parseBody(req);
  const delta = Number(body.delta);
  if (!Number.isInteger(delta) || delta === 0) throw httpError(400, 'Stock delta cannot be zero');
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const current = await client.query(
      `select * from "${schemas.inventory}"."Product" where "id" = $1 for update`,
      [parts[1]],
    );
    const product = current.rows[0];
    if (!product) throw httpError(404, 'Product not found');
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== product.version) {
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

async function handleOrders(req, res, parts, url) {
  if (parts[0] !== 'orders') return false;
  verifyAuth(req, ['ADMIN', 'STAFF']);
  const client = getPool();

  if (req.method === 'GET' && parts.length === 1) {
    const { page, limit, offset } = pageParams(url);
    const status = url.searchParams.get('status');
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

  if (req.method === 'GET' && parts[1]) {
    const data = await loadOrders('where "id" = $1', [parts[1]], 1, 0);
    if (!data.orders[0]) throw httpError(404, 'Order not found');
    send(res, 200, data.orders[0]);
    return true;
  }

  if (req.method === 'POST' && parts.length === 1) {
    const body = await parseBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!String(body.customerName || '').trim()) throw httpError(400, 'customerName is required');
    if (!items.length) throw httpError(400, 'At least one order item is required');
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.productId)) throw httpError(400, 'Duplicate product IDs are not allowed in a single order');
      seen.add(item.productId);
      if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
        throw httpError(400, 'Order item quantity must be at least 1');
      }
    }

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
        if (product.stockLevel < quantity) throw httpError(400, `${product.name} does not have enough stock`);
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
          String(body.customerName).trim(),
          body.customerEmail || null,
          body.customerAddress || null,
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
          [randomUUID(), orderId, item.product.id, item.product.name, item.quantity, item.unitPrice, item.lineTotal],
        );
      }
      await tx.query(
        `insert into "${schemas.order}"."OrderStatusHistory"
         ("id", "orderId", "status", "note", "createdAt")
         values ($1, $2, $3::"${schemas.order}"."OrderStatus", $4, now())`,
        [randomUUID(), orderId, 'CONFIRMED', `Payment authorized (${paymentReference}) and stock reserved`],
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

  if (req.method === 'PUT' && parts[1] && parts[2] === 'status') {
    const body = await parseBody(req);
    const status = String(body.status || '');
    if (!['PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'SHIPPED'].includes(status)) {
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

  if (req.method === 'DELETE' && parts[1]) {
    verifyAuth(req, ['ADMIN']);
    const result = await client.query(
      `delete from "${schemas.order}"."Order" where "id" = $1`,
      [parts[1]],
    );
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

  if (parts[1] === 'sales') {
    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')) : new Date();
    const from = url.searchParams.get('from')
      ? new Date(url.searchParams.get('from'))
      : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
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

  if (parts[1] === 'inventory') {
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

  if (parts[1] === 'stock-alerts') {
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

module.exports = async function handler(req, res) {
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
    send(res, status, { message: error.message || 'Unexpected error' });
  }
};
