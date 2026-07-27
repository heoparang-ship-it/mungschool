/**
 * Mungschool original-art Chihuahua renderer.
 *
 * The visible character is cut directly from the supplied concept sheet at
 * runtime. The procedural rig stays in the scene only as a depth/contact proxy;
 * none of its primitive geometry is allowed to write color.
 */

const DEFAULT_VIEWS = {
  front: { x: 104, y: 18, width: 424, height: 520 },
  threeQuarter: { x: 548, y: 12, width: 474, height: 526 },
  profile: { x: 1064, y: 8, width: 548, height: 530 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const signed = value => clamp(Number.isFinite(Number(value)) ? Number(value) : 0, -1, 1);
const unit = value => clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1);

function loadImage(sourceUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`original art failed to load: ${sourceUrl}`));
    image.src = sourceUrl;
  });
}

/**
 * Removes only the pale background connected to the crop boundary. Cream fur
 * remains intact because the source drawing's ink silhouette encloses it.
 */
function makeCutoutCanvas(image, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  const pixels = context.getImageData(0, 0, crop.width, crop.height);
  const data = pixels.data;
  const count = crop.width * crop.height;
  const outside = new Uint8Array(count);
  const queue = new Int32Array(count);
  let readAt = 0;
  let writeAt = 0;

  const corners = [
    0,
    crop.width - 1,
    (crop.height - 1) * crop.width,
    count - 1,
  ];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  for (const pixel of corners) {
    const offset = pixel * 4;
    bgR += data[offset];
    bgG += data[offset + 1];
    bgB += data[offset + 2];
  }
  bgR /= corners.length;
  bgG /= corners.length;
  bgB /= corners.length;

  const isPaper = pixel => {
    const offset = pixel * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const distance =
      (r - bgR) * (r - bgR)
      + (g - bgG) * (g - bgG)
      + (b - bgB) * (b - bgB);
    return r > 158 && g > 142 && b > 126 && max - min < 76 && distance < 13456;
  };

  const enqueue = pixel => {
    if (pixel < 0 || pixel >= count || outside[pixel] || !isPaper(pixel)) return;
    outside[pixel] = 1;
    queue[writeAt++] = pixel;
  };

  for (let x = 0; x < crop.width; x += 1) {
    enqueue(x);
    enqueue((crop.height - 1) * crop.width + x);
  }
  for (let y = 1; y < crop.height - 1; y += 1) {
    enqueue(y * crop.width);
    enqueue(y * crop.width + crop.width - 1);
  }

  while (readAt < writeAt) {
    const pixel = queue[readAt++];
    const x = pixel % crop.width;
    if (x > 0) enqueue(pixel - 1);
    if (x < crop.width - 1) enqueue(pixel + 1);
    if (pixel >= crop.width) enqueue(pixel - crop.width);
    if (pixel < count - crop.width) enqueue(pixel + crop.width);
  }

  for (let pixel = 0; pixel < count; pixel += 1) {
    if (outside[pixel]) data[pixel * 4 + 3] = 0;
  }

  // One-pixel edge feather keeps the original antialiasing without a paper halo.
  for (let y = 1; y < crop.height - 1; y += 1) {
    for (let x = 1; x < crop.width - 1; x += 1) {
      const pixel = y * crop.width + x;
      if (outside[pixel]) continue;
      const exposed =
        outside[pixel - 1]
        + outside[pixel + 1]
        + outside[pixel - crop.width]
        + outside[pixel + crop.width];
      if (exposed) data[pixel * 4 + 3] = Math.min(data[pixel * 4 + 3], 255 - exposed * 34);
    }
  }

  context.putImageData(pixels, 0, 0);
  return canvas;
}

