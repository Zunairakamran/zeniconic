const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-deliver.mjs';
let t = fs.readFileSync(p, 'utf8');

// Bigger, upper-third hook, with the accent word in brass.
t = t.replace(/Style: HK0,Bricolage Grotesque,92,([^\n]+)5,40,40,0,1/, 'Style: HK0,Bricolage Grotesque,118,$15,40,40,240,1');
t = t.replace(/Style: HK1,Archivo Black,88,([^\n]+)5,40,40,0,1/, 'Style: HK1,Archivo Black,110,$15,30,30,240,1');
t = t.replace(/Style: HK2,Bebas Neue,110,([^\n]+)5,40,40,0,1/, 'Style: HK2,Bebas Neue,150,$15,30,30,240,1');
t = t.replace(/Style: HK3,Space Grotesk,88,([^\n]+)5,40,40,0,1/, 'Style: HK3,Space Grotesk,112,$15,30,30,240,1');
t = t.replace(/Style: HK4,DM Serif Display,86,([^\n]+)5,40,40,0,1/, 'Style: HK4,DM Serif Display,108,$15,30,30,240,1');
t = t.replace(/Style: HK5,Anton,100,([^\n]+)5,40,40,0,1/, 'Style: HK5,Anton,140,$15,30,30,240,1');

t = t.replace(
  "cues.push({ start, end: start + 0.07, text: 'DUBAI MARINA', style: `HK${i % HOOK_FONTS.length}` });",
  "cues.push({ start, end: start + 0.07, text: 'DUBAI\\\\N{\\\\c' + BRASS + '}MARINA{\\\\c' + PAPER + '}', style: `HK${i % HOOK_FONTS.length}` });",
);

// Proximity card: start after the ready line, centred, short rows, no inline tags.
t = t.replace(
  "  cues.push({\n    start: starts[9] + 0.15,\n    end: starts[9] + 2.45,",
  "  cues.push({\n    start: Math.max(starts[9] + 0.15, voiceAt[2] + 2.35),\n    end: Math.max(starts[9] + 0.15, voiceAt[2] + 2.35) + 2.5,",
);
t = t.replace(
  /text: 'MINUTES FROM\\N\{[^']+'/,
  "text: 'MINUTES FROM\\\\N MARINA WALK 1 MIN\\\\N SPINNEYS 3 MIN\\\\N MARINA MALL 5 MIN\\\\N JBR BEACH 10 MIN'",
);

// End-card sizes.
t = t.replace("Style: Place,Bricolage Grotesque,58,", "Style: Place,Bricolage Grotesque,66,");
t = t.replace("Style: Sub,Archivo,34,", "Style: Sub,Archivo,36,");

fs.writeFileSync(p, t);
console.log('hook, card and end card tightened');
