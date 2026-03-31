const history = [
  { role: 'user', content: '17呢' },
  { role: 'assistant', content: '請問您是指 Xiaomi 17 還是其他品牌？' },
];

const mergedContent = 'apple';

// Simulated orchestrator behavior:
let searchKeyword = mergedContent; // normally productService.extractSearchKeyword(mergedContent)

if (mergedContent.length < 15) {
  const prevUserMessage = [...history].reverse().find(m => m.role === 'user');
  if (prevUserMessage) {
    searchKeyword = `${prevUserMessage.content} ${searchKeyword}`;
  }
}

// Then it gets passed to extractSearchKeyword to strip fillers:
function extractSearchKeyword(text: string): string {
  const fillers = [
    '我想要', '我想', '幫我', '我要', '請問', '有沒有', '有嗎', '可以嗎',
    '訂製', '訂做', '客製化', '客製', '客制', '手機殼', '殼', '款式', '推薦',
    '購買', '想買', '要買', '的', '嗎', '呢', '喔', '耶',
  ];
  let kw = text;
  for (const f of fillers) kw = kw.replace(new RegExp(f, 'g'), ' ');
  return kw.replace(/\s+/g, ' ').trim() || text;
}

const finalKeyword = extractSearchKeyword(searchKeyword);
console.log(`Original: ${mergedContent}`);
console.log(`Combined Keyword for DB Search: ${finalKeyword}`);
