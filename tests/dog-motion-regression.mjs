import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function renderSimulationDog(now)');
const end = html.indexOf('function tickDogSprite(now)', start);
assert.ok(start > 0 && end > start, 'simulation dog renderer must exist');
const renderer = html.slice(start, end);

assert.match(
  html,
  /const SIM_DOG_TRACKS = \[/,
  'dog phases must have explicit game animation tracks'
);
assert.match(
  renderer,
  /drawDogSource\(src,1\)/,
  'simulation dog must draw exactly one registered sprite cell'
);
assert.doesNotMatch(
  renderer,
  /drawDogSource\(srcA|drawDogSource\(srcB|blend/,
  'full-body sprite cells must never be alpha-crossfaded into a double image'
);
assert.match(
  renderer,
  /const gazeX=hand\?/,
  'dog motion must visually attend to the tracked hand'
);
assert.match(
  renderer,
  /touchingHead&&phase>=3 \? SIM_DOG_PET_TRACK/,
  'head contact must switch the dog from approach motion to receiving-pet motion'
);
assert.match(
  renderer,
  /const stepLift=walking\?/,
  'approach animation must have an independent footstep weight shift'
);
assert.match(
  html,
  /Number\.isFinite\(handDebugX\)\?clamp01\(handDebugX\)/,
  'visual QA must be able to pin the synthetic hand horizontally'
);
assert.match(
  html,
  /Number\.isFinite\(handDebugY\)\?clamp01\(handDebugY\)/,
  'visual QA must be able to pin the synthetic hand vertically'
);

console.log('dog motion regression: PASS');
