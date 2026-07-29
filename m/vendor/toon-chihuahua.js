/**
 * Mungschool real-time 2.5D chihuahua.
 *
 * The character is true 3D, but its authored silhouette, stepped lighting,
 * inverted-hull ink and pose timing are designed to read like a drawn frame.
 * No model, image or network request is required.
 *
 * @param {typeof import('three')} THREE
 * @param {object} [options]
 * @returns {{group: import('three').Group, update: (state?: object) => import('three').Group, dispose: () => void}}
 */
export function createToonChihuahua(THREE, options = {}) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.MeshToonMaterial) {
    throw new TypeError('createToonChihuahua requires a compatible THREE namespace.');
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const unit = value => clamp(Number.isFinite(Number(value)) ? Number(value) : 0, 0, 1);
  const signed = value => clamp(Number.isFinite(Number(value)) ? Number(value) : 0, -1, 1);
  const damp = (current, target, speed, dt) =>
    current + (target - current) * (1 - Math.exp(-speed * dt));
  const setXYZ = (target, values) => {
    if (values) target.set(values[0], values[1], values[2]);
  };

  const qualityName = ['low', 'medium', 'high'].includes(options.quality)
    ? options.quality
    : 'medium';
  const quality = {
    low: { sphereX: 10, sphereY: 7, capsule: 5, torus: 10, smallInk: false },
    medium: { sphereX: 14, sphereY: 9, capsule: 7, torus: 14, smallInk: true },
    high: { sphereX: 20, sphereY: 13, capsule: 9, torus: 20, smallInk: true },
  }[qualityName];

  const palette = {
    body: 0xd99755,
    bodyLight: 0xf2c785,
    bodyShadow: 0x9e5939,
    cream: 0xffe3b0,
    creamShadow: 0xd7a06a,
    earInner: 0xe98986,
    iris: 0x542f2c,
    ink: 0x211921,
    eye: 0x302026,
    nose: 0x241a22,
    tongue: 0xf27f91,
    collar: 0x2ab7a9,
    collarShadow: 0x176d70,
    tag: 0xffcb57,
    ...options.colors,
  };

  const geometryResources = new Set();
  const materialResources = new Set();
  const textureResources = new Set();
  const geometry = value => {
    geometryResources.add(value);
    return value;
  };
  const material = value => {
    materialResources.add(value);
    return value;
  };

  // Three hard steps keep the light graphic instead of smoothly "plastic".
  const gradientData = new Uint8Array([
    58, 58, 58, 255,
    154, 154, 154, 255,
    255, 255, 255, 255,
  ]);
  const gradientMap = new THREE.DataTexture(
    gradientData,
    3,
    1,
    THREE.RGBAFormat
  );
  gradientMap.name = 'ToonChihuahua:three-tone-ramp';
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  if (THREE.NoColorSpace !== undefined) gradientMap.colorSpace = THREE.NoColorSpace;
  textureResources.add(gradientMap);

  const toon = (name, color) => {
    const value = material(new THREE.MeshToonMaterial({
      color,
      gradientMap,
    }));
    value.name = `ToonChihuahua:${name}`;
    value.userData = {
      ...value.userData,
      toonBands: 3,
      artDirectedShade: true,
    };
    return value;
  };

  const mats = {
    body: toon('body', palette.body),
    bodyLight: toon('body-light', palette.bodyLight),
    bodyShadow: toon('body-shadow', palette.bodyShadow),
    cream: toon('cream', palette.cream),
    creamShadow: toon('cream-shadow', palette.creamShadow),
    earInner: toon('ear-inner', palette.earInner),
    iris: toon('iris', palette.iris),
    eye: toon('eye', palette.eye),
    nose: toon('nose', palette.nose),
    tongue: toon('tongue', palette.tongue),
    collar: toon('collar', palette.collar),
    collarShadow: toon('collar-shadow', palette.collarShadow),
    tag: toon('tag', palette.tag),
  };

  // One shared BackSide material is the mobile-friendly inverted hull.
  const outlineMaterial = material(new THREE.MeshBasicMaterial({
    color: palette.ink,
    side: THREE.BackSide,
    toneMapped: false,
  }));
  outlineMaterial.name = 'ToonChihuahua:inverted-hull-ink';

  const detailInkMaterial = material(new THREE.MeshBasicMaterial({
    color: palette.ink,
    toneMapped: false,
  }));
  detailInkMaterial.name = 'ToonChihuahua:face-ink';

  const eyeHighlightMaterial = material(new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  }));
  eyeHighlightMaterial.name = 'ToonChihuahua:eye-highlight';

  const contactGlowMaterial = material(new THREE.MeshBasicMaterial({
    color: 0xffefb2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }));
  contactGlowMaterial.name = 'ToonChihuahua:pet-contact-highlight';

  const shadowMaterial = material(new THREE.MeshBasicMaterial({
    color: palette.ink,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
  shadowMaterial.name = 'ToonChihuahua:ground-shadow';

  const contactShadowMaterial = material(new THREE.MeshBasicMaterial({
    color: palette.ink,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
  contactShadowMaterial.name = 'ToonChihuahua:paw-contact-shadow';

  const geo = {
    sphere: geometry(new THREE.SphereGeometry(1, quality.sphereX, quality.sphereY)),
    smallSphere: geometry(new THREE.SphereGeometry(
      1,
      Math.max(8, quality.sphereX - 3),
      Math.max(6, quality.sphereY - 2)
    )),
    capsule: geometry(new THREE.CapsuleGeometry(0.105, 0.43, 3, quality.capsule)),
    tailCapsule: geometry(new THREE.CapsuleGeometry(0.075, 0.27, 3, quality.capsule)),
    tinyCapsule: geometry(new THREE.CapsuleGeometry(0.025, 0.09, 2, 5)),
    ear: geometry(new THREE.ConeGeometry(0.5, 1, 3, 1)),
    tuft: geometry(new THREE.ConeGeometry(0.5, 1, 3, 1)),
    box: geometry(new THREE.BoxGeometry(1, 1, 1)),
    collar: geometry(new THREE.TorusGeometry(0.48, 0.055, 5, quality.torus)),
    tailCurl: geometry(new THREE.TorusGeometry(
      0.285,
      0.055,
      5,
      quality.torus,
      Math.PI * 1.65
    )),
    tag: geometry(new THREE.CircleGeometry(0.13, quality.torus)),
    shadow: geometry(new THREE.CircleGeometry(1, quality.torus)),
    pawShadow: geometry(new THREE.CircleGeometry(1, Math.max(8, quality.torus - 2))),
    contactGlow: geometry(new THREE.RingGeometry(0.11, 0.18, quality.torus)),
  };

  let estimatedDrawCalls = 0;
  const part = (
    name,
    partGeometry,
    partMaterial,
    {
      position,
      rotation,
      scale,
      outline = true,
      outlineAmount = options.outlineScale ?? 1.045,
    } = {}
  ) => {
    const node = new THREE.Group();
    node.name = name;
    if (position) setXYZ(node.position, position);
    if (rotation) setXYZ(node.rotation, rotation);
    if (scale) setXYZ(node.scale, scale);

    if (outline) {
      const hull = new THREE.Mesh(partGeometry, outlineMaterial);
      hull.name = `${name}:outline`;
      hull.scale.setScalar(clamp(outlineAmount, 1.015, 1.09));
      hull.renderOrder = -1;
      hull.userData.toonRole = 'inverted-hull-outline';
      node.add(hull);
      estimatedDrawCalls += 1;
    }

    const fill = new THREE.Mesh(partGeometry, partMaterial);
    fill.name = `${name}:fill`;
    fill.castShadow = options.castShadow === true;
    fill.receiveShadow = options.receiveShadow === true;
    fill.userData.toonRole = 'cel-fill';
    node.add(fill);
    node.userData.fill = fill;
    node.userData.baseScale = scale ? [...scale] : [1, 1, 1];
    estimatedDrawCalls += 1;
    return node;
  };

  const plainMesh = (name, partGeometry, partMaterial, transform = {}) => {
    const mesh = new THREE.Mesh(partGeometry, partMaterial);
    mesh.name = name;
    if (transform.position) setXYZ(mesh.position, transform.position);
    if (transform.rotation) setXYZ(mesh.rotation, transform.rotation);
    if (transform.scale) setXYZ(mesh.scale, transform.scale);
    mesh.userData.toonRole = transform.role || 'graphic-detail';
    estimatedDrawCalls += 1;
    return mesh;
  };

  const group = new THREE.Group();
  group.name = options.name || 'MungschoolToonChihuahua';
  group.scale.setScalar(Number.isFinite(options.scale) ? options.scale : 1);
  group.userData.character = 'chihuahua';
  group.userData.renderStyle = 'real-time-3d-cel-animation';
  group.userData.apiVersion = 1;
  group.userData.toonBands = 3;
  group.userData.hasInvertedHull = true;

  const groundLayer = new THREE.Group();
  groundLayer.name = 'ground-contact-layer';
  group.add(groundLayer);

  const groundShadow = plainMesh('ground-shadow', geo.shadow, shadowMaterial, {
    position: [0, 0.012, -0.04],
    rotation: [-Math.PI / 2, 0, 0],
    scale: [0.82, 1.08, 1],
    role: 'ground-shadow',
  });
  groundLayer.add(groundShadow);

  const bodyRig = new THREE.Group();
  bodyRig.name = 'body-rig';
  group.add(bodyRig);

  const torso = part('torso', geo.sphere, mats.body, {
    position: [0, 1.12, 0],
    scale: [0.57, 0.77, 0.5],
    outlineAmount: 1.052,
  });
  bodyRig.add(torso);

  // Hand-authored patches keep the "shadow drawing" stable as the camera moves.
  const bodyShade = part('body-authored-shadow', geo.sphere, mats.bodyShadow, {
    position: [0.29, 1.08, 0.445],
    scale: [0.22, 0.47, 0.105],
    rotation: [0, -0.16, -0.1],
    outline: false,
  });
  bodyShade.userData.artDirectedShade = true;
  bodyRig.add(bodyShade);

  const chest = part('chest-cream', geo.sphere, mats.cream, {
    position: [-0.06, 1.04, 0.47],
    scale: [0.34, 0.48, 0.17],
    outline: false,
  });
  bodyRig.add(chest);

  const chestShade = part('chest-authored-shadow', geo.sphere, mats.creamShadow, {
    position: [0.22, 0.96, 0.615],
    scale: [0.16, 0.37, 0.055],
    outline: false,
  });
  chestShade.userData.artDirectedShade = true;
  bodyRig.add(chestShade);

  const chestTuft = part('chest-tuft', geo.tuft, mats.cream, {
    position: [-0.12, 0.77, 0.57],
    rotation: [Math.PI, 0, -0.08],
    scale: [0.23, 0.3, 0.09],
    outlineAmount: 1.055,
  });
  bodyRig.add(chestTuft);

  // A Chihuahua's tucked waist and high rear haunches stop the body reading
  // as a single floating oval. These sit behind the planted legs.
  for (const side of [-1, 1]) {
    bodyRig.add(part(`haunch-${side < 0 ? 'L' : 'R'}`, geo.smallSphere, mats.body, {
      position: [side * 0.39, 0.73, -0.13],
      scale: [0.29, 0.34, 0.34],
      outlineAmount: 1.052,
    }));
  }

  const headPivot = new THREE.Group();
  headPivot.name = 'head-pivot';
  headPivot.position.set(0, 1.94, 0.13);
  bodyRig.add(headPivot);

  const head = part('head', geo.sphere, mats.body, {
    scale: [0.67, 0.61, 0.56],
    outlineAmount: 1.055,
  });
  headPivot.add(head);

  const faceShade = part('face-authored-shadow', geo.sphere, mats.bodyShadow, {
    position: [0.35, -0.015, 0.49],
    rotation: [0, -0.12, -0.08],
    scale: [0.25, 0.39, 0.115],
    outline: false,
  });
  faceShade.userData.artDirectedShade = true;
  headPivot.add(faceShade);

  const foreheadBlaze = part('forehead-blaze', geo.tuft, mats.bodyLight, {
    position: [-0.06, 0.17, 0.535],
    rotation: [Math.PI, 0, 0.04],
    scale: [0.17, 0.36, 0.07],
    outline: false,
  });
  headPivot.add(foreheadBlaze);

  const earPivots = [];
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'L' : 'R';
    const earPivot = new THREE.Group();
    earPivot.name = `ear${sideName}-pivot`;
    earPivot.position.set(side * 0.44, 0.35, -0.03);
    earPivot.rotation.z = -side * 0.19;
    headPivot.add(earPivot);

    const ear = part(`ear${sideName}`, geo.ear, mats.body, {
      position: [0, 0.35, 0],
      scale: [0.72, 0.92, 0.42],
      outlineAmount: 1.06,
    });
    earPivot.add(ear);

    const inner = part(`ear${sideName}-inner`, geo.ear, mats.earInner, {
      position: [0, 0.31, 0.105],
      scale: [0.48, 0.68, 0.16],
      outline: false,
    });
    earPivot.add(inner);
    earPivots.push({ side, pivot: earPivot, baseZ: -side * 0.19 });
  }

  const eyes = [];
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'L' : 'R';
    const eyeRoot = new THREE.Group();
    eyeRoot.name = `eye${sideName}-root`;
    eyeRoot.position.set(side * 0.255, 0.075, 0.51);
    headPivot.add(eyeRoot);

    const eyeWhite = part(`eye${sideName}`, geo.smallSphere, mats.eye, {
      scale: [0.185, 0.205, 0.115],
      outlineAmount: 1.07,
    });
    eyeRoot.add(eyeWhite);

    const pupilRoot = new THREE.Group();
    pupilRoot.name = `eye${sideName}-gaze`;
    pupilRoot.position.set(0, 0, 0.105);
    eyeRoot.add(pupilRoot);

    const iris = part(`eye${sideName}-iris`, geo.smallSphere, mats.iris, {
      scale: [0.108, 0.125, 0.048],
      outline: quality.smallInk,
      outlineAmount: 1.055,
    });
    pupilRoot.add(iris);

    const pupil = plainMesh(`eye${sideName}-pupil`, geo.smallSphere, detailInkMaterial, {
      position: [0, -0.004, 0.044],
      scale: [0.062, 0.075, 0.027],
      role: 'pupil',
    });
    pupilRoot.add(pupil);

    const highlight = plainMesh(
      `eye${sideName}-highlight`,
      geo.smallSphere,
      eyeHighlightMaterial,
      {
        position: [-0.033, 0.046, 0.07],
        scale: [0.029, 0.036, 0.018],
        role: 'eye-highlight',
      }
    );
    pupilRoot.add(highlight);
    eyes.push({ root: eyeRoot, pupil: pupilRoot, side });
  }

  const brows = [];
  for (const side of [-1, 1]) {
    const brow = plainMesh(
      `brow${side < 0 ? 'L' : 'R'}`,
      geo.box,
      mats.bodyShadow,
      {
        position: [side * 0.255, 0.315, 0.555],
        rotation: [0, 0, side * 0.12],
        scale: [0.18, 0.024, 0.03],
        role: 'expression-ink',
      }
    );
    headPivot.add(brow);
    brows.push({ side, mesh: brow });
  }

  const muzzleRoot = new THREE.Group();
  muzzleRoot.name = 'muzzle-expression-rig';
  headPivot.add(muzzleRoot);
  for (const side of [-1, 1]) {
    muzzleRoot.add(part(`muzzle-${side < 0 ? 'L' : 'R'}`, geo.smallSphere, mats.cream, {
      position: [side * 0.135, -0.19, 0.54],
      scale: [0.245, 0.205, 0.205],
      outlineAmount: 1.045,
    }));
  }
  const muzzleShade = part('muzzle-authored-shadow', geo.smallSphere, mats.creamShadow, {
    position: [0.16, -0.23, 0.708],
    scale: [0.11, 0.09, 0.045],
    outline: false,
  });
  muzzleShade.userData.artDirectedShade = true;
  muzzleRoot.add(muzzleShade);

  const chin = part('chin', geo.smallSphere, mats.cream, {
    position: [0, -0.35, 0.5],
    scale: [0.2, 0.13, 0.15],
    outlineAmount: 1.045,
  });
  muzzleRoot.add(chin);

  const nose = part('nose', geo.smallSphere, mats.nose, {
    position: [0, -0.165, 0.744],
    scale: [0.145, 0.1, 0.095],
    outlineAmount: 1.055,
  });
  muzzleRoot.add(nose);
  const noseHighlight = plainMesh('nose-highlight', geo.smallSphere, eyeHighlightMaterial, {
    position: [-0.045, -0.13, 0.82],
    scale: [0.024, 0.018, 0.012],
    role: 'nose-highlight',
  });
  muzzleRoot.add(noseHighlight);

  const mouthCenter = plainMesh('mouth-center', geo.box, detailInkMaterial, {
    position: [0, -0.3, 0.693],
    scale: [0.022, 0.105, 0.024],
    role: 'mouth-ink',
  });
  muzzleRoot.add(mouthCenter);

  const mouthCorners = [];
  for (const side of [-1, 1]) {
    const corner = plainMesh('mouth-corner', geo.tinyCapsule, detailInkMaterial, {
      position: [side * 0.07, -0.355, 0.685],
      rotation: [0, 0, side * 0.83],
      scale: [1, 1, 0.7],
      role: 'mouth-ink',
    });
    muzzleRoot.add(corner);
    mouthCorners.push({ side, mesh: corner });
  }

  const tongue = part('tongue', geo.smallSphere, mats.tongue, {
    position: [0, -0.405, 0.685],
    scale: [0.105, 0.13, 0.045],
    outlineAmount: 1.055,
  });
  tongue.visible = false;
  muzzleRoot.add(tongue);

  const collarRig = new THREE.Group();
  collarRig.name = 'collar-rig';
  collarRig.position.set(0, 1.66, 0.29);
  collarRig.rotation.x = 0.08;
  bodyRig.add(collarRig);
  const collar = part('collar', geo.collar, mats.collar, {
    scale: [1.08, 0.72, 0.88],
    outlineAmount: 1.06,
  });
  collarRig.add(collar);

  const collarShade = part('collar-authored-shadow', geo.collar, mats.collarShadow, {
    position: [0.025, -0.012, 0.018],
    scale: [1.02, 0.67, 0.82],
    outline: false,
  });
  collarShade.rotation.z = 0.14;
  collarShade.userData.artDirectedShade = true;
  collarRig.add(collarShade);

  const tagRig = new THREE.Group();
  tagRig.name = 'tag-rig';
  tagRig.position.set(0, 1.47, 0.615);
  bodyRig.add(tagRig);
  const tag = part('collar-tag', geo.tag, mats.tag, {
    outlineAmount: 1.075,
  });
  tagRig.add(tag);
  const tagMark = plainMesh('collar-tag-mark', geo.smallSphere, detailInkMaterial, {
    position: [0, 0.005, 0.018],
    scale: [0.035, 0.045, 0.012],
    role: 'tag-mark',
  });
  tagRig.add(tagMark);

  const legs = [];
  const legDefinitions = [
    ['legBL', -0.37, -0.23, Math.PI, false],
    ['legBR', 0.37, -0.23, 0, false],
    ['legFL', -0.34, 0.25, 0, true],
    ['legFR', 0.34, 0.25, Math.PI, true],
  ];
  for (const [name, x, z, phaseOffset, front] of legDefinitions) {
    const legRig = new THREE.Group();
    legRig.name = `${name}-grounded-rig`;
    legRig.position.set(x, 0.7, z);
    group.add(legRig);

    const upper = part(`${name}-upper`, geo.capsule, front ? mats.bodyLight : mats.body, {
      position: [0, -0.28, 0],
      scale: front ? [0.96, 1.04, 0.96] : [1.04, 0.94, 1.04],
      outlineAmount: 1.055,
    });
    legRig.add(upper);

    const paw = part(`${name}-paw`, geo.smallSphere, mats.cream, {
      position: [0, -0.585, 0.095],
      scale: [0.155, 0.12, 0.205],
      outlineAmount: 1.06,
    });
    legRig.add(paw);

    const pawShadow = plainMesh(`${name}-contact-shadow`, geo.pawShadow, contactShadowMaterial, {
      position: [x, 0.017, z + 0.07],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [0.19, 0.27, 1],
      role: 'paw-contact-shadow',
    });
    groundLayer.add(pawShadow);

    legRig.userData.grounded = true;
    legRig.userData.basePosition = [x, 0.7, z];
    legs.push({ name, rig: legRig, upper, paw, shadow: pawShadow, x, z, phaseOffset, front });
  }

  const tailRig = new THREE.Group();
  tailRig.name = 'tail-rig';
  // A broad authored arc sits behind the torso. A chain of capsules reads as
  // a raised human arm from the front; the open loop reads immediately as a
  // Chihuahua's carried curl even at mobile size.
  tailRig.position.set(-0.43, 1.38, -0.46);
  tailRig.rotation.set(0, 0, 0.12);
  bodyRig.add(tailRig);
  const tailCurl = part('tail-curl', geo.tailCurl, mats.body, {
    rotation: [0, 0, -0.08],
    scale: [1.08, 1.14, 0.78],
    outlineAmount: 1.065,
  });
  tailRig.add(tailCurl);

  const contactGlow = plainMesh('pet-contact-highlight', geo.contactGlow, contactGlowMaterial, {
    position: [0, 0.12, 0.625],
    role: 'pet-contact-highlight',
  });
  headPivot.add(contactGlow);

  group.userData.performance = {
    quality: qualityName,
    estimatedDrawCalls,
    externalAssets: 0,
    toonRampPixels: 3,
  };
  group.userData.toonRig = {
    head: headPivot,
    body: bodyRig,
    ears: earPivots.map(entry => entry.pivot),
    eyes: eyes.map(entry => entry.root),
    legs: legs.map(entry => entry.rig),
    tail: tailRig,
    muzzle: muzzleRoot,
  };

  const animation = {
    lastTime: null,
    eyeX: 0,
    eyeY: 0,
    headX: 0,
    headY: 0,
    earX: 0,
    earY: 0,
    bodyX: 0,
    bodyY: 0,
    pet: 0,
    trust: 0,
    walk: 0,
    lastReaction: 'neutral',
    reactionPulse: 0,
    nextBlinkAt: 2.4,
    blinkUntil: -1,
    blinkSeed: 1,
    disposed: false,
  };

  const normalizedTime = value => {
    const raw = Number(value);
    if (!Number.isFinite(raw)) {
      return typeof performance !== 'undefined' ? performance.now() * 0.001 : Date.now() * 0.001;
    }
    return options.timeUnit === 'milliseconds' ? raw * 0.001 : raw;
  };

  /**
   * state values:
   * gazeX/Y, touchX/Y: normalized -1..1
   * breathing, walk, trust, petStrength: normalized 0..1
   * reaction: neutral | happy | success | love | alert | startled | error | angry
   * time: seconds (or milliseconds with options.timeUnit = "milliseconds")
   */
  const update = (state = {}) => {
    if (animation.disposed) return group;

    const time = normalizedTime(state.time);
    const dt = animation.lastTime === null
      ? 1 / 60
      : clamp(time - animation.lastTime, 0, 0.05);
    animation.lastTime = time;

    const gazeX = signed(state.gazeX);
    const gazeY = signed(state.gazeY);
    const touchX = signed(state.touchX);
    const touchY = signed(state.touchY);
    const breathing = state.breathing === undefined ? 1 : unit(state.breathing);
    const targetWalk = unit(state.walk);
    const targetTrust = unit(state.trust);
    const targetPet = unit(state.petStrength);
    const reaction = typeof state.reaction === 'string' ? state.reaction.toLowerCase() : 'neutral';

    if (reaction !== animation.lastReaction) {
      animation.reactionPulse = reaction === 'neutral' ? 0 : 1;
      animation.lastReaction = reaction;
    } else {
      animation.reactionPulse = Math.max(0, animation.reactionPulse - dt * 2.8);
    }

    const happy = ['happy', 'success', 'love', 'pleased'].includes(reaction);
    const alert = ['alert', 'curious'].includes(reaction);
    const startled = ['startled', 'error', 'angry', 'no'].includes(reaction);
    const reactionPulse = Number.isFinite(Number(state.reaction))
      ? unit(state.reaction)
      : animation.reactionPulse;

    animation.walk = damp(animation.walk, targetWalk, 8, dt);
    animation.trust = damp(animation.trust, targetTrust, 4.5, dt);
    animation.pet = damp(animation.pet, targetPet, 10, dt);

    // Deliberately separate follow speeds: eyes -> head -> ears -> torso.
    animation.eyeX = damp(animation.eyeX, gazeX, 30, dt);
    animation.eyeY = damp(animation.eyeY, gazeY, 30, dt);
    animation.headX = damp(animation.headX, gazeX, 10.5, dt);
    animation.headY = damp(animation.headY, gazeY, 10.5, dt);
    animation.earX = damp(animation.earX, gazeX, 6.2, dt);
    animation.earY = damp(animation.earY, gazeY, 6.2, dt);
    animation.bodyX = damp(animation.bodyX, gazeX, 3.8, dt);
    animation.bodyY = damp(animation.bodyY, gazeY, 3.8, dt);

    if (time >= animation.nextBlinkAt) {
      animation.blinkUntil = time + 0.115;
      animation.blinkSeed += 1;
      const irregular = 2.1 + ((Math.sin(animation.blinkSeed * 12.9898) + 1) * 0.5) * 2.6;
      animation.nextBlinkAt = time + irregular;
    }

    const blink = time < animation.blinkUntil;
    const contentedSquint = clamp(
      animation.pet * (0.45 + animation.trust * 0.4) + (happy ? reactionPulse * 0.32 : 0),
      0,
      0.78
    );
    const eyeScaleY = blink ? 0.07 : 1 - contentedSquint;
    for (const eye of eyes) {
      eye.pupil.position.x = animation.eyeX * 0.04;
      eye.pupil.position.y = animation.eyeY * 0.035;
      eye.root.scale.set(1 + (startled ? reactionPulse * 0.08 : 0), eyeScaleY, 1);
    }

    for (const brow of brows) {
      const worried = startled ? reactionPulse : 0;
      brow.mesh.rotation.z = brow.side * (0.12 - worried * 0.52 + (happy ? reactionPulse * 0.18 : 0));
      brow.mesh.position.y = 0.315 + (alert ? reactionPulse * 0.035 : 0);
    }

    const pet = animation.pet;
    const headLeanX = touchX * pet * 0.09;
    const headPressY = Math.max(0, touchY * -0.5 + 0.5) * pet * 0.045;
    headPivot.position.set(
      headLeanX,
      1.94 - headPressY + (startled ? reactionPulse * 0.055 : 0),
      0.13
    );
    headPivot.rotation.x = -animation.headY * 0.17 + pet * 0.035;
    headPivot.rotation.y = 0.08 + animation.headX * 0.2 + touchX * pet * 0.055;
    headPivot.rotation.z = -touchX * pet * 0.075 + (startled ? reactionPulse * 0.035 : 0);
    headPivot.scale.set(
      1 + pet * 0.012 + (startled ? reactionPulse * 0.025 : 0),
      1 - pet * 0.052 + (startled ? reactionPulse * 0.035 : 0),
      1 + pet * 0.015
    );

    for (const ear of earPivots) {
      const sideTouch = clamp(1 - Math.abs(touchX - ear.side * 0.55) * 1.3, 0, 1) * pet;
      const perk = alert ? reactionPulse * 0.16 : 0;
      const startledPerk = startled ? reactionPulse * 0.24 : 0;
      ear.pivot.rotation.x =
        -animation.earY * 0.08 + sideTouch * 0.32 - animation.trust * 0.025;
      ear.pivot.rotation.y = animation.earX * 0.065 + ear.side * sideTouch * 0.08;
      ear.pivot.rotation.z =
        ear.baseZ
        + ear.side * (perk + startledPerk)
        - ear.side * sideTouch * 0.2
        + Math.sin(time * 3.1 + ear.side) * 0.012 * (0.4 + animation.trust);
    }

    const breathWave = Math.sin(time * 2.05) * 0.5 + 0.5;
    const walkPhase = time * (5.2 + animation.walk * 2.5);
    const bodyBob = Math.abs(Math.sin(walkPhase)) * 0.026 * animation.walk;
    bodyRig.position.y = bodyBob + breathWave * 0.006 * breathing;
    bodyRig.rotation.y = -0.08 + animation.bodyX * 0.07;
    bodyRig.rotation.x = -animation.bodyY * 0.025;
    bodyRig.rotation.z = -touchX * pet * 0.026;

    torso.scale.set(
      0.57 * (1 + breathWave * 0.008 * breathing),
      0.77 * (1 + breathWave * 0.018 * breathing - pet * 0.008),
      0.5 * (1 + breathWave * 0.026 * breathing)
    );
    chest.scale.set(
      0.34 * (1 + breathWave * 0.012 * breathing),
      0.48 * (1 + breathWave * 0.025 * breathing),
      0.17 * (1 + breathWave * 0.035 * breathing)
    );

    // Stance paws stay exactly at their authored ground height. Only the
    // positive swing half moves a paw, preventing the classic sprite slide.
    for (const leg of legs) {
      const wave = Math.sin(walkPhase + leg.phaseOffset);
      const swing = Math.max(0, wave);
      const lift = Math.pow(swing, 1.45) * 0.15 * animation.walk;
      const inStance = lift < 0.0015;
      const swingX = inStance
        ? 0
        : -Math.cos(walkPhase + leg.phaseOffset) * 0.045 * animation.walk;
      leg.rig.position.set(leg.x + swingX, 0.7 + lift, leg.z);
      leg.rig.rotation.x = inStance ? 0 : -wave * 0.18 * animation.walk;
      leg.rig.rotation.z = leg.front ? -animation.bodyX * 0.018 : animation.bodyX * 0.012;
      leg.paw.rotation.x = inStance ? 0 : -swing * 0.23 * animation.walk;
      leg.shadow.visible = lift < 0.145;
      leg.shadow.scale.x = 0.19 * (1 - lift * 1.5);
      leg.shadow.scale.y = 0.27 * (1 - lift * 1.15);
      leg.rig.userData.grounded = inStance;
      leg.rig.userData.contactY = inStance ? 0 : lift;
    }

    const wagStrength = 0.12 + animation.trust * 0.42 + pet * 0.55
      + (happy ? reactionPulse * 0.35 : 0);
    const wag = Math.sin(time * (5.5 + wagStrength * 8)) * wagStrength;
    tailRig.rotation.x = animation.bodyY * 0.025;
    tailRig.rotation.y = animation.bodyX * 0.035;
    tailRig.rotation.z = 0.12 + wag * 0.2;
    tailCurl.rotation.z = -0.08 + wag * 0.055;
    tailCurl.scale.set(
      1.08 + Math.abs(wag) * 0.018,
      1.14 - Math.abs(wag) * 0.012,
      0.78
    );

    muzzleRoot.position.x = touchX * pet * 0.018;
    muzzleRoot.scale.set(1 + pet * 0.018, 1 - pet * 0.025, 1);
    const sustainedSmile = happy ? 0.28 + animation.trust * 0.34 : 0;
    const smile = happy ? Math.max(reactionPulse, sustainedSmile) : pet * animation.trust;
    for (const corner of mouthCorners) {
      corner.mesh.rotation.z = corner.side * (0.83 + smile * 0.25);
      corner.mesh.position.y = -0.355 + smile * 0.018;
    }
    tongue.visible = happy && reactionPulse > 0.08;
    tongue.position.y = -0.405 - reactionPulse * 0.035;
    tongue.scale.y = 0.13 * (1 + reactionPulse * 0.2);

    collarRig.rotation.z = -animation.bodyX * 0.035 + touchX * pet * 0.018;
    tagRig.rotation.z = -animation.bodyX * 0.045 + Math.sin(time * 4.4) * animation.walk * 0.055;
    tagRig.position.y = 1.47 - bodyBob * 0.25;

    contactGlow.position.x = touchX * 0.28;
    contactGlow.position.y = 0.12 + touchY * 0.2;
    contactGlow.scale.setScalar(0.75 + pet * 0.45);
    contactGlowMaterial.opacity = pet * (0.18 + Math.sin(time * 8) * 0.04);
    contactGlow.visible = pet > 0.015;

    groundShadow.scale.x = 0.82 + animation.walk * 0.035;
    groundShadow.scale.y = 1.08 - bodyBob * 0.8;
    shadowMaterial.opacity = 0.18 - bodyBob * 0.55 + pet * 0.015;

    group.userData.animation = {
      eyeFollowX: animation.eyeX,
      headFollowX: animation.headX,
      earFollowX: animation.earX,
      bodyFollowX: animation.bodyX,
      groundedPaws: legs.reduce((count, leg) => count + (leg.rig.userData.grounded ? 1 : 0), 0),
      petCompression: pet,
      reaction,
    };
    return group;
  };

  const dispose = () => {
    if (animation.disposed) return;
    animation.disposed = true;
    if (group.parent) group.parent.remove(group);
    geometryResources.forEach(resource => resource.dispose());
    materialResources.forEach(resource => resource.dispose());
    textureResources.forEach(resource => resource.dispose());
    group.userData.disposed = true;
  };

  update({
    time: 0,
    breathing: 1,
    trust: options.initialTrust ?? 0.35,
  });

  return { group, update, dispose };
}

export default createToonChihuahua;
