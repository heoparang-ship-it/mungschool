import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleSource = fs.readFileSync(
  new URL('../assets/art-chihuahua.js', import.meta.url),
  'utf8'
);
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const conceptPath = new URL(
  '../assets/concepts/chihuahua-2p5d-cel-concept-sheet-v1.png',
  import.meta.url
);

assert.ok(fs.statSync(conceptPath).size > 1_000_000, 'the supplied high-resolution art sheet must ship');
assert.match(
  html,
  /import \{ createArtChihuahua, configureDepthContactProxy \} from '\.\/assets\/art-chihuahua\.js\?v=/,
  'the production page must load the original-art renderer'
);
assert.match(
  html,
  /TOON_DOG_ART_SOURCE='assets\/concepts\/chihuahua-2p5d-cel-concept-sheet-v1\.png'/,
  'the visible production character must point at the supplied original art'
);
assert.match(
  moduleSource,
  /context\.drawImage\(\s*image,\s*crop\.x,/,
  'the card textures must be cut directly from source-sheet pixels'
);
assert.match(
  moduleSource,
  /Removes only the pale background connected to the crop boundary/,
  'background removal must preserve enclosed cream fur'
);
assert.match(
  moduleSource,
  /colorWrite: false,[\s\S]*depthWrite: true/,
  'the procedural rig must write depth without writing visible color'
);
assert.match(
  moduleSource,
  /node\.userData\?\.toonRole === 'cel-fill'/,
  'only solid proxy surfaces may participate in hidden depth'
);
assert.match(
  moduleSource,
  /group\.userData\.visibleGeometry = 'concept-sheet-pixels'/,
  'runtime diagnostics must state that the visible geometry is original art'
);
assert.match(
  html,
  /style:'original-art-2\.5d-with-depth-proxy'/,
  'telemetry must distinguish original art from the previous procedural dummy'
);
assert.doesNotMatch(
  moduleSource,
  /MeshToonMaterial|SphereGeometry|CapsuleGeometry|ConeGeometry/,
  'the visible art module must not rebuild the character from primitives'
);

console.log('original art chihuahua regression: PASS');
