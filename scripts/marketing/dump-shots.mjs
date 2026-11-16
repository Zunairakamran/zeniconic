import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const index = JSON.parse(
  readFileSync(resolve('data/listings/marina-gate-1/footage_index.tagged.json'), 'utf8'),
);

const rows = [];
for (const [ci, clip] of index.clips.entries()) {
  for (const [si, shot] of clip.shots.entries()) {
    rows.push({
      key: `${ci}:${si}`,
      file: resolve(clip.file),
      name: clip.file.split(/[\\/]/).pop(),
      orientation: clip.probe?.orientation,
      width: clip.probe?.width,
      height: clip.probe?.height,
      inSec: shot.startSec,
      outSec: shot.endSec,
      durationSec: shot.durationSec,
      room: shot.tags?.room ?? 'unknown',
      move: shot.tags?.cameraMove ?? '',
      score: shot.tags?.score ?? 0,
      points: shot.tags?.sellingPoints ?? [],
      defects: shot.tags?.defects ?? [],
      bestInSec: shot.tags?.bestInSec ?? shot.startSec,
      bestOutSec: shot.tags?.bestOutSec ?? shot.endSec,
    });
  }
}

writeFileSync(resolve('data/marketing/shots.json'), JSON.stringify(rows, null, 2));
console.log(rows.map((r) => `${r.key} ${r.room.padEnd(8)} ${r.durationSec.toFixed(1)}s ${r.orientation} ${r.move} score=${Number(r.score).toFixed(2)}`).join('\n'));
