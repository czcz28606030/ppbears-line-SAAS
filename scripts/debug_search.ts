const queries = [
  "17PRO",
  "S24Ultra",
  "16PM",
  "A55",
  "S24",
  "iphone16",
  "小米17U",
  "ROG7",
];

for (let q of queries) {
  let mod = q
    .replace(/(\d)([a-zA-Z]+)/g, '$1 $2') // split letters after numbers (e.g. 17PRO -> 17 PRO, 17U -> 17 U, S24Ultra -> S24 Ultra)
    .replace(/(iphone|ipad|galaxy|pixel|pad)(\d)/gi, '$1 $2'); // split known brands before numbers

  let rawTokens = mod.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];
  
  // Custom token expansion for short letters
  let finalTokens = [];
  const suffixMap = {
    'u': 'ultra',
    'pm': 'promax',
    'pro': 'pro',
    'max': 'max',
    'plus': 'plus'
  };
  
  for (let t of rawTokens) {
    if (suffixMap[t.toLowerCase()]) {
      finalTokens.push(suffixMap[t.toLowerCase()]);
    } else if (t.length === 1 && /^[a-zA-Z]$/.test(t)) {
      // skip other single letters
    } else {
      finalTokens.push(t);
    }
  }

  console.log(`${q.padEnd(10)} -> ${mod.padEnd(15)} ->`, finalTokens);
}
