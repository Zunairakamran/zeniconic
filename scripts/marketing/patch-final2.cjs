const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-final2.mjs';
let t = fs.readFileSync(p, 'utf8');

// 1. Presenter opens the focus cut; the elevator doors carry the lift line.
t = t.replace(
  "{ key: '12:0', start: 0.6, dur: 4.4, speed: slow, trans: 'cut' },",
  "{ key: '17:0', start: 1.0, dur: 4.4, speed: slow, trans: 'cut' },",
);
t = t.replace(
  "{ key: '17:1', start: 0.0, dur: 1.3, speed: 1, trans: 'zoomin' },",
  "{ key: '2:0', start: 0.0, dur: 3.0, speed: 1.1, trans: 'zoomin' },",
);
t = t.replace(
  "{ key: '17:1', start: 0.0, dur: 1.3, speed: 1, trans: 'zoomin' },",
  "{ key: '2:0', start: 0.0, dur: 3.0, speed: 1.1, trans: 'zoomin' },",
);

// 2. Focus pull lasts 2.6s (2x the previous 1.25s).
t = t.replace("if(lte(T,1.25),A*(T/1.25)+B*(1-T/1.25),A)", "if(lte(T,2.6),A*(T/2.6)+B*(1-T/2.6),A)");

// 3. Sequence voice starts so two lines can never overlap.
t = t.replace(
  "  const parts = [];\n  const tags = [];\n  let input = 1;\n  for (const voice of variant.voices) {\n    const ms = Math.round((starts[voice.seg] + voice.offset) * 1000);",
  "  const parts = [];\n  const tags = [];\n  const voiceAt = [];\n  let previousEnd = 0;\n  for (const voice of variant.voices) {\n    const length = durOf(resolve(AUDIO, voice.file));\n    const at = Math.max(starts[voice.seg] + voice.offset, previousEnd + (previousEnd > 0 ? 0.18 : 0));\n    voiceAt.push(at);\n    previousEnd = at + length;\n  }\n  let input = 1;\n  for (const [index, voice] of variant.voices.entries()) {\n    const ms = Math.round(voiceAt[index] * 1000);",
);

// 4. Cues follow the voice, not the shot.
t = t.replace("writeFileSync(ass, buildAss(variant.cues(starts)));", "writeFileSync(ass, buildAss(variant.cues(voiceAt)));");

