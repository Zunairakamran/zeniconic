const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-deliver.mjs';
let t = fs.readFileSync(p, 'utf8');

// Font palette for the 2-frame cycling hook.
t = t.replace(
  "const BRASS = '&H4A8AB0&';",
  "const BRASS = '&H4A8AB0&';\nconst HOOK_FONTS = ['Bricolage Grotesque', 'Archivo Black', 'Bebas Neue', 'Space Grotesk', 'DM Serif Display', 'Anton'];",
);

// Extra styles, one per hook font, centred.
t = t.replace(
  "Style: Brand,Archivo,30,",
  "Style: HK0,Bricolage Grotesque,92,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,5,40,40,0,1\n" +
    "Style: HK1,Archivo Black,88,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,5,40,40,0,1\n" +
    "Style: HK2,Bebas Neue,110,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,5,40,40,0,1\n" +
    "Style: HK3,Space Grotesk,88,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-1,0,1,3,2,5,40,40,0,1\n" +
    "Style: HK4,DM Serif Display,86,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,1,3,2,5,40,40,0,1\n" +
    "Style: HK5,Anton,100,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,5,40,40,0,1\n" +
    'Style: Brand,Archivo,30,',
);

// Replace the static location strap with the cycling hook plus a short strap.
t = t.replace(
  "  cues.push({ start: 0.35, end: 3.15, text: 'DUBAI MARINA\\\\NABOVE THE WALK', style: 'Place', accent: 0 });",
  "  for (let i = 0; i < 25; i += 1) {\n    const start = 0.25 + i * 0.07;\n    cues.push({ start, end: start + 0.07, text: 'DUBAI MARINA', style: `HK${i % HOOK_FONTS.length}` });\n  }\n  cues.push({ start: 2.05, end: 3.15, text: 'ABOVE THE WALK', style: 'Place' });",
);

fs.writeFileSync(p, t);
console.log('font-cycling hook added');
