const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-deliver.mjs';
let t = fs.readFileSync(p, 'utf8');

// Hook over the marina window; free the close shot; every shot unique.
t = t.replace("{ key: '12:0', start: 0.6, dur: 3.6, speed: 1.12, trans: 'cut' },", "{ key: '11:0', start: 0.6, dur: 3.6, speed: 1.12, trans: 'cut' },");
t = t.replace("{ key: '10:0', start: 1.0, dur: 2.8, speed: 1.15, trans: 'cut' },", "{ key: '5:0', start: 0.8, dur: 2.8, speed: 1.15, trans: 'cut' },");
t = t.replace("{ key: '11:0', start: 1.0, dur: 4.0, speed: 1.12, trans: 'hblur' },", "{ key: '12:0', start: 1.0, dur: 4.0, speed: 1.12, trans: 'hblur' },");
t = t.replace("{ key: '8:0', start: 2.6, dur: 3.2, speed: 1.12, trans: 'fade' },", "{ key: '10:0', start: 1.0, dur: 3.2, speed: 1.12, trans: 'fade' },");

// Readable end card and price sub.
t = t.replace('Style: Place,Bricolage Grotesque,72,', 'Style: Place,Bricolage Grotesque,78,');
t = t.replace('Style: Sub,Archivo,38,', 'Style: Sub,Archivo,44,');

// Slightly stronger outline on the end card.
t = t.replace(
  'cues.push({ start: voiceAt[5], end: voiceAt[5] + 4.9, text: \'PRIVATE VIEWING.\', style: \'Place\', accent: undefined });',
  'cues.push({ start: voiceAt[5], end: voiceAt[5] + 4.9, text: \'{\\\\bord4}PRIVATE VIEWING.\', style: \'Place\', accent: undefined });',
);

fs.writeFileSync(p, t);
console.log('shots rebalanced and end card strengthened');
