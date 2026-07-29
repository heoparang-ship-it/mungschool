/* 멍스쿨 모바일 — 강아지 뷰 (벡터)
   ★3D 리그를 걷어내고 SVG 벡터로 교체했다. 이유:
     · 참고 원화가 «플랫 컬러 + 굵은 검정 라인»이라 벡터가 원본에 가장 가깝다
     · 어떤 해상도에서도 선이 뭉개지지 않는다
     · three.js 1.3MB 의존이 사라진다 — WebGL 없는 기기에서도 그대로 뜬다
     · 표정·성장·견종·목줄이 전부 파라미터라 한계비용이 여전히 0이다
   ★성능 규칙: SVG 문자열을 매 프레임 다시 만들지 않는다.
     표정이 «바뀔 때만» 다시 그리고, 숨쉬기·들썩임은 CSS 애니메이션에 맡긴다. */

import { dogSVG, NEUTRAL, STAGES, stageFor, measure } from './pup.js';
export { STAGES, stageFor, measure };

/* ★상점은 목줄을 «키»로 넘긴다('mint'). 헥스로 착각해 그대로 fill 에 넣으면 검게 칠해진다. */
export const COLLARS = { mint:'#2AB7A9', red:'#E74C3C', yellow:'#F3B13E', blue:'#4A90D9' };
const collarHex = v => (typeof v === 'string' && v[0] === '#') ? v : (COLLARS[v] || COLLARS.mint);

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .mm-dog{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
    .mm-dog svg{width:100%;height:100%;overflow:visible;
      animation:mmBreathe 3.4s ease-in-out infinite;transform-origin:50% 88%}
    .mm-dog.excited svg{animation:mmBounce .5s cubic-bezier(.3,1.5,.4,1) 1, mmBreathe 3.4s ease-in-out infinite .5s}
    @keyframes mmBreathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.012,0.99)}}
    @keyframes mmBounce{0%{transform:translateY(0) scale(1,1)}
      30%{transform:translateY(-7%) scale(0.97,1.05)}
      60%{transform:translateY(0) scale(1.05,0.95)}
      100%{transform:translateY(0) scale(1,1)}}
    @media (prefers-reduced-motion: reduce){.mm-dog svg{animation:none}}`;
  document.head.appendChild(s);
}

/** el = 컨테이너(div). 캔버스가 아니다. */
export function createDogView(el) {
  if (!el) throw new Error('createDogView: 컨테이너가 없습니다');
  injectStyle();
  el.classList.add('mm-dog');

  const state = { stage: STAGES[0], collar: '#2AB7A9', pose: null, ex: 1, t: 0, blink: false };
  let raf = 0, blinkTimer = 0, last = 0;

  function params() {
    const p = state.pose ? state.pose(state.t, state.ex) : {};
    const o = Object.assign({}, NEUTRAL, p);
    // 눈 깜빡임 — 반달눈(웃음·하품)일 때는 건너뛴다
    if (state.blink && !(o.eyeCrescent > 0.5)) o.eyeOpen = 0;
    return o;
  }
  function render() {
    el.innerHTML = dogSVG(params(), { stage: state.stage, collar: state.collar, size: 400 });
  }
  render();

  /* 깜빡임 — 3~6초에 한 번, 120ms. 이것만으로 «살아 있다»는 느낌이 크게 오른다. */
  function scheduleBlink() {
    blinkTimer = setTimeout(() => {
      state.blink = true; render();
      setTimeout(() => { state.blink = false; render(); scheduleBlink(); }, 120);
    }, 3000 + Math.random() * 3000);
  }
  scheduleBlink();

  /* 포즈 함수가 시간에 반응하는 경우(혀 놀림 등)를 위해 저속으로 갱신 */
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 220) return;               // ≈4.5fps — 문자열 재생성 비용을 억제
    last = now; state.t += 0.22;
    if (state.pose && state.pose.length >= 1) render();
  }
  raf = requestAnimationFrame(loop);

  return {
    setStage(s) { if (!s) return; state.stage = s; render(); },
    setCollar(v) { if (!v) return; state.collar = collarHex(v); render(); },
    setYaw() {},                                 // 벡터에는 요가 없다 — 호출부 호환용
    stage: () => state.stage,
    /** pose: (t, ex) => 얼굴 파라미터 · ex: 과장 계수 1→0 */
    play(pose, ex) {
      state.pose = pose; state.ex = (ex == null ? 1 : ex); state.t = 0; render();
      el.classList.remove('excited'); void el.offsetWidth; el.classList.add('excited');
    },
    idle() { state.pose = null; state.ex = 1; el.classList.remove('excited'); render(); },
    refit() {},                                  // SVG 는 컨테이너에 맞춰 알아서 늘어난다
    dispose() { cancelAnimationFrame(raf); clearTimeout(blinkTimer); el.innerHTML = ''; },
  };
}
