const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-deliver.mjs';
let t = fs.readFileSync(p, 'utf8');

t = t.replace(/\uFFFD/g, '\u00B7');

t = t.replace(
  /text: 'MINUTES FROM[\s\S]*?style: 'List',/,
  "text: 'MINUTES FROM\\\\N MARINA WALK 1 MIN\\\\N SPINNEYS 3 MIN\\\\N MARINA MALL 5 MIN\\\\N JBR BEACH 10 MIN',\n    style: 'List',",
);

fs.writeFileSync(p, t);
console.log('card cleaned');
