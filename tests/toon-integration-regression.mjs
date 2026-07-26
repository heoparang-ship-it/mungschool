import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  html,
  /import \{ createToonChihuahua \} from '\.\/assets\/toon-chihuahua\.js\?v=/,
  'the production page must load the real-time toon rig'
);
assert.match(
  html,
  /const forceDog2D = new URLSearchParams\(location\.search\)\.get\('dog2d'\) === '1'/,
  'QA and WebGL recovery must retain an explicit 2D fallback route'
);
assert.match(
  html,
  /const TOON_DOG_POSE_HZ=12, TOON_DOG_CONTACT_HZ=15/,
  'body poses and contact poses must use authored stepped cadences'
);
assert.match(
  html,
  /warning=simExperience\.warningUntil>now/,
  'warning animation must be sampled every frame, not inferred from phase events'
);
assert.match(
  html,
  /hand3dRenderer\.render\(toonDogScene,hand3dCam\)[\s\S]*hand3dScene\.overrideMaterial=hand3dPrepass/,
  'opaque dog color must be rendered before the hand depth prepass on the shared camera'
);
assert.match(
  html,
  /if \(toonDogVisible\) \{[\s\S]*dogVeilCanvas\.style\.opacity='0'/,
  'the sprite-only pixel veil must be disabled after unified 3D depth is visible'
);
assert.match(
  html,
  /#dogSpriteWrap\.toonReady #dogSprite \{ opacity:0; visibility:hidden; \}/,
  'the sprite may disappear only after the first valid toon frame'
);
assert.match(
  html,
  /wrap\.dataset\.toonSharedDepth='true'/,
  'live visual QA must expose that dog and hand share depth'
);
assert.match(
  html,
  /if \(toonDogVisible \|\| dogSpriteReady\)/,
  'gameplay hit geometry must retain a stable visible-character anchor'
);

console.log('toon integration regression: PASS');
