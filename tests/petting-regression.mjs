import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  html,
  /const axis=Math\.abs\(dy\)>Math\.abs\(dx\)\*\.58 \? 'y' : 'x'/,
  'petting must accept vertical and diagonal head strokes, not horizontal reversals only'
);
assert.match(
  html,
  /const realHeadPet=hand\.actual && hand3dTouch\.part==='head'/,
  'real-camera mission progress must require contact with the dog head'
);
assert.match(
  html,
  /const depthTouch=clamp01\(\(znRaw-\(needZ-\.08\)\)\/\.14\)/,
  'touch strength must combine continuous depth with surface proximity'
);
assert.match(
  html,
  /id="petFurFx"/,
  'head contact must have a fur-local visual response'
);
assert.doesNotMatch(
  html,
  /const lat=Math\.min\(700,simHandDraw\.speed\)/,
  'global hand speed must not score petting when the hand is not moving across the fur'
);

console.log('petting regression: PASS');
