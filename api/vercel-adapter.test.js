const assert = require('node:assert/strict');
const test = require('node:test');

const { __test } = require('./[...path].js');

function url(path) {
  return new URL(path, 'https://inventory.local');
}

function assertHttpError(fn, status, message) {
  assert.throws(
    fn,
    (error) => error.status === status && (!message || error.message.includes(message)),
  );
}

test('pageParams validates integer pagination and clamps large limits', () => {
  assert.deepEqual(__test.pageParams(url('/products')), { page: 1, limit: 10, offset: 0 });
  assert.deepEqual(__test.pageParams(url('/products?page=3&limit=250')), {
    page: 3,
    limit: 100,
    offset: 200,
  });
  assertHttpError(() => __test.pageParams(url('/products?page=abc')), 400, 'page');
  assertHttpError(() => __test.pageParams(url('/products?limit=1.5')), 400, 'limit');
});

test('validateProductPayload normalizes valid products and rejects unsafe values', () => {
  assert.deepEqual(
    __test.validateProductPayload({
      name: '  Headphones  ',
      description: '',
      category: ' Electronics ',
      price: '199.99',
      stockLevel: '12',
      reorderThreshold: 3,
      imageUrl: 'https://images.example.com/headphones.png',
    }),
    {
      name: 'Headphones',
      description: null,
      category: 'Electronics',
      price: 199.99,
      stockLevel: 12,
      reorderThreshold: 3,
      imageUrl: 'https://images.example.com/headphones.png',
    },
  );

  assertHttpError(
    () =>
      __test.validateProductPayload({
        category: 'Electronics',
        price: 1,
        stockLevel: 1,
        reorderThreshold: 1,
      }),
    400,
    'name',
  );
  assertHttpError(
    () =>
      __test.validateProductPayload({
        name: 'Headphones',
        category: 'Electronics',
        price: 'NaN',
        stockLevel: 1,
        reorderThreshold: 1,
      }),
    400,
    'price',
  );
  assertHttpError(
    () =>
      __test.validateProductPayload({
        name: 'Headphones',
        category: 'Electronics',
        price: 1,
        stockLevel: 1.5,
        reorderThreshold: 1,
      }),
    400,
    'stockLevel',
  );
  assertHttpError(() => __test.validateProductPayload({ name: ' ', price: 1 }, true), 400, 'name');
  assertHttpError(
    () => __test.validateProductPayload({ imageUrl: 'ftp://example.com/image.png' }, true),
    400,
    'imageUrl',
  );
});

test('validateOrderPayload trims customer data and rejects malformed items', () => {
  assert.deepEqual(
    __test.validateOrderPayload({
      customerName: '  Acme Warehouse ',
      customerEmail: ' buyer@example.com ',
      customerAddress: '',
      items: [{ productId: ' product-1 ', quantity: '2' }],
    }),
    {
      customerName: 'Acme Warehouse',
      customerEmail: 'buyer@example.com',
      customerAddress: null,
      items: [{ productId: 'product-1', quantity: 2 }],
    },
  );

  assertHttpError(
    () => __test.validateOrderPayload({ customerName: 'Acme', items: [] }),
    400,
    'At least one',
  );
  assertHttpError(
    () =>
      __test.validateOrderPayload({
        customerName: 'Acme',
        items: [
          { productId: 'product-1', quantity: 1 },
          { productId: ' product-1 ', quantity: 2 },
        ],
      }),
    400,
    'Duplicate product IDs',
  );
  assertHttpError(
    () =>
      __test.validateOrderPayload({
        customerName: 'Acme',
        customerEmail: 'invalid',
        items: [{ productId: 'product-1', quantity: 1 }],
      }),
    400,
    'customerEmail',
  );
  assertHttpError(
    () =>
      __test.validateOrderPayload({
        customerName: 'Acme',
        items: [{ productId: 'product-1', quantity: 0 }],
      }),
    400,
    'quantity',
  );
});

test('reportDateRange validates report date filters', () => {
  const range = __test.reportDateRange(url('/reports/sales?from=2026-05-01&to=2026-05-31'));
  assert.equal(range.from.toISOString(), '2026-05-01T00:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-05-31T00:00:00.000Z');

  assertHttpError(() => __test.reportDateRange(url('/reports/sales?from=not-a-date')), 400, 'from');
  assertHttpError(
    () => __test.reportDateRange(url('/reports/sales?from=2026-06-01&to=2026-05-01')),
    400,
    'from must be before',
  );
});
