/* 멍스쿨 모바일 — 강아지 뷰 (원화 이미지 합성)
   ★허파랑이 준 원화를 그대로 쓴다. 벡터로 다시 그리지 않는다.
     · face_atlas.webp — 표정 10종 5×2. 초록 배경 키잉 + despill 후,
       «아래 45%(주둥이·턱)의 폭»을 기준으로 크기를 정규화하고 턱을 셀 하단에 맞췄다.
       (귀는 표정마다 달라 정렬 기준이 될 수 없다)
     · body.webp — 전신 원화에서 머리를 지운 몸통. 꼬리는 살렸다.
   ★성능: 매 프레임 다시 그리지 않는다. 표정은 background-position 교체,
     숨쉬기·들썩임은 CSS 애니메이션(GPU). */

const A = './face_atlas.webp', B = './body.webp';
const CELL = 420, COLS = 5, ROWS = 2;
const FACE_IDS = ['relaxed','curious','lipLick','yawn','lookAway',
                  'whaleEye','earsBack','snarl','joy','panting'];
/* 원화의 머리 위치를 그대로 재현하는 앵커 (몸통 크기에 대한 비율) */
const HEAD_CX = 0.22, HEAD_CHIN = 0.46, FACE_W = 0.80;
const BODY_AR = 431 / 612;          // 몸통 원본 종횡비
const CHIN_IN_CELL = 386 / CELL;    // 셀 안에서 턱의 세로 위치

export const COLLARS = { mint:'#2AB7A9', red:'#E74C3C', yellow:'#F3B13E', blue:'#4A90D9' };
const collarHex = v => (typeof v === 'string' && v[0] === '#') ? v : (COLLARS[v] || COLLARS.mint);

export const STAGES = [
  { key:'pup',   name:'아기',   head:1.22, size:0.86, ratio:1.80 },
  { key:'teen',  name:'청소년', head:1.00, size:1.00, ratio:1.94 },
  { key:'adult', name:'성견',   head:0.86, size:1.14, ratio:2.10 },
];
export const stageFor = learned => learned >= 8 ? STAGES[2] : learned >= 4 ? STAGES[1] : STAGES[0];

