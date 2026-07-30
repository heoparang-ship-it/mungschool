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

/* ★훈련장 포즈 — 몸통 원화를 통째로 갈아끼운다.
   표정 아틀라스는 «머리»만 담고 있으므로 앉기/엎드리기는 몸통 이미지로 표현한다.
   포즈마다 목 부착점(headCx·headChin)이 달라지므로 함께 갈아끼우지 않으면
   머리가 공중에 뜬다 (03_콘텐츠데이터 art/PLACEHOLDER/anchors.json 실측값).
   ★현재 두 이미지는 «임시»다 — 원화 A1/A2 도착 시 파일과 아래 앵커를 함께 교체할 것. */
const POSES = {
  sitPose:  { body:'./body_sit.webp',  face:'relaxed', cx:0.22, chin:0.46  },
  downPose: { body:'./body_down.webp', face:'relaxed', cx:0.22, chin:0.722 },
};
export const POSE_KEYS = Object.keys(POSES);

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

  /* ═══ 대기 모션 (RPG 대기화면) ═══════════════════════════════════════
     ★«.mm-dog.life» 가 붙은 뷰에서만 돈다. 홈(마당)이 대기화면이고,
       산책길 «신호 읽기» 화면에는 절대 붙이지 않는다 — 그 화면의 자세·표정이
       곧 문제이므로 대기 모션이 섞이면 정답 신호를 흐린다.
     ★표정은 건드리지 않는다. 표정 10종은 전부 «가르치는 신호»라서
       홈에서 무작위로 바꾸면 잘못된 것을 가르친다. 기하(회전·이동)만 쓴다.
     ★JS 타이머를 쓰지 않는다. 주기가 서로 나눠지지 않는 루프
       (1.15 / 2.3 / 3.6 / 4.1 / 8.7초)를 겹치면 조합이 사실상 반복되지 않아
       «랜덤처럼» 보인다. 탭이 숨으면 브라우저가 알아서 멈춘다(배터리 안전). */
  .mm-bob,.mm-wig,.mm-act{position:absolute;left:0;top:0;width:100%;height:100%}
  .mm-shadow{position:absolute;border-radius:50%;opacity:0;pointer-events:none;
    background:radial-gradient(closest-side,rgba(60,110,95,.30),rgba(60,110,95,.10) 62%,rgba(60,110,95,0) 100%)}
  .mm-dog.life .mm-shadow{opacity:1;animation:mmShadow 2.3s ease-in-out infinite}
  /* 몸이 위로 뜨는 들썩임 */
  .mm-dog.life .mm-bob{animation:mmBob 2.3s ease-in-out infinite}
  /* 엉덩이 흔들기 — 앞발을 축으로 몸 전체를 살짝 돌린다.
     꼬리만 따로 돌리려면 원화를 잘라야 하고 그러면 꼬리가 두 개로 보인다.
     실제로 개가 세게 꼬리칠 때 엉덩이가 함께 흔들리므로 이게 더 자연스럽다. */
  .mm-dog.life .mm-wig{transform-origin:48% 98%;animation:mmWig 1.15s ease-in-out infinite}
  /* 8.7초마다 한 번, «폴짝»으로 구두점을 찍는다 — 계속 꼬물거리다가 가끔 크게 */
  .mm-dog.life .mm-act{animation:mmAct 8.7s ease-in-out infinite}
  /* 고갯짓·두리번 — 얼굴 레이어는 턱(50% 100%)이 축이라 그대로 «고개»가 된다.
     base·top 두 장에 같은 애니메이션을 걸어 위상이 어긋나지 않게 한다. */
  .mm-dog.life .mm-face{animation:mmHead 4.1s ease-in-out infinite}
  @keyframes mmBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes mmShadow{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.88);opacity:.72}}
  @keyframes mmWig{0%,100%{transform:rotate(-2.4deg)}50%{transform:rotate(2.4deg)}}
  @keyframes mmHead{0%,100%{transform:rotate(0deg) translateX(0)}
    22%{transform:rotate(-3.2deg) translateX(-1.4%)}
    48%{transform:rotate(1.1deg) translateX(.6%)}
    74%{transform:rotate(3.8deg) translateX(1.6%)}}
  @keyframes mmAct{0%,74%,100%{transform:translateY(0) rotate(0deg)}
    80%{transform:translateY(-9px) rotate(-1.8deg)}
    86%{transform:translateY(1px) rotate(.9deg)}
    92%{transform:translateY(-3px) rotate(0deg)}}
  @media (prefers-reduced-motion: reduce){
    .mm-stage,.mm-stage.excited,
    .mm-dog.life .mm-bob,.mm-dog.life .mm-wig,.mm-dog.life .mm-act,
    .mm-dog.life .mm-face,.mm-dog.life .mm-shadow{animation:none}}`;
  document.head.appendChild(s);
}

export function createDogView(el) {
  if (!el) throw new Error('createDogView: 컨테이너가 없습니다');
  injectStyle();
  el.classList.add('mm-dog');
  /* 대기 모션을 «겹쳐» 쓰려면 층이 필요하다 — 한 요소의 transform 에는
     애니메이션 하나만 살아남기 때문이다. 층마다 다른 주기를 준다.
     .mm-bob(들썩임) → .mm-wig(엉덩이) → .mm-act(구두점) 안에 원래 레이어들이 들어간다.
     세 래퍼 모두 .mm-stage 와 같은 상자(left/top 0, 100%×100%)라
     안쪽 px 좌표 계산은 예전과 완전히 동일하다. */
  el.innerHTML = `<div class="mm-stage">
      <div class="mm-shadow"></div>
      <div class="mm-bob"><div class="mm-wig"><div class="mm-act">
        <div class="mm-body"></div>
        <svg class="mm-collar" viewBox="0 0 100 100" preserveAspectRatio="none"><g></g></svg>
        <div class="mm-face base"></div>
        <div class="mm-face top"></div>
      </div></div></div>
    </div>`;
  const stage = el.querySelector('.mm-stage');
  const shadow = el.querySelector('.mm-shadow');
  const collarG = el.querySelector('.mm-collar g');
  const faceBase = el.querySelector('.mm-face.base');
  const faceTop = el.querySelector('.mm-face.top');

  const st = { stage: STAGES[0], collar: COLLARS.mint, face: 'relaxed', ex: 1, pose: null };
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
    /* 포즈가 걸려 있으면 그 포즈의 몸통·목 부착점을 쓴다 (없으면 서 있는 원화 기준) */
    const P = st.pose ? POSES[st.pose] : null;
    const HCX  = P ? P.cx   : HEAD_CX;
    const HCHIN = P ? P.chin : HEAD_CHIN;
    /* ★머리는 몸통 왼쪽으로 튀어나온다. 그 양(leftOver)을 폭 계산에 넣지 않으면 잘린다. */
    const cpb = 1.4 * FACE_W * st.stage.head;                       // cellW / bodyW
    const leftOver  = Math.max(0, cpb / 2 - HCX);
    const rightOver = Math.max(0, HCX + cpb / 2 - 1);
    const above     = Math.max(0, cpb * CHIN_IN_CELL - HCHIN * BODY_AR);
    const totalW = leftOver + 1 + rightOver, totalH = BODY_AR + above;
    const bw = Math.min(W / totalW, H / totalH) * 0.96 * (st.stage.size / MAX_SIZE);
    const bh = bw * BODY_AR, cw = cpb * bw;
    const ox = leftOver * bw, oy = above * bw;

    stage.style.width  = totalW * bw + 'px';
    stage.style.height = totalH * bw + 'px';
    const body = el.querySelector('.mm-body');
    body.style.left = ox + 'px'; body.style.top = oy + 'px';
    body.style.width = bw + 'px'; body.style.height = bh + 'px';
    body.style.backgroundImage = `url(${P ? P.body : B})`;

    /* 발밑 그림자 — 들썩임과 반대로 오므라들어야 «떴다»가 읽힌다.
       그림자는 .mm-bob 밖(땅)에 있으므로 몸과 함께 올라가지 않는다. */
    const shW = bw * 0.84, shH = bw * 0.155;
    shadow.style.left = (ox + bw * 0.09) + 'px';
    shadow.style.top = (oy + bh - shH * 0.55) + 'px';
    shadow.style.width = shW + 'px';
    shadow.style.height = shH + 'px';

    faceBase.style.width = faceTop.style.width = cw + 'px';
    faceBase.style.height = faceTop.style.height = cw + 'px';
    const fl = ox + HCX * bw - cw / 2, ft = oy + HCHIN * bh - cw * CHIN_IN_CELL;
    for (const f of [faceBase, faceTop]) { f.style.left = fl + 'px'; f.style.top = ft + 'px'; }
    paintFaces(cw);

    // 목줄 — 머리와 몸통이 만나는 자리. 턱에 일부 가려지는 게 자연스럽다
    const sw = totalW * bw, sh = totalH * bw;
    const nx = (ox + (HCX + 0.06) * bw) / sw * 100, ny = (oy + (HCHIN - 0.02) * bh) / sh * 100;
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
    /** 대기 모션 on/off. 홈(마당)에서만 켠다 — 이유는 CSS 주석 참조 */
    setLife(on) { el.classList.toggle('life', on !== false); },
    life: () => el.classList.contains('life'),
    stage: () => st.stage,
    /** pose: (t, ex) => { face, ex }
        face 가 몸통 포즈 키('sitPose'·'downPose')면 «표정»이 아니라 «몸통»을 바꾼다. */
    play(pose, ex) {
      const e = (ex == null ? 1 : ex);
      let f = 'relaxed';
      try { const r = pose && pose(0, e); if (r && r.face) f = r.face; } catch (err) {}
      if (POSES[f]) { st.pose = f; st.face = POSES[f].face; st.ex = e; layout(); }
      else { const wasPosed = !!st.pose; st.pose = null; st.face = f; st.ex = e;
             wasPosed ? layout() : paintFaces(); }
      stage.classList.remove('excited'); void stage.offsetWidth; stage.classList.add('excited');
    },
    /** 포즈를 직접 세우거나(키) 풀 때(null) — 훈련장이 자세를 «유지»시킬 때 쓴다 */
    setPose(k) { const nk = POSES[k] ? k : null; if (nk === st.pose) return;
      st.pose = nk; if (nk) st.face = POSES[nk].face; layout(); },
    pose: () => st.pose,
    idle() { const wasPosed = !!st.pose; st.pose = null; st.face = 'relaxed'; st.ex = 1;
      stage.classList.remove('excited'); wasPosed ? layout() : paintFaces(); },
    refit: layout,
    dispose() { if (ro) ro.disconnect(); el.innerHTML = ''; },
  };
}
