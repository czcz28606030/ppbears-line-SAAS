type Product = { name: string; categories: string; phone_models: string };

function detectBrandAmbiguity(products: Product[]): boolean {
  if (products.length <= 1) return false;

  const MAJOR_BRANDS = [
    { id: 'apple', keywords: ['apple', 'iphone', 'ipad', '蘋果'] },
    { id: 'samsung', keywords: ['samsung', 'galaxy', '三星'] },
    { id: 'xiaomi', keywords: ['xiaomi', 'mi ', 'redmi', 'poco', '小米', '紅米'] },
    { id: 'oppo', keywords: ['oppo', 'reno', 'find'] },
    { id: 'vivo', keywords: ['vivo', 'iqoo'] },
    { id: 'realme', keywords: ['realme'] },
    { id: 'huawei', keywords: ['huawei', 'mate', 'nova', '華為'] },
    { id: 'asus', keywords: ['asus', 'zenfone', 'rog', '華碩'] },
    { id: 'sony', keywords: ['sony', 'xperia', '索尼'] },
    { id: 'google', keywords: ['google', 'pixel', '谷歌'] },
  ];

  const foundBrands = new Set<string>();

  for (const p of products) {
    const haystack = `${p.name} ${p.categories} ${p.phone_models}`.toLowerCase();
    
    for (const brand of MAJOR_BRANDS) {
      if (brand.keywords.some(k => haystack.includes(k))) {
        foundBrands.add(brand.id);
        break; // Map this product to the first matching brand and stop checking other brands for this product
      }
    }
  }

  return foundBrands.size > 1;
}

const p1: Product[] = [
  { name: 'iPhone 17 客製化外殼', categories: '', phone_models: '' },
  { name: 'Xiaomi 17 Ultra 透明殼', categories: '', phone_models: '' },
];

const p2: Product[] = [
  { name: 'Xiaomi 17', categories: '', phone_models: '' },
  { name: 'Xiaomi 17 Pro', categories: '', phone_models: '' },
];

console.log("p1 ambiguous?", detectBrandAmbiguity(p1));
console.log("p2 ambiguous?", detectBrandAmbiguity(p2));

