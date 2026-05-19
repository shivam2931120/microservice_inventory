import { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import type { Product } from '../types/api';

interface ProductImageProps {
  product: Pick<Product, 'category' | 'imageUrl' | 'name'>;
  variant?: 'card' | 'thumb';
}

export function ProductImage({ product, variant = 'card' }: ProductImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [product.imageUrl]);

  const initials = useMemo(() => {
    const words = product.name
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9]/gi, ''))
      .filter(Boolean);
    const value = words.length > 1 ? `${words[0][0]}${words[1][0]}` : product.name.slice(0, 2);
    return value.toUpperCase();
  }, [product.name]);

  if (product.imageUrl && !failed) {
    return (
      <img
        src={product.imageUrl}
        alt={product.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    );
  }

  if (variant === 'thumb') {
    return (
      <div
        role="img"
        aria-label={`${product.name} product placeholder`}
        className="grid h-full w-full place-items-center bg-surface-container-high text-sm font-bold text-on-surface-variant"
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`${product.name} product placeholder`}
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface-container-high px-6 text-center"
    >
      <span className="grid h-16 w-16 place-items-center rounded-xl border border-outline-variant bg-surface text-primary">
        <Package size={30} />
      </span>
      <span className="max-w-full truncate text-sm font-bold uppercase tracking-wide text-on-surface-variant">
        {product.category}
      </span>
      <span className="max-w-full truncate text-xl font-semibold text-on-surface">{initials}</span>
    </div>
  );
}
