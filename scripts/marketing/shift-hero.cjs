const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-hero.mjs';
let t = fs.readFileSync(p, 'utf8');

// Voice placements and cue anchors both move with the two inserted shots.
t = t.replace(/seg: 10,/g, 'seg: X10,');
t = t.replace(/seg: 11,/g, 'seg: X11,');
t = t.replace(/seg: 12,/g, 'seg: X12,');
t = t.replace(/seg: X10,/g, 'seg: 12,');
t = t.replace(/seg: X11,/g, 'seg: 13,');
t = t.replace(/seg: X12,/g, 'seg: 14,');

t = t.replace(/at\(10,/g, 'at(X10,');
t = t.replace(/at\(11,/g, 'at(X11,');
t = t.replace(/at\(12,/g, 'at(X12,');
t = t.replace(/at\(13,/g, 'at(X13,');
t = t.replace(/at\(X10,/g, 'at(12,');
t = t.replace(/at\(X11,/g, 'at(13,');
t = t.replace(/at\(X12,/g, 'at(14,');
t = t.replace(/at\(X13,/g, 'at(15,');

fs.writeFileSync(p, t);
console.log('shifted segs and cue anchors');
