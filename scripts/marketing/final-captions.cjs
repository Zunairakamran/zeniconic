const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-hero.mjs';
let t = fs.readFileSync(p, 'utf8');

t = t.replace(/\\\\n/g, '\\\\N');
t = t.replace(/ONE-BEDROOM RESIDENCES . DUBAI MARINA/g, 'ONE-BEDROOM RESIDENCES · DUBAI MARINA');

const swaps = [
  ["WHY WAIT FOR YEARS\\\\NWHEN YOUR DREAM HOME", 'WHY WAIT FOR YEARS?'],
  ["IS ALREADY READY.", 'YOUR DREAM HOME\\\\NIS READY.'],
  ["PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOUR APARTMENT.", 'PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOU.'],
  ["BUYING OR INVESTING,\\\\NTHIS IS WORTH EXPLORING.", 'THIS IS WORTH\\\\NEXPLORING.'],
  ["BUYING OR INVESTING?\\\\NTHIS IS WORTH IT.", 'THIS IS WORTH IT.'],
];
for (const [from, to] of swaps) {
  t = t.split(from).join(to);
}

fs.writeFileSync(p, t);
console.log('final caption patch');