function makeTexture(THREE, canvas, name, anisotropy) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `MungschoolOriginalArt:${name}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function configureDepthContactProxy(THREE, proxyGroup) {
  if (!THREE?.MeshBasicMaterial || !proxyGroup?.traverse) {
    throw new TypeError('configureDepthContactProxy requires THREE and a rig group.');
  }

  const depthMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
  depthMaterial.name = 'MungschoolChihuahua:depth-contact-proxy-only';

  let depthMeshes = 0;
  proxyGroup.traverse(node => {
    if (!node.isMesh) return;
    const isSolidSurface = node.userData?.toonRole === 'cel-fill';
    node.visible = isSolidSurface;
    if (!isSolidSurface) return;
    node.material = depthMaterial;
    node.renderOrder = -20;
    node.castShadow = false;
    node.receiveShadow = false;
    depthMeshes += 1;
  });

  proxyGroup.userData.renderStyle = 'invisible-depth-contact-proxy';
  proxyGroup.userData.colorVisible = false;
  proxyGroup.userData.depthMeshes = depthMeshes;
  return {
    material: depthMaterial,
    depthMeshes,
    dispose: () => depthMaterial.dispose(),
  };
}

export function createArtChihuahua(THREE, options = {}) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.PlaneGeometry || !THREE?.MeshBasicMaterial) {
    throw new TypeError('createArtChihuahua requires a compatible THREE namespace.');
  }

  const sourceUrl = options.sourceUrl
    || 'assets/concepts/chihuahua-2p5d-cel-concept-sheet-v1.png';
  const crops = { ...DEFAULT_VIEWS, ...options.views };
  const group = new THREE.Group();
  group.name = 'MungschoolOriginalArtChihuahua';
  group.userData.renderStyle = 'original-art-2.5d-card';
  group.userData.source = sourceUrl;
  group.userData.visibleGeometry = 'concept-sheet-pixels';

  const motionRoot = new THREE.Group();
  motionRoot.name = 'original-art-motion-root';
  group.add(motionRoot);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    alphaTest: 0.045,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.name = 'MungschoolOriginalArt:visible-material';

  const card = new THREE.Mesh(geometry, material);
  card.name = 'original-art-visible-card';
  card.renderOrder = 20;
  motionRoot.add(card);

  const textures = {};
  let activeView = 'front';
  let disposed = false;
  let readyState = false;

  const setView = requested => {
    const next = textures[requested] ? requested : 'front';
    if (!textures[next]) return;
    if (next !== activeView || material.map !== textures[next].texture) {
      activeView = next;
      material.map = textures[next].texture;
      material.needsUpdate = true;
    }
    const aspect = textures[next].crop.width / textures[next].crop.height;
    card.scale.set(aspect, 1, 1);
    group.userData.activeView = activeView;
  };

  const ready = loadImage(sourceUrl).then(image => {
    if (disposed) throw new Error('original art renderer was disposed before loading');
    const maxAnisotropy = options.anisotropy || 4;
    for (const [name, crop] of Object.entries(crops)) {
      const canvas = makeCutoutCanvas(image, crop);
      textures[name] = {
        crop,
        texture: makeTexture(THREE, canvas, name, maxAnisotropy),
      };
    }
    readyState = true;
    setView(options.initialView || 'front');
    group.userData.ready = true;
    group.userData.views = Object.keys(textures);
    return group;
  });

  const update = (state = {}) => {
    if (!readyState || disposed) return group;
    const time = Number.isFinite(Number(state.time)) ? Number(state.time) : 0;
    const gazeX = signed(state.gazeX);
    const gazeY = signed(state.gazeY);
    const touchX = signed(state.touchX);
    const pet = unit(state.petStrength);
    const walk = unit(state.walk);
    const breathing = state.breathing === undefined ? 1 : unit(state.breathing);
    const reaction = String(state.reaction || 'neutral').toLowerCase();
    const happy = ['happy', 'pleased', 'love', 'success'].includes(reaction);
    const startled = ['startled', 'error', 'angry'].includes(reaction);

    let requestedView = state.view;
    if (!requestedView) {
      requestedView = walk > 0.22 || Math.abs(gazeX) > 0.74 ? 'threeQuarter' : 'front';
    }
    setView(requestedView);

    const walkWave = Math.sin(time * 7.2);
    const breath = Math.sin(time * 2.15) * 0.006 * breathing;
    const lift = Math.abs(walkWave) * 0.025 * walk + (happy ? 0.012 : 0);
    const compression = pet * 0.028;
    motionRoot.position.set(
      gazeX * 0.018 + touchX * pet * 0.026,
      lift - gazeY * 0.008 - pet * 0.012,
      0
    );
    motionRoot.rotation.set(
      -gazeY * 0.012,
      gazeX * 0.035,
      -touchX * pet * 0.045 + walkWave * walk * 0.012 + (startled ? 0.018 : 0)
    );
    motionRoot.scale.set(
      1 + breath + compression * 0.55,
      1 - breath * 0.45 - compression + lift * 0.16,
      1
    );
    group.userData.animation = {
      view: activeView,
      petCompression: pet,
      reaction,
      walk,
    };
    return group;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
    Object.values(textures).forEach(entry => entry.texture.dispose());
    group.userData.disposed = true;
  };

  return {
    group,
    ready,
    update,
    setView,
    dispose,
    get readyState() {
      return readyState;
    },
  };
}

export default createArtChihuahua;
