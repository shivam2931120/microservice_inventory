import { describe, expect, it } from 'vitest';
import { addProductToCart, canAddToCart, cartItemCount } from './cart';

const stockedProduct = { id: 'product-1', stockLevel: 2 };
const outOfStockProduct = { id: 'product-2', stockLevel: 0 };

describe('cart utilities', () => {
  it('counts quantities across cart lines', () => {
    expect(cartItemCount({ 'product-1': 2, 'product-2': 3 })).toBe(5);
  });

  it('allows adding only while stock is available', () => {
    expect(canAddToCart({}, stockedProduct)).toBe(true);
    expect(canAddToCart({ 'product-1': 2 }, stockedProduct)).toBe(false);
    expect(canAddToCart({}, outOfStockProduct)).toBe(false);
  });

  it('does not add out-of-stock products or exceed available stock', () => {
    expect(addProductToCart({}, outOfStockProduct)).toEqual({});
    expect(addProductToCart({ 'product-1': 2 }, stockedProduct)).toEqual({ 'product-1': 2 });
    expect(addProductToCart({ 'product-1': 1 }, stockedProduct)).toEqual({ 'product-1': 2 });
  });
});