// Cue builders now take voice start times.
t = t.replace(/function cuesV1\(starts\) \{\n  const at = \(i, o = 0\) => starts\[i\] \+ o;/, "function cuesV1(voice) {\n  const at = (i, o = 0) => voice[i] + o;");
t = t.replace(/function cuesV2\(starts\) \{\n  const at = \(i, o = 0\) => starts\[i\] \+ o;/, "function cuesV2(voice) {\n  const at = (i, o = 0) => voice[i] + o;");

// V1: hook 0, bridge 1, ready 2, lift 3, price 4, cta 5.
t = t.replace("{ start: at(0, 0.08), end: at(0, 2.0), text: 'WHY WAIT FOR YEARS?', accent: 3 },", "{ start: at(0, 0.0), end: at(0, 1.9), text: 'WHY WAIT FOR YEARS?', accent: 3 },");
t = t.replace("{ start: at(0, 2.0), end: at(0, 4.1), text: 'YOUR DREAM HOME\\\\NIS READY.', accent: 1 },", "{ start: at(0, 1.9), end: at(0, 3.7), text: 'YOUR DREAM HOME\\\\NIS READY.', accent: 1 },");
t = t.replace("{ start: at(2, 0.06), end: at(2, 1.8), text: 'THOUGHTFULLY\\\\NDESIGNED SPACES.', accent: 0 },", "{ start: at(1, 0.0), end: at(1, 1.7), text: 'THOUGHTFULLY\\\\NDESIGNED SPACES.', accent: 0 },");
t = t.replace("{ start: at(2, 1.8), end: at(2, 3.1), text: 'MODERN INTERIORS.', accent: 2 },", "{ start: at(1, 1.7), end: at(1, 3.0), text: 'MODERN INTERIORS.', accent: 2 },");
t = t.replace("{ start: at(2, 3.1), end: at(2, 5.0), text: 'EVERYTHING YOU\\\\NNEED, AT HOME.', accent: 2 },", "{ start: at(1, 3.0), end: at(1, 4.8), text: 'EVERYTHING YOU\\\\NNEED, AT HOME.', accent: 2 },");
t = t.replace("{ start: at(6, 0.06), end: at(6, 2.2), text: 'AND YES,\\\\NIT IS READY.', accent: 3 },", "{ start: at(2, 0.0), end: at(2, 2.2), text: 'AND YES,\\\\NIT IS READY.', accent: 3 },");
t = t.replace("{ start: at(9, 0.04), end: at(9, 2.8), text: 'PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOU.', accent: 1 },", "{ start: at(3, 0.0), end: at(3, 2.7), text: 'PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOU.', accent: 1 },");
t = t.replace("{ start: at(10, 0.12), end: at(10, 3.4), text: 'FROM AED 1,400,000', style: 'Price' },", "{ start: at(4, 0.0), end: at(4, 3.4), text: 'FROM AED 1,400,000', style: 'Price' },");
t = t.replace("{ start: at(10, 1.0), end: at(10, 3.4), text: 'ONE-BEDROOM RESIDENCES · DUBAI MARINA', style: 'Sub' },", "{ start: at(4, 0.9), end: at(4, 3.4), text: 'ONE-BEDROOM RESIDENCES · DUBAI MARINA', style: 'Sub' },");
t = t.replace("{ start: at(11, 0.08), end: at(11, 4.6), text: 'THIS IS WORTH\\\\NEXPLORING.', accent: 3 },", "{ start: at(5, 0.0), end: at(5, 4.8), text: 'THIS IS WORTH\\\\NEXPLORING.', accent: 3 },");
t = t.replace("{ start: at(11, 0.6), end: at(12, 2.6), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },", "{ start: at(5, 0.6), end: at(5, 4.8), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },");

// V2: hook 0, bridge 1, lift 2, price 3, cta 4.
t = t.replace("{ start: at(0, 0.06), end: at(0, 2.4), text: 'WHY WAIT FOR YEARS?', accent: 3 },", "{ start: at(0, 0.0), end: at(0, 2.2), text: 'WHY WAIT FOR YEARS?', accent: 3 },");
t = t.replace("{ start: at(0, 2.4), end: at(0, 4.0), text: 'YOUR DREAM HOME\\\\NIS READY.', accent: 1 },", "{ start: at(0, 2.2), end: at(0, 3.9), text: 'YOUR DREAM HOME\\\\NIS READY.', accent: 1 },");
t = t.replace("{ start: at(2, 0.06), end: at(2, 2.0), text: 'THOUGHTFULLY\\\\NDESIGNED.', accent: 0 },", "{ start: at(1, 0.0), end: at(1, 1.9), text: 'THOUGHTFULLY\\\\NDESIGNED.', accent: 0 },");
t = t.replace("{ start: at(4, 0.06), end: at(4, 2.0), text: 'MODERN INTERIORS.', accent: 1 },", "{ start: at(1, 1.9), end: at(1, 3.2), text: 'MODERN INTERIORS.', accent: 1 },");
t = t.replace("{ start: at(5, 0.06), end: at(5, 2.4), text: 'EVERYTHING YOU\\\\NNEED, AT HOME.', accent: 0 },", "{ start: at(1, 3.2), end: at(1, 4.9), text: 'EVERYTHING YOU\\\\NNEED, AT HOME.', accent: 0 },");
t = t.replace("{ start: at(7, 0.04), end: at(7, 2.6), text: 'PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOU.', accent: 1 },", "{ start: at(2, 0.0), end: at(2, 2.7), text: 'PRIVATE ELEVATORS.\\\\NSTRAIGHT TO YOU.', accent: 1 },");
t = t.replace("{ start: at(8, 0.1), end: at(8, 3.0), text: 'FROM AED 1,400,000', style: 'Price' },", "{ start: at(3, 0.0), end: at(3, 3.2), text: 'FROM AED 1,400,000', style: 'Price' },");
t = t.replace("{ start: at(9, 0.08), end: at(9, 3.6), text: 'THIS IS WORTH\\\\NEXPLORING.', accent: 3 },", "{ start: at(4, 0.0), end: at(4, 4.6), text: 'THIS IS WORTH\\\\NEXPLORING.', accent: 3 },");
t = t.replace("{ start: at(9, 0.5), end: at(10, 2.6), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },", "{ start: at(4, 0.6), end: at(4, 4.8), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },");

fs.writeFileSync(p, t);
console.log('final2 patched: presenter open, elevator lift, 2.6s focus, sequenced audio');
