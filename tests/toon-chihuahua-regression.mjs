import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleUrl = new URL('../assets/toon-chihuahua.js', import.meta.url);
const source = fs.readFileSync(moduleUrl, 'utf8');

assert.match(
  source,
  /export function createToonChihuahua\(THREE, options = \{\}\)/,
  'the module must expose the agreed dependency-injected factory API'
);
assert.doesNotMatch(
  source,
  /new THREE\.(?:Scene|PerspectiveCamera|OrthographicCamera|WebGLRenderer)/,
  'the character module must not create a scene, camera or renderer'
);
assert.doesNotMatch(
  source,
  /\b(?:fetch|GLTFLoader|TextureLoader)\s*\(/,
  'the procedural character must not depend on an external model or texture'
);
assert.match(
  source,
  /Three hard steps keep the light graphic/,
  'the material must declare a three-step cel ramp'
);
assert.match(
  source,
  /side: THREE\.BackSide/,
  'the outline must use an inverted hull'
);
assert.match(
  source,
  /eyes -> head -> ears -> torso/,
  'the response order must remain explicit and reviewable'
);
assert.match(
  source,
  /Stance paws stay exactly at their authored ground height/,
  'walking must preserve stance-foot contact'
);

const resources = [];

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.set(x, y, z);
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  setScalar(value) {
    return this.set(value, value, value);
  }
}

class Euler extends Vector3 {}

class Object3D {
  constructor() {
    this.name = '';
    this.children = [];
    this.parent = null;
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.userData = {};
    this.visible = true;
  }
  add(...children) {
    for (const child of children) {
      if (child.parent) child.parent.remove(child);
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
    return this;
  }
  traverse(visitor) {
    visitor(this);
    for (const child of this.children) child.traverse(visitor);
  }
}

class Group extends Object3D {}

class Disposable {
  constructor(...args) {
    this.args = args;
    this.disposed = false;
    resources.push(this);
  }
  dispose() {
    this.disposed = true;
  }
}

class Geometry extends Disposable {}
class SphereGeometry extends Geometry {}
class CapsuleGeometry extends Geometry {}
class ConeGeometry extends Geometry {}
class BoxGeometry extends Geometry {}
class TorusGeometry extends Geometry {}
class CircleGeometry extends Geometry {}
class RingGeometry extends Geometry {}

class Material extends Disposable {
  constructor(values = {}) {
    super(values);
    this.userData = {};
    Object.assign(this, values);
  }
}
class MeshToonMaterial extends Material {}
class MeshBasicMaterial extends Material {}

class DataTexture extends Disposable {
  constructor(data, width, height, format) {
    super(data, width, height, format);
    this.data = data;
    this.width = width;
    this.height = height;
    this.format = format;
  }
}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.isMesh = true;
  }
}

const THREE = {
  Group,
  Mesh,
  MeshToonMaterial,
  MeshBasicMaterial,
  DataTexture,
  SphereGeometry,
  CapsuleGeometry,
  ConeGeometry,
  BoxGeometry,
  TorusGeometry,
  CircleGeometry,
  RingGeometry,
  RGBAFormat: 'RGBAFormat',
  NearestFilter: 'NearestFilter',
  NoColorSpace: 'NoColorSpace',
  BackSide: 'BackSide',
  DoubleSide: 'DoubleSide',
  AdditiveBlending: 'AdditiveBlending',
};

const encodedSource = Buffer.from(source).toString('base64');
const characterModule = await import(`data:text/javascript;base64,${encodedSource}`);
const { createToonChihuahua } = characterModule;
assert.equal(typeof createToonChihuahua, 'function');
assert.equal(characterModule.default, createToonChihuahua);

const character = createToonChihuahua(THREE, {
  quality: 'low',
  initialTrust: 0.4,
});
assert.deepEqual(
  Object.keys(character).sort(),
  ['dispose', 'group', 'update'],
  'factory must return only the documented integration surface'
);

const names = [];
const toonRoles = [];
character.group.traverse(node => {
  names.push(node.name);
  if (node.userData?.toonRole) toonRoles.push(node.userData.toonRole);
});

for (const expected of [
  'head-pivot',
  'earL-pivot',
  'earR-pivot',
  'eyeL-root',
  'eyeR-root',
  'muzzle-expression-rig',
  'legFL-grounded-rig',
  'legFR-grounded-rig',
  'legBL-grounded-rig',
  'legBR-grounded-rig',
  'tail-rig',
  'collar-rig',
]) {
  assert.ok(names.includes(expected), `missing authored chihuahua part: ${expected}`);
}

assert.ok(
  toonRoles.filter(role => role === 'inverted-hull-outline').length >= 20,
  'the silhouette must be built from visible inverted-hull ink, not metadata alone'
);
assert.ok(
  toonRoles.filter(role => role === 'cel-fill').length >= 30,
  'the procedural full body must contain enough authored cel surfaces'
);
assert.equal(character.group.userData.toonBands, 3);
assert.equal(character.group.userData.performance.externalAssets, 0);
assert.equal(character.group.userData.performance.quality, 'low');
assert.ok(
  character.group.userData.performance.estimatedDrawCalls <= 100,
  `low quality must remain mobile-sized; got ${character.group.userData.performance.estimatedDrawCalls} draw calls`
);

character.update({
  time: 1 / 60,
  gazeX: 1,
  gazeY: -0.4,
  breathing: 1,
  trust: 0.7,
});
const follow = character.group.userData.animation;
assert.ok(
  follow.eyeFollowX > follow.headFollowX
    && follow.headFollowX > follow.earFollowX
    && follow.earFollowX > follow.bodyFollowX,
  'one update must visibly preserve eye -> head -> ear -> body response latency'
);

character.update({
  time: 0.5,
  gazeX: 0.8,
  gazeY: 0.2,
  breathing: 1,
  walk: 1,
  trust: 1,
  petStrength: 1,
  touchX: -0.7,
  touchY: -0.4,
  reaction: 'happy',
});
const active = character.group.userData.animation;
assert.ok(active.groundedPaws >= 2, 'a diagonal pair of paws must remain planted while walking');
assert.ok(active.petCompression > 0, 'pet input must drive head compression');
assert.ok(character.group.userData.toonRig.head.scale.y < 1, 'petting must visibly squash the head');
assert.ok(names.includes('tongue'), 'happy expression must have a drawable tongue');

character.update({
  time: 0.55,
  walk: 1,
  trust: 1,
  petStrength: 1,
  reaction: 'happy',
});
assert.equal(character.group.userData.animation.reaction, 'happy');

character.dispose();
assert.equal(character.group.userData.disposed, true);
assert.ok(resources.length > 0);
assert.ok(resources.every(resource => resource.disposed), 'dispose must release every owned GPU resource');
character.dispose();

console.log('toon chihuahua regression: PASS');
