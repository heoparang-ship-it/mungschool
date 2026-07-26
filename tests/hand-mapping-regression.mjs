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

// The front camera looks from the dog/screen toward the player, while the
// rendered hand must be seen from the player's eyes toward the dog. Conjugating
// by a z reflection reverses the observed turn without changing neutral pose.
assert.match(
  html,
  /viewFlip:new THREE\.Matrix4\(\)\.makeScale\(1,1,-1\)/,
  'hand orientation must declare the camera-to-first-person view transform'
);
assert.match(
  html,
  /_hq\.m\.premultiply\(_hq\.viewFlip\)\.multiply\(_hq\.viewFlip\)/,
  'hand rotation must be conjugated into the first-person view frame'
);

// A positive camera-space yaw must become a negative first-person yaw. This is
// the invariant that makes the right thumb sweep toward the player instead of
// rotating like a person standing on the dog's side.
const c = Math.cos(Math.PI / 4);
const s = Math.sin(Math.PI / 4);
const cameraYaw = [
  [c, 0, s],
  [0, 1, 0],
  [-s, 0, c],
];
const reflectZ = [1, 1, -1];
const firstPersonYaw = cameraYaw.map((row, y) =>
  row.map((value, x) => reflectZ[y] * value * reflectZ[x])
);
assert.ok(cameraYaw[0][2] > 0, 'fixture must start with positive camera yaw');
assert.ok(firstPersonYaw[0][2] < 0, 'first-person conversion must reverse the turn direction');

// Position tracking is already correct and must remain selfie-mirrored.
assert.match(
  html,
  /return \{ x: mirrored \? W - px : px, y: oy \+ ny\*dh \};/,
  'first-person orientation changes must not alter left/right position tracking'
);

// Palm/back correction belongs to the model's fixed finger axis.
assert.match(
  html,
  /const HAND3D_ORIENT = \[-Math\.PI\/2, 0, 0\]/,
  'a real palm facing the camera must render the GLB palm surface'
);

const near = Number(html.match(/const HAND3D_SIZE_NEAR = ([.\d]+)/)?.[1]);
const far = Number(html.match(/const HAND3D_SIZE_FAR\s+= ([.\d]+)/)?.[1]);
assert.ok(Number.isFinite(near) && Number.isFinite(far), 'depth size constants must be readable');
assert.ok(near >= 0.46 && near <= 0.56, `desktop near size must stay first-person but bounded; got ${near}`);
assert.ok(far >= 0.27 && far <= 0.34, `desktop reach size must stay readable; got ${far}`);
assert.ok(near / far >= 1.45 && near / far <= 1.85,
  `depth size contrast must be physically plausible; got ${(near / far).toFixed(2)}×`);

assert.match(
  html,
  /const PALM_ANCHOR_IDS = \[0,5,9,13,17\]/,
  'screen position must follow the rigid palm instead of all 21 articulated landmarks'
);
assert.match(
  html,
  /const maxPred=Math\.max\(8,Math\.min\(22,/,
  'latency prediction must be pixel-capped so stopping cannot overshoot'
);
assert.match(
  html,
  /stableScalarStep\(hand3dZn,hand3dZnT,dt,/,
  'visual hand size must have an independent deadband and slew limiter'
);

const smoothstep = q => q*q*(3-2*q);
const sizeAt = z => near+(far-near)*smoothstep(Math.max(0,Math.min(1,z)));
assert.ok(sizeAt(0) > sizeAt(1), 'first-person reach must still get smaller with depth');
const jitterPx = Math.abs(sizeAt(.48)-sizeAt(.52))*720;
assert.ok(jitterPx < 12, `±2% depth noise must stay below 12px before temporal filtering; got ${jitterPx.toFixed(1)}px`);
assert.match(
  html,
  /const HAND3D_SIZE_NEAR_MOBILE = \.50, HAND3D_SIZE_FAR_MOBILE = \.30/,
  'mobile hand must not cover the dog with a larger viewport fraction'
);

assert.match(
  html,
  /targetZ=3\.9-zn\*3\.72/,
  'depth must still traverse the full room from z=3.9 to z=0.18'
);

console.log('hand mapping regression: PASS');
