const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-deliver.mjs';
let t = fs.readFileSync(p, 'utf8');

// All hook styles top-centre at the same optical position.
t = t.replace(/,2,5,30,30,240,1/g, ',2,8,30,30,320,1');

// Card: larger, with a translucent plate so it reads on cream walls.
t = t.replace(
  /Style: List,Archivo,38,([^\n]+),1,2,1,5,80,80,0,1/,
  'Style: List,Archivo,44,$1,3,12,0,5,60,60,0,1',
);
t = t.replace(
  'Style: List,Archivo,44,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,3,12,0,5,60,60,0,1',
  'Style: List,Archivo,44,${PAPER},&H000000FF,&H64000000,&H90000000,0,0,0,0,100,100,0,0,3,12,0,5,60,60,0,1',
);

// End-card sizes.
t = t.replace('Style: Place,Bricolage Grotesque,66,', 'Style: Place,Bricolage Grotesque,72,');
t = t.replace('Style: Sub,Archivo,36,', 'Style: Sub,Archivo,38,');

// Hook cues must not fade: 2-frame cues with a 110 ms fade overlap each other.
t = t.replace(
  "cues.push({ start, end: start + 0.07, text: 'DUBAI",
  "cues.push({ instant: true, start, end: start + 0.07, text: 'DUBAI",
);
t = t.replace(
  'return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${cue.style ?? \'Cap\'},,0,0,0,,{\\\\fad(110,90)\\\\fscx97\\\\fscy97\\\\t(0,180,\\\\fscx100\\\\fscy100)}${text}`;',
  'const prefix = cue.instant ? \'{\\\\an8}\' : \'{\\\\fad(110,90)\\\\fscx97\\\\fscy97\\\\t(0,180,\\\\fscx100\\\\fscy100)}\';\n    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${cue.style ?? \'Cap\'},,0,0,0,,${prefix}${text}`;',
);

fs.writeFileSync(p, t);
console.log('hook alignment and card plate fixed');
