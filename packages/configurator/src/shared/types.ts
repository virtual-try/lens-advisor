export interface ProductVariantData {
  id: string;
  priceMinor?: number;
  title?: string;
}

export interface ProductData {
  id?: string;
  productId?: string;
  title?: string;
  variantId?: string;
  variantIds?: string[];
  priceMinor?: number;
  currency?: string;
  variants?: ProductVariantData[];
}