let styled = false;
function injectStyle() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
  .mm-dog{position:relative;width:100%;height:100%;overflow:visible}
  .mm-stage{position:absolute;left:50%;top:50%;transform-origin:50% 92%;
    animation:mmBreathe 3.6s ease-in-out infinite}
  .mm-stage.excited{animation:mmPop .52s cubic-bezier(.3,1.6,.4,1) 1, mmBreathe 3.6s ease-in-out infinite .52s}
  .mm-body{position:absolute;background:url(${B}) center/100% 100% no-repeat}
  .mm-collar{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
  .mm-face{position:absolute;background-image:url(${A});background-repeat:no-repeat;
    transform-origin:50% 100%;transition:opacity .18s linear}
  .mm-face.ghost{opacity:0}
  @keyframes mmBreathe{0%,100%{transform:translate(-50%,-50%) scale(1,1)}
                       50%{transform:translate(-50%,-50%) scale(1.014,.988)}}
  @keyframes mmPop{0%{transform:translate(-50%,-50%) scale(1,1)}
    28%{transform:translate(-50%,-53%) scale(.96,1.06)}
    62%{transform:translate(-50%,-50%) scale(1.05,.95)}
    100%{transform:translate(-50%,-50%) scale(1,1)}}
  @media (prefers-reduced-motion: reduce){.mm-stage,.mm-stage.excited{animation:none}}`;
  document.head.appendChild(s);
}

export function createDogView(el) {
  if (!el) throw new Error('createDogView: 컨테이너가 없습니다');
  injectStyle();
  el.classList.add('mm-dog');
  el.innerHTML = `<div class="mm-stage">
      <div class="mm-body"></div>
      <svg class="mm-collar" viewBox="0 0 100 100" preserveAspectRatio="none"><g></g></svg>
      <div class="mm-face base"></div>
      <div class="mm-face top"></div>
    </div>`;
  const stage = el.querySelector('.mm-stage');
  const collarG = el.querySelector('.mm-collar g');
  const faceBase = el.querySelector('.mm-face.base');
  const faceTop = el.querySelector('.mm-face.top');

  const st = { stage: STAGES[0], collar: COLLARS.mint, face: 'relaxed', ex: 1 };
  let ro = null;

  function cellPos(id, cw) {
    const i = Math.max(0, FACE_IDS.indexOf(id));
    const k = cw / CELL;
    return { size: `${COLS * cw}px ${ROWS * cw}px`,
             pos: `${-(i % COLS) * cw}px ${-Math.floor(i / COLS) * cw}px`, k };
  }

  const MAX_SIZE = 1.14;   // STAGES 중 가장 큰 size — 이걸 1로 정규화해야 성견이 안 넘친다

  function layout() {
    const W = el.clientWidth || 260, H = el.clientHeight || 320;
    /* ★머리는 몸통 왼쪽으로 튀어나온다. 그 양(leftOver)을 폭 계산에 넣지 않으면 잘린다. */
    const cpb = 1.4 * FACE_W * st.stage.head;                       // cellW / bodyW
    const leftOver  = Math.max(0, cpb / 2 - HEAD_CX);
    const rightOver = Math.max(0, HEAD_CX + cpb / 2 - 1);
    const above     = Math.max(0, cpb * CHIN_IN_CELL - HEAD_CHIN * BODY_AR);
    const totalW = leftOver + 1 + rightOver, totalH = BODY_AR + above;
    const bw = Math.min(W / totalW, H / totalH) * 0.96 * (st.stage.size / MAX_SIZE);
    const bh = bw * BODY_AR, cw = cpb * bw;
    const ox = leftOver * bw, oy = above * bw;

    stage.style.width  = totalW * bw + 'px';
    stage.style.height = totalH * bw + 'px';
    const body = el.querySelector('.mm-body');
    body.style.left = ox + 'px'; body.style.top = oy + 'px';
    body.style.width = bw + 'px'; body.style.height = bh + 'px';

    faceBase.style.width = faceTop.style.width = cw + 'px';
    faceBase.style.height = faceTop.style.height = cw + 'px';
    const fl = ox + HEAD_CX * bw - cw / 2, ft = oy + HEAD_CHIN * bh - cw * CHIN_IN_CELL;
    for (const f of [faceBase, faceTop]) { f.style.left = fl + 'px'; f.style.top = ft + 'px'; }
    paintFaces(cw);

    // 목줄 — 머리와 몸통이 만나는 자리. 턱에 일부 가려지는 게 자연스럽다
    const sw = totalW * bw, sh = totalH * bw;
    const nx = (ox + (HEAD_CX + 0.06) * bw) / sw * 100, ny = (oy + (HEAD_CHIN - 0.02) * bh) / sh * 100;
    const rx = bw / sw * 15, ry = bh / sh * 11;
    collarG.innerHTML =
      `<path d="M ${nx - rx} ${ny - ry * 0.4} Q ${nx} ${ny + ry * 0.85} ${nx + rx} ${ny - ry * 0.55}
                L ${nx + rx * 0.94} ${ny - ry * 1.2} Q ${nx} ${ny + ry * 0.2} ${nx - rx * 0.94} ${ny - ry}  Z"
         fill="${st.collar}" stroke="#000" stroke-width="1.6" stroke-linejoin="round"
         vector-effect="non-scaling-stroke"/>
       <ellipse cx="${nx}" cy="${ny + ry * 0.8}" rx="${rx * 0.24}" ry="${ry * 0.32}" fill="#FFCB57"
         stroke="#000" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
  }

  /* 과장 감쇠: 표정 원화는 10장뿐이라 «강도»를 그릴 수 없다.
     대신 기준 표정(편안함) 위에 목표 표정을 겹치고 불투명도를 낮춰 신호를 옅게 만든다.
     ex=1 이면 목표 표정만, ex 가 낮을수록 편안한 얼굴에 가까워진다. */
  function paintFaces(cwArg) {
    const cw = cwArg != null ? cwArg : parseFloat(faceTop.style.width) || CELL;
    const base = cellPos('relaxed', cw), top = cellPos(st.face, cw);
    faceBase.style.backgroundSize = base.size; faceBase.style.backgroundPosition = base.pos;
    faceTop.style.backgroundSize = top.size;   faceTop.style.backgroundPosition = top.pos;
    const sameAsBase = st.face === 'relaxed';
    faceBase.style.opacity = sameAsBase ? 1 : 1;
    faceTop.style.opacity = sameAsBase ? 1 : (0.55 + 0.45 * Math.max(0, Math.min(1, st.ex)));
  }

  layout();
  if ('ResizeObserver' in window) { ro = new ResizeObserver(layout); ro.observe(el); }
  else addEventListener('resize', layout);

  return {
    setStage(s) { if (!s) return; st.stage = s; layout(); },
    setCollar(v) { if (!v) return; st.collar = collarHex(v); layout(); },
    setYaw() {},
    stage: () => st.stage,
    /** pose: (t, ex) => { face, ex } */
    play(pose, ex) {
      const e = (ex == null ? 1 : ex);
      let f = 'relaxed';
      try { const r = pose && pose(0, e); if (r && r.face) f = r.face; } catch (err) {}
      st.face = f; st.ex = e; paintFaces();
      stage.classList.remove('excited'); void stage.offsetWidth; stage.classList.add('excited');
    },
    idle() { st.face = 'relaxed'; st.ex = 1; stage.classList.remove('excited'); paintFaces(); },
    refit: layout,
    dispose() { if (ro) ro.disconnect(); el.innerHTML = ''; },
  };
}
