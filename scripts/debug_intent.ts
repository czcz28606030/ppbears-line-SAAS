// Simulating new broad intent detector

const modelPatterns = [
  // 1. All prominent brands
  /apple|iphone|ipad/i,
  /samsung|galaxy/i,
  /xiaomi|mi\s*\d|redmi|poco/i,
  /oppo|reno|find/i, // OPPO Find X7, Reno 12
  /vivo|iqoo/i, // V30, X100
  /realme/i,
  /huawei|mate|p\d{2}/i,
  /asus|zenfone|rog/i,
  /sony|xperia/i,
  /google|pixel/i,
  /motorola|moto/i,
  /sharp|aquos/i,
  /nothing\s*phone/i,
  /蘋果|三星|小米|紅米|華為|華碩|索尼|谷歌/i,
  
  // 2. Generalized model pattern A: 1-4 letters + numbers (e.g. Reno 12, X100, V30, A55)
  // To avoid noise, we ensure it's either at boundary or starts the string
  /\b[a-zA-Z]{1,4}\s*\d{1,3}\b/i,
  
  // 3. Generalized model pattern B: numbers + letters (e.g. 17 Pro, 16PM, 15 Plus)
  /\b\d{1,2}\s*[a-zA-Z]{1,10}\b/i,
];

function isProductQueryIntent(text: string): boolean {
  const intentKeywords = [
    '手機殼', '殼', '款式', '産品', '產品', '有什麼', '推薦', '適合', '型號',
    '要怎麼買', '哪裡買', '在哪買', '怎麼購買',
    '訂製', '訂做', '客製', '客制', '想訂', '想做', '幫我做',
    '想要', '想買', '購買', '要買', '我要', '幫我找', '有沒有',
  ];
  if (intentKeywords.some(kw => text.includes(kw))) return true;

  if (modelPatterns.some(p => p.test(text))) return true;
  
  // 4. Fallback for extremely short queries (likely naked numbers or weird models like "17")
  // If the query is less than 15 chars and not handled by other stuff, maybe it's just a raw number
  // e.g., "17" -> true, "S24" -> true
  if (text.length <= 15 && /\d/.test(text)) {
    return true;
  }

  return false;
}

const tests = [
  "Reno 12 Pro",   // Pattern A / oppo keyword
  "Find X7",       // oppo keyword
  "V30",           // Pattern A
  "X100",          // Pattern A
  "17PROMAX",      // Pattern B
  "16PM",          // Pattern B
  "17",            // Short string w/ digit
  "8a",            // Short string w/ digit
  "幫我找漂亮的手機殼", // Intent keyword
  "我想退貨",       // False
  "這件衣服多少錢",  // False
];

for (const t of tests) {
  console.log(`${t.padEnd(20)}: ${isProductQueryIntent(t)}`);
}
