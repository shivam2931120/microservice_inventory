import type { Product } from '../types/api';

export type CartState = Record<string, number>;
type CartProduct = Pick<Product, 'id' | 'stockLevel'>;

export function cartItemCount(cart: CartState) {
  return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
}

export function canAddToCart(cart: CartState, product: CartProduct) {
  return product.stockLevel > 0 && (cart[product.id] ?? 0) < product.stockLevel;
}

export function addProductToCart(cart: CartState, product: CartProduct) {
  if (!canAddToCart(cart, product)) return cart;
  return {
    ...cart,
    [product.id]: (cart[product.id] ?? 0) + 1,
  };
}
