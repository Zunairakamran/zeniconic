const fs = require('fs');
const p = 'D:/video/scripts/marketing/render-deliver.mjs';
let t = fs.readFileSync(p, 'utf8');

const reuse = `
function reusePicture() {
  const file = resolve(workDir, 'deliver_focus-picture.mp4');
  const normalized = SEGMENTS.map((_, i) => resolve(workDir, \`deliver_focus-s\${String(i).padStart(2, '0')}.mp4\`));
  const durs = normalized.map(durOf);
  const starts = [0];
  let cursor = durs[0];
  for (let i = 1; i < SEGMENTS.length; i += 1) {
    const d = Math.min(T[SEGMENTS[i].trans], Math.max(0.05, cursor - 0.2));
    const offset = Math.max(0, cursor - d);
    starts.push(offset);
    cursor = offset + durs[i];
  }
  return { file, duration: durOf(file), starts };
}
`;

t = t.replace('function picture(name, focus) {', reuse + '\nfunction picture(name, focus) {');
t = t.replace(
  '  const pic = picture(name, variant.focus);',
  "  const pic = process.env.REUSE_PICTURE === '1' ? reusePicture() : picture(name, variant.focus);",
);

fs.writeFileSync(p, t);
console.log('reuse-picture mode added');
