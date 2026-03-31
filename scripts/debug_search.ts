// Fix: 16PM still fails because "pm" doesn't get separated from "16"
// And "promax" needs to be split to "pro max" too

const KNOWN_SUFFIXES = ['promax', 'ultra', 'plus', 'mini', 'pro', 'max', 'pm'];

function smartSplit(q: string): string {
  let s = q.toLowerCase();
  
  // 1. Normalize compound: promax -> pro max
  s = s.replace(/\bpromax\b/gi, 'pro max');
  
  // 2. Split known suffixes away from preceding numbers: "17pro" -> "17 pro", "17ultra" -> "17 ultra", "16pm" -> "16 pm"
  for (const suffix of KNOWN_SUFFIXES) {
    const re = new RegExp(`(\\d)(${suffix})`, 'gi');
    s = s.replace(re, `$1 $2`);
  }
  
  // 3. Split standalone U (Ultra) away from preceding number: "17U" -> "17 U"
  s = s.replace(/(\d)(u)\b/gi, '$1 $2');
  
  // 4. Handle brand+number concatenation: "iphone16" -> "iphone 16"
  s = s.replace(/(iphone|ipad|galaxy|pixel|pad)(\d)/gi, '$1 $2');
  
  // 5. After step 1: "pro max" should be treated as two group items now
  // No further action needed - tokenizer will split them
  
  return s;
}

// Map short aliases to full words for DB matching
const ALIAS_MAP: Record<string, string[]> = {
  'u': ['ultra'],
  'pm': ['pro max'],
};

function tokenizeAndGroup(q: string) {
  const spaced = smartSplit(q);
  const rawTokens = spaced.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];
  
  const BRAND_MAP: Record<string, string[]> = {
    '小米': ['xiaomi', 'redmi'],
    '紅米': ['redmi', 'xiaomi'],
    '蘋果': ['apple', 'iphone'],
    '三星': ['samsung', 'galaxy'],
    '華為': ['huawei'],
    '華碩': ['asus', 'rog'],
    '索尼': ['sony', 'xperia'],
    '谷歌': ['google', 'pixel'],
  };
  
  const KEEP_SINGLES = new Set(Object.keys(ALIAS_MAP)); // "u", "pm"
  
  const groups: string[][] = [];
  for (const t of rawTokens) {
    const tl = t.toLowerCase();
    if (t.length === 1 && /[a-zA-Z]/.test(t) && !KEEP_SINGLES.has(tl)) continue;
    if (t.length === 1 && /[0-9]/.test(t)) continue;
    
    const group = new Set([tl]); // store lowercase for DB ilike
    
    // Expand via ALIAS_MAP
    if (ALIAS_MAP[tl]) ALIAS_MAP[tl].forEach(a => group.add(a));
    
    // Expand via BRAND_MAP
    for (const [cn, enList] of Object.entries(BRAND_MAP)) {
      if (tl.includes(cn) || tl === cn.toLowerCase() || enList.map(e => e.toLowerCase()).includes(tl)) {
        group.add(cn);
        enList.forEach(e => group.add(e));
      }
    }
    
    groups.push([...group]);
  }
  
  return { spaced, rawTokens, groups };
}

const tests = [
  "17PROMAX",
  "17PRO",
  "17U",
  "小米17U",
  "iphone16",
  "S24Ultra",
  "16PM",
  "17 Pro Max",
  "ROG7",
  "S24",
];

for (const q of tests) {
  const { spaced, groups } = tokenizeAndGroup(q);
  console.log(`${q.padEnd(12)} -> ${spaced.padEnd(18)} groups: [${groups.map(g => `(${g.join('|')})`).join(' AND ')}]`);
}
