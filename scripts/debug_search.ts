const queries = [
  "17PRO",
  "S24Ultra",
  "16PM",
  "A55",
  "iphone16",
  "iphone 16 pro max",
  "ROG7",
  "小米17"
];

for (let q of queries) {
  let mod = q.replace(/(iphone|ipad|galaxy|pixel|pro|max|plus|ultra|mini|pm)/gi, ' $1 ');
  let tokens = mod.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];
  console.log(`${q} -> ${mod} ->`, tokens);
}
