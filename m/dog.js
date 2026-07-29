/* 멍스쿨 모바일 — 3D 강아지 뷰
   ★Reality Spike 결과를 그대로 구현한다:
     · 리그의 update() 는 매 프레임 스케일을 원복한다 → 노드 직접 조작은 무효
       → «리그가 모르는 래퍼 그룹»을 끼워 그 위에서만 조작한다.
     · 다리 노드 이름은 legFL 이 아니라 legFL-grounded-rig 다. (이름을 틀리면 래퍼가 통째로 사라진다)
     · 다리 원점은 «발밑»이라 Y로 늘리면 위로 자라 몸통을 파고든다
       → 다리를 늘린 만큼 몸통을 들어 올려야 진짜로 키가 큰다.
     · head-pivot 은 body-rig 의 자식이라 몸 체형을 바꾸면 머리가 딸려 변형된다 → 머리에서 역보정한다.
   ★몸통을 세로로 늘려 등신비를 만들지 않는다. 그러면 토르소가 소시지가 된다. */
import * as THREE from './vendor/three.module.js';
import { createToonChihuahua } from './vendor/toon-chihuahua.js';

/* 기본 다리가 몸통에 붙는 높이 — 리프트 계산 기준 (스파이크 실측) */
const LEG_TOP = 0.771;

/* 스파이크로 역산한 성장 3단계
   head=머리 크기 · leg=다리 길이 · chub=몸통 굵기 · chubY=몸통 길이
   아기는 짧은 다리 + 통통한 몸, 성견은 긴 다리 + 날씬한 몸. 얼굴 비중은 끝까지 49% 이상 유지. */
export const STAGES = [
  { key: 'pup',   name: '아기',   head: 0.994, leg: 0.721, chub: 1.080, chubY: 0.920, ratio: 1.58 },
  { key: 'teen',  name: '청소년', head: 0.974, leg: 1.146, chub: 1.000, chubY: 1.000, ratio: 1.76 },
  { key: 'adult', name: '성견',   head: 0.955, leg: 1.555, chub: 0.940, chubY: 1.070, ratio: 1.94 },
];
export const stageFor = learned =>
  learned >= 8 ? STAGES[2] : learned >= 4 ? STAGES[1] : STAGES[0];

export function createDogView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8d9c0, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(2.2, 4, 3.4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe8dc, 0.5);
  rim.position.set(-3, 2, -2); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const rig = createToonChihuahua(THREE, {});
  const root = new THREE.Group();
  root.add(rig.group);
  scene.add(root);

  /* ── 래퍼 설치 ── */
  const N = {};
  rig.group.traverse(o => { if (o.name) N[o.name] = o; });
  function wrap(node, name) {
    if (!node) return null;
    const w = new THREE.Group(); w.name = name;
    node.parent.add(w); w.add(node);
    return w;
  }
  const headW = wrap(N['head-pivot'], 'mm-head');
  const bodyW = wrap(N['body-rig'], 'mm-body');
  const earW = ['earL-pivot', 'earR-pivot'].map((n, i) => wrap(N[n], 'mm-ear' + i)).filter(Boolean);
  const legW = ['legFL', 'legFR', 'legBL', 'legBR']
    .map((n, i) => wrap(N[n + '-grounded-rig'], 'mm-leg' + i)).filter(Boolean);
  const tongueW = wrap(N['tongue'], 'mm-tongue');
  if (tongueW) tongueW.scale.setScalar(0.001);   // 기본은 숨김

  const state = { stage: STAGES[0], pose: null, t: 0, ex: 1, yaw: 0.26 };

  /** 살짝 비스듬히 세운다. 정면 0°에서는 뒷다리가 앞다리에 완전히 가려 «두 발 달린 동물»로 읽힌다. */
  function setYaw(rad) { state.yaw = rad; root.rotation.y = rad; frame(); }
  root.rotation.y = state.yaw;

  function applyStage(s) {
    state.stage = s;
    bodyW.scale.set(s.chub, s.chubY, s.chub);
    headW.scale.set(s.head / s.chub, s.head / s.chubY, s.head / s.chub);
    frame();
  }
  applyStage(STAGES[0]);

  function frame() {
    const b = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh && o.visible) b.expandByObject(o); });
    if (!isFinite(b.min.y)) return;
    const c = new THREE.Vector3(), sz = new THREE.Vector3();
    b.getCenter(c); b.getSize(sz);
    const vF = 2 * Math.tan(camera.fov * Math.PI / 360), hF = vF * camera.aspect;
    const dist = Math.max(sz.y / vF, sz.x / hF) * 1.42;
    camera.position.set(c.x, c.y + sz.y * 0.03, c.z + dist);
    camera.lookAt(c.x, c.y, c.z);
  }

  function resize() {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 380;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    frame();
  }

  let raf = 0, last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; state.t += dt;
    const p = state.pose ? state.pose(state.t, state.ex) : idlePose(state.t);
    const st = Object.assign({ time: state.t, breathing: 0.7, trust: 0.7 }, p.state || {});
    try { rig.update(st); } catch (e) {}

    // ── 래퍼 조작 (update() 가 덮어쓰지 못하는 지점) ──
    const s = state.stage;
    const crouch = p.crouch || 0;
    const leg = s.leg * (1 - crouch * 0.22);          // 웅크리면 다리가 접힌다
    // 다리가 길어질수록 굵기도 함께 키운다. 안 그러면 성견이 «젓가락 다리»가 된다.
    const lw = (1 + (leg - 1) * 0.34) * (1 + (s.chub - 1) * 0.5);
    legW.forEach(w => w.scale.set(lw, leg, lw));
    bodyW.position.y = LEG_TOP * (leg - 1);           // ★다리가 자란 만큼 몸을 들어 올린다

    const ear = p.ear || 0;
    earW.forEach(w => { w.rotation.x = ear * 1.15; w.scale.set(1, 1 - ear * 0.18, 1 - ear * 0.1); });
    headW.rotation.z = p.headTilt || 0;
    headW.rotation.y = p.headYaw || 0;
    root.position.y = (p.bounce || 0) * 0.12;
    if (tongueW) {
      const tg = Math.max(p.tongue || 0, (p.pant || 0) * 0.8, p.mouth ? p.mouth * 0.7 : 0);
      const sc = tg < 0.02 ? 0.001 : (0.6 + tg * 0.9);
      tongueW.scale.set(sc, sc, sc * (1 + tg * 1.4));
      tongueW.position.z = tg * 0.12;
    }
    renderer.render(scene, camera);
  }

  function idlePose(t) {
    return {
      state: { reaction: 'neutral', trust: 0.75, breathing: 0.6, gazeX: Math.sin(t * 0.5) * 0.18, gazeY: 0.02 },
      ear: 0, headTilt: Math.sin(t * 0.33) * 0.05,
    };
  }

  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas); else addEventListener('resize', resize);
  resize(); raf = requestAnimationFrame(loop);

  return {
    setStage: applyStage,
    setYaw,
    stage: () => state.stage,
    /** pose: (t, ex) => ({state, ear, headTilt, ...}) · ex: 과장 계수 1→0 */
    play(pose, ex) { state.pose = pose; state.ex = (ex == null ? 1 : ex); state.t = 0; },
    idle() { state.pose = null; state.ex = 1; },
    refit: resize,
    dispose() { cancelAnimationFrame(raf); if (ro) ro.disconnect(); try { rig.dispose(); } catch (e) {} renderer.dispose(); },
  };
}
