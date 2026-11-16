const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-hero.mjs';
let t = fs.readFileSync(p, 'utf8');

t = t.replace(/�/g, '·');

const swaps = [
  ["'WHY WAIT FOR YEARS\\\\NWHEN YOUR DREAM HOME'", "'WHY WAIT FOR YEARS?'"],
  ["'IS ALREADY READY.'", "'YOUR DREAM HOME\\\\NIS READY.'"],
  ["'THOUGHTFULLY DESIGNED\\\\NSPACES.'", "'THOUGHTFULLY\\\\NDESIGNED SPACES.'"],
  ["'MODERN INTERIORS.\\\\NEVERYTHING YOU NEED'", "'MODERN INTERIORS.'"],
  ["'TO FEEL\\\\NAT HOME.'", "'EVERYTHING YOU\\\\NNEED, AT HOME.'"],
  ["'AND YES,\\\\NYOUR NEW HOME IS READY.'", "'AND YES,\\\\nIT'S READY.'"],
  ["'PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOUR APARTMENT.'", "'PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOU.'"],
  ["'BUYING OR INVESTING,\\\\NTHIS IS WORTH EXPLORING.'", "'THIS IS WORTH\\\\NEXPLORING.'"],
  ["'BUYING OR INVESTING?\\\\NTHIS IS WORTH IT.'", "'THIS IS WORTH IT.'"],
  ["'YOUR NEW HOME\\\\NIS READY.'", "'IT'S READY.'"],
  ["'IS ALREADY READY.\\\\NTHOUGHTFULLY DESIGNED.'", "'THOUGHTFULLY\\\\NDESIGNED.'"],
  ["'MODERN INTERIORS.\\\\NEVERYTHING YOU NEED.'", "'MODERN INTERIORS.'"],
];
for (const [from, to] of swaps) {
  t = t.replace(from, to);
}

fs.writeFileSync(p, t);
console.log('captions tightened');
