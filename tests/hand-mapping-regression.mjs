import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Live landmark coordinates must retain MediaPipe's rotation direction.
assert.match(
  html,
  /new THREE\.Vector3\(\)\.crossVectors\(u,v\)/,
  'hand orientation must preserve the tracked u×v basis'
);
assert.doesNotMatch(
  html,
  /new THREE\.Vector3\(\)\.crossVectors\(v,u\)/,
  'do not swap palm/back by reversing the live tracking basis'
);

// Palm/back correction belongs to the model's fixed finger axis.
assert.match(
  html,
  /const HAND3D_ORIENT = \[Math\.PI\/2, 0, 0\]/,
  'the GLB surface correction must not cancel the tracked u×v basis'
);

const near = Number(html.match(/const HAND3D_SIZE_NEAR = ([.\d]+)/)?.[1]);
const far = Number(html.match(/const HAND3D_SIZE_FAR\s+= ([.\d]+)/)?.[1]);
assert.ok(Number.isFinite(near) && Number.isFinite(far), 'depth size constants must be readable');
assert.ok(near >= 0.84, `near hand size must restore strong depth; got ${near}`);
assert.ok(far <= 0.18, `far hand size must reach deep into the room; got ${far}`);
assert.ok(near / far >= 4.7, `depth size contrast must be at least 4.7×; got ${(near / far).toFixed(2)}×`);

assert.match(
  html,
  /targetZ=3\.9-zn\*3\.72/,
  'depth must still traverse the full room from z=3.9 to z=0.18'
);

console.log('hand mapping regression: PASS');
