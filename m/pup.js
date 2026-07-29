/* 멍스쿨 — 벡터 치와와. 참고 원화(플랫 3색 + 굵은 검정 라인)를 코드로 재현한다.
   모든 형태는 파라미터 → 표정 10종·과장 감쇠·성장 3단계·견종을 같은 코드로 뽑는다. */

export const PAL = {
  tan:   '#E6C59F',
  white: '#FFFFFF',
  line:  '#000000',
  shade: '#D2B490',
  inner: '#E9A8A0',
  nose:  '#241A22',
  tongue:'#F27F91',
  eye:   '#241A22',
};

const N = n => Math.round(n * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 대칭 큐빅 경로 헬퍼 */
const P = (...seg) => seg.join(' ');

/* ── 기본 표정 파라미터 ── */
export const NEUTRAL = {
  eyeOpen: 1,      // 0 감김 · 1 보통 · 1.35 부릅뜸
  eyeCrescent: 0,  // 1 = 웃는 반달
  gazeX: 0, gazeY: 0,
  sclera: 0,       // 흰자 노출 (눈 흰자 보임)
  browY: 0, browAngle: 0,   // + 안쪽이 올라감(걱정) · − 안쪽이 내려감(화남)
  earBack: 0,      // 0 중립 · 1 뒤로 눕힘 · −1 앞으로 세움
  mouthOpen: 0,    // 0 닫힘 · 1 크게 벌림
  mouthSmile: 0,   // −1 찡그림 · 1 웃음
  teeth: 0, wrinkle: 0,
  tongue: 0,       // 혀 길이
  tongueUp: 0,     // 1이면 코 쪽으로 올라감(입술 핥기)
  headTilt: 0,
};

/* ── 귀 ── */
function ear(side, p) {
  const s = side;                       // −1 왼쪽 · +1 오른쪽
  const back = clamp(p.earBack, -1, 1);
  const fwd = Math.max(0, -back), bak = Math.max(0, back);
  /* 앞으로(관심) = 살짝 더 곧게 서고 길어진다. 뒤로(불안) = 바깥·아래로 눕고 짧아진다.
     ★뒤로 눕힐 때 회전축을 안쪽으로 두어야 «머리 뒤로 넘어간» 것처럼 읽힌다. */
  const rot = s * (bak * 58 - fwd * 12);
  const len = lerp(1, 0.66, bak) * (1 + fwd * 0.08);
  const bx = 200 + s * (74 - bak * 6), by = 176 + bak * 14;   // 귀 뿌리
  const tipX = bx + s * 46 * (1 - back * 0.25);
  const tipY = by - 132 * len;
  const outX = bx + s * 92, outY = by - 26 * len;
  const inX  = bx + s * 6,  inY  = by - 8;
  const d = P(
    `M ${N(inX)} ${N(inY)}`,
    `C ${N(inX + s * 6)} ${N(inY - 62 * len)} ${N(tipX - s * 20)} ${N(tipY + 26 * len)} ${N(tipX)} ${N(tipY)}`,
    `C ${N(tipX + s * 26)} ${N(tipY + 20 * len)} ${N(outX + s * 4)} ${N(outY - 34 * len)} ${N(outX)} ${N(outY)}`,
    `C ${N(outX - s * 10)} ${N(outY + 30)} ${N(bx + s * 26)} ${N(by + 16)} ${N(inX)} ${N(inY)}`,
    'Z');
  // 안쪽 귀 (살짝 축소한 같은 형태)
  const k = 0.58;
  const cx = (inX + tipX + outX) / 3, cy = (inY + tipY + outY) / 3;
  const din = P(
    `M ${N(lerp(cx, inX, k))} ${N(lerp(cy, inY, k))}`,
    `C ${N(lerp(cx, inX + s * 6, k))} ${N(lerp(cy, inY - 62 * len, k))} ${N(lerp(cx, tipX - s * 20, k))} ${N(lerp(cy, tipY + 26 * len, k))} ${N(lerp(cx, tipX, k))} ${N(lerp(cy, tipY, k))}`,
    `C ${N(lerp(cx, tipX + s * 26, k))} ${N(lerp(cy, tipY + 20 * len, k))} ${N(lerp(cx, outX + s * 4, k))} ${N(lerp(cy, outY - 34 * len, k))} ${N(lerp(cx, outX, k))} ${N(lerp(cy, outY, k))}`,
    `C ${N(lerp(cx, outX - s * 10, k))} ${N(lerp(cy, outY + 30, k))} ${N(lerp(cx, bx + s * 26, k))} ${N(lerp(cy, by + 16, k))} ${N(lerp(cx, inX, k))} ${N(lerp(cy, inY, k))}`,
    'Z');
  return `<g transform="rotate(${N(rot)} ${N(bx)} ${N(by)})">
    <path d="${d}" fill="${PAL.tan}" stroke="${PAL.line}" stroke-width="9" stroke-linejoin="round"/>
    <path d="${din}" fill="${PAL.inner}" opacity="0.9"/></g>`;
}

/* ── 눈 ── */
function eye(side, p) {
  const s = side;
  const cx = 200 + s * 52, cy = 224;
  const open = clamp(p.eyeOpen, 0, 1.5);
  const rx = 33, ry = 27 * open;
  if (p.eyeCrescent > 0.5 || open < 0.12) {
    // 반달(웃음) 또는 완전히 감김
    const w = 34, dip = p.eyeCrescent > 0.5 ? -16 : 2;
    return `<path d="M ${N(cx - w)} ${N(cy)} Q ${N(cx)} ${N(cy + dip)} ${N(cx + w)} ${N(cy)}"
      fill="none" stroke="${PAL.line}" stroke-width="9" stroke-linecap="round"/>`;
  }
  const gx = clamp(p.gazeX, -1, 1), gy = clamp(p.gazeY, -1, 1);
  const scl = clamp(p.sclera, 0, 1);
  const tilt = s * -7;                  // 바깥쪽 눈꼬리가 살짝 올라가는 치와와 눈매
  /* ★흰자 노출: 눈알을 흰자로 깔고 동공을 «양쪽 눈 모두 같은 방향»으로 몰아붙인다.
     좌우로 갈라지면 사시가 되어 신호가 안 읽힌다. */
  const dir = gx !== 0 ? Math.sign(gx) : 1;
  const px = gx * 13 + (scl > 0.02 ? dir * rx * 0.30 * scl : 0);
  const py = gy * 9;
  const white = scl > 0.02
    ? `<ellipse cx="${N(cx)}" cy="${N(cy)}" rx="${N(rx)}" ry="${N(ry)}" fill="#FFFFFF" stroke="${PAL.line}" stroke-width="6"/>`
    : '';
  /* 동공을 너무 줄이면 «만화 눈알»이 된다. 흰자는 «초승달»로만 보여야 진짜 whale eye로 읽힌다. */
  const pupR = lerp(rx, rx * 0.72, scl);
  const pupX = cx + px, pupY = cy + py;
  return `<g transform="rotate(${N(tilt)} ${N(cx)} ${N(cy)})">${white}
    <ellipse cx="${N(pupX)}" cy="${N(pupY)}" rx="${N(pupR)}" ry="${N(Math.min(ry, pupR * 0.90))}"
      fill="${PAL.eye}" ${scl > 0.02 ? '' : `stroke="${PAL.line}" stroke-width="4"`}/>
    <ellipse cx="${N(pupX - s * 8)}" cy="${N(pupY - 9)}" rx="${N(7.5 - scl * 3)}" ry="${N(6 - scl * 2.4)}" fill="#FFFFFF" opacity="0.95"/>
    <ellipse cx="${N(pupX + s * 10)}" cy="${N(pupY + 8)}" rx="${N(3.6 - scl * 1.4)}" ry="${N(3 - scl * 1.2)}" fill="#FFFFFF" opacity="0.8"/></g>`;
}

/* ── 눈썹 ── */
function brow(side, p) {
  const s = side;
  const cx = 200 + s * 54, cy = 224 - 40 + p.browY * 10;
  const a = p.browAngle;                       // + 걱정 · − 화남
  const inY  = cy + a * 13, outY = cy - a * 9;
  return `<path d="M ${N(cx - s * 30)} ${N(inY)} Q ${N(cx)} ${N((inY + outY) / 2 - 7)} ${N(cx + s * 27)} ${N(outY)}"
    fill="none" stroke="${PAL.line}" stroke-width="8.5" stroke-linecap="round"/>`;
}

/* ── 입 ── */
function mouth(p) {
  const mx = 200, my = 286;
  const open = clamp(p.mouthOpen, 0, 1);
  const sm = clamp(p.mouthSmile, -1, 1);
  const out = [];
  if (open > 0.04) {
    const w = lerp(30, 62, open), h = lerp(6, 62, open);
    out.push(`<path d="M ${N(mx - w)} ${N(my)} Q ${N(mx)} ${N(my - 10 - sm * 6)} ${N(mx + w)} ${N(my)}
      Q ${N(mx + w * 0.72)} ${N(my + h)} ${N(mx)} ${N(my + h)} Q ${N(mx - w * 0.72)} ${N(my + h)} ${N(mx - w)} ${N(my)} Z"
      fill="#5B2733" stroke="${PAL.line}" stroke-width="8" stroke-linejoin="round"/>`);
    if (p.teeth > 0.1) {
      const tw = w * 0.82;
      out.push(`<path d="M ${N(mx - tw)} ${N(my + 1)} L ${N(mx - tw * 0.55)} ${N(my + 15)} L ${N(mx - tw * 0.18)} ${N(my + 1)}
        L ${N(mx + tw * 0.18)} ${N(my + 15)} L ${N(mx + tw * 0.55)} ${N(my + 1)} L ${N(mx + tw)} ${N(my + 13)}"
        fill="#FFFFFF" stroke="${PAL.line}" stroke-width="4" stroke-linejoin="round"/>`);
    }
    if (p.tongue > 0.05) {
      const tl = lerp(10, h * 0.9, p.tongue);
      out.push(`<path d="M ${N(mx - 20)} ${N(my + h * 0.34)} Q ${N(mx)} ${N(my + h * 0.28)} ${N(mx + 20)} ${N(my + h * 0.34)}
        Q ${N(mx + 16)} ${N(my + h * 0.34 + tl)} ${N(mx)} ${N(my + h * 0.34 + tl)}
        Q ${N(mx - 16)} ${N(my + h * 0.34 + tl)} ${N(mx - 20)} ${N(my + h * 0.34)} Z"
        fill="${PAL.tongue}" stroke="${PAL.line}" stroke-width="6" stroke-linejoin="round"/>`);
    }
  } else {
    // 다문 입 — 가운데에서 좌우로 흘러내리는 W자
    const w = 34, dip = lerp(11, -9, (sm + 1) / 2);
    out.push(`<path d="M ${N(mx)} ${N(my - 12)} L ${N(mx)} ${N(my - 2)}
      M ${N(mx - w)} ${N(my + dip)} Q ${N(mx - w * 0.4)} ${N(my - 3)} ${N(mx)} ${N(my - 2)}
      Q ${N(mx + w * 0.4)} ${N(my - 3)} ${N(mx + w)} ${N(my + dip)}"
      fill="none" stroke="${PAL.line}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (p.tongue > 0.05 && p.tongueUp < 0.5) {
      const tl = lerp(8, 40, p.tongue);
      out.push(`<path d="M ${N(mx - 15)} ${N(my - 2)} Q ${N(mx)} ${N(my + 4)} ${N(mx + 15)} ${N(my - 2)}
        Q ${N(mx + 12)} ${N(my + tl)} ${N(mx)} ${N(my + tl)} Q ${N(mx - 12)} ${N(my + tl)} ${N(mx - 15)} ${N(my - 2)} Z"
        fill="${PAL.tongue}" stroke="${PAL.line}" stroke-width="6" stroke-linejoin="round"/>`);
    }
  }
  /* 입술 핥기 — 혀가 입 왼쪽에서 나와 코 옆을 훑고 올라간다.
     코(y 246~278)를 덮어야 «핥는» 것으로 읽히므로 코보다 위까지 올린다. */
  if (p.tongueUp > 0.05) {
    const u = clamp(p.tongueUp, 0, 1);
    const topY = lerp(my - 6, 242, u), topX = lerp(mx - 4, mx + 30, u);
    out.push(`<path d="M ${N(mx - 26)} ${N(my + 2)}
      C ${N(mx - 34)} ${N(lerp(my - 6, my - 40, u))} ${N(topX - 34)} ${N(topY + 4)} ${N(topX)} ${N(topY)}
      C ${N(topX + 12)} ${N(topY + 20)} ${N(mx - 4)} ${N(lerp(my, my - 14, u))} ${N(mx - 6)} ${N(my + 10)} Z"
      fill="${PAL.tongue}" stroke="${PAL.line}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  return out.join('\n');
}

/* ── 얼굴 전체 ── */
export function faceSVG(over = {}, opt = {}) {
  const p = Object.assign({}, NEUTRAL, over);
  const size = opt.size || 400;
  const tilt = p.headTilt * 12;

  const skull = `<path d="M 200 118
    C 268 118 313 166 313 226 C 313 292 268 336 200 336
    C 132 336 87 292 87 226 C 87 166 132 118 200 118 Z"
    fill="${PAL.tan}" stroke="${PAL.line}" stroke-width="10" stroke-linejoin="round"/>`;

  // 흰 주둥이 — 얼굴 아래 절반을 덮는 넓은 타원
  const muzzle = `<path d="M 200 232
    C 258 232 288 262 288 292 C 288 324 250 344 200 344
    C 150 344 112 324 112 292 C 112 262 142 232 200 232 Z"
    fill="${PAL.white}" stroke="${PAL.line}" stroke-width="9" stroke-linejoin="round"/>`;

  const wrinkle = p.wrinkle > 0.1 ? `
    <path d="M 178 250 Q 190 242 202 250 M 176 262 Q 189 254 201 262"
      fill="none" stroke="${PAL.line}" stroke-width="6" stroke-linecap="round" opacity="${N(clamp(p.wrinkle, 0, 1))}"/>` : '';

  const nose = `<path d="M 200 246 C 216 246 224 254 224 262 C 224 272 212 278 200 278
    C 188 278 176 272 176 262 C 176 254 184 246 200 246 Z"
    fill="${PAL.nose}" stroke="${PAL.line}" stroke-width="6" stroke-linejoin="round"/>
    <ellipse cx="192" cy="256" rx="5" ry="3.4" fill="#FFFFFF" opacity="0.5"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="${size}" height="${size}">
  <g transform="rotate(${N(tilt)} 200 260)">
    ${ear(-1, p)}${ear(1, p)}
    ${skull}
    ${muzzle}
    ${wrinkle}
    ${brow(-1, p)}${brow(1, p)}
    ${eye(-1, p)}${eye(1, p)}
    ${nose}
    ${mouth(p)}
  </g>
</svg>`;
}

/* ── 카밍 시그널 10종 (ex = 과장 계수 1→0) ── */
const S = (base) => (ex = 1) => {
  const o = {};
  for (const k in base) o[k] = typeof base[k] === 'number' ? base[k] * ex : base[k];
  return o;
};
export const FACES = {
  relaxed:  S({ eyeCrescent: 1, mouthOpen: 0.12, mouthSmile: 0.5 }),
  curious:  S({ earBack: -1, eyeOpen: 1.15, headTilt: 1, browY: -0.6 }),
  lipLick:  S({ tongueUp: 1, eyeOpen: 0.85, browY: 0.3 }),
  yawn:     S({ mouthOpen: 1, eyeCrescent: 1, tongue: 0.5, browY: 0.4 }),
  lookAway: S({ gazeX: -1, browAngle: 0.4, earBack: 0.25, headTilt: -0.5 }),
  whaleEye: S({ sclera: 1, gazeX: 0.9, browAngle: 0.7, eyeOpen: 1.15 }),
  earsBack: S({ earBack: 1, browAngle: 1, eyeOpen: 0.75, mouthSmile: -0.5 }),
  snarl:    S({ browAngle: -1, wrinkle: 1, mouthOpen: 0.55, teeth: 1, earBack: 0.5 }),
  joy:      S({ eyeCrescent: 1, mouthOpen: 0.8, mouthSmile: 1, tongue: 0.8, earBack: -0.5 }),
  panting:  S({ mouthOpen: 0.6, tongue: 1, eyeOpen: 0.7, browY: 0.3 }),
};

/* ══════════════ 몸통 ══════════════
   ★2등신 = 턱~정수리(귀 제외)가 지면~정수리 전체 높이의 정확히 절반.
   얼굴 모듈의 머리는 y 118~344(=226) → 전체 높이가 452가 되도록 좌표를 못 박는다.
     정수리 40 · 턱 266 · 몸통 258~430 · 다리 410~480 · 지면 492   (492-40=452 ✅)
   머리 폭(226)이 몸통 폭(192)보다 넓어야 치비로 읽힌다. 반대가 되면 어른 체형이 된다. */

export const STAGES = [
  { key:'pup',   name:'아기',   head:1.08, leg:0.60, body:0.94, wide:1.10, ratio:1.77 },
  { key:'teen',  name:'청소년', head:1.00, leg:1.00, body:1.00, wide:1.00, ratio:1.98 },
  { key:'adult', name:'성견',   head:0.93, leg:1.42, body:1.06, wide:0.93, ratio:2.23 },
];
export const stageFor = learned => learned >= 8 ? STAGES[2] : learned >= 4 ? STAGES[1] : STAGES[0];

const SW = 10;                       // 몸통 외곽선 두께
const CX = 220, BODY_CY = 344;       // 화폭 중심 · 몸통 중심

function leg(x, topY, botY, w, fill) {
  const r = w * 0.5;
  return `<path d="M ${N(x - w / 2)} ${N(topY)} L ${N(x - w / 2)} ${N(botY - r)}
    Q ${N(x - w / 2)} ${N(botY + r * 0.7)} ${N(x)} ${N(botY + r * 0.7)}
    Q ${N(x + w / 2)} ${N(botY + r * 0.7)} ${N(x + w / 2)} ${N(botY - r)}
    L ${N(x + w / 2)} ${N(topY)} Z"
    fill="${fill}" stroke="${PAL.line}" stroke-width="${SW}" stroke-linejoin="round"/>`;
}

/** 몸통 · 다리 · 꼬리 · 목줄 */
export function bodySVG(p, st, collar) {
  const w = 96 * st.wide, h = 86 * st.body;
  const cy = BODY_CY, cx = CX;
  const crouch = clamp(p.crouch || 0, 0, 1);
  const legLen = 70 * st.leg * (1 - crouch * 0.36);
  const legTop = cy + h * 0.62;
  const legBot = legTop + legLen;

  const tail = `<path d="M ${N(cx + w * 0.74)} ${N(cy + 4)}
    C ${N(cx + w * 1.42)} ${N(cy + 6)} ${N(cx + w * 1.70)} ${N(cy - 82)} ${N(cx + w * 1.02)} ${N(cy - 104)}
    C ${N(cx + w * 1.42)} ${N(cy - 62)} ${N(cx + w * 1.20)} ${N(cy - 20)} ${N(cx + w * 0.66)} ${N(cy - 30)} Z"
    fill="${PAL.tan}" stroke="${PAL.line}" stroke-width="${SW}" stroke-linejoin="round"/>`;

  const bw = 40 * st.wide, fw = 38 * st.wide;
  const backL  = leg(cx - w * 0.66, legTop - 22, legBot - 4, bw, PAL.tan);
  const backR  = leg(cx + w * 0.66, legTop - 22, legBot - 4, bw, PAL.tan);
  const frontL = leg(cx - w * 0.30, legTop - 6, legBot, fw, PAL.white);
  const frontR = leg(cx + w * 0.30, legTop - 6, legBot, fw, PAL.white);

  // 몸통 — 위가 좁고 아래가 넓은 서양배 실루엣
  const torso = `<path d="M ${N(cx)} ${N(cy - h)}
    C ${N(cx + w * 0.72)} ${N(cy - h)} ${N(cx + w * 1.02)} ${N(cy - h * 0.2)} ${N(cx + w)} ${N(cy + h * 0.56)}
    C ${N(cx + w * 0.96)} ${N(cy + h * 1.06)} ${N(cx - w * 0.96)} ${N(cy + h * 1.06)} ${N(cx - w)} ${N(cy + h * 0.56)}
    C ${N(cx - w * 1.02)} ${N(cy - h * 0.2)} ${N(cx - w * 0.72)} ${N(cy - h)} ${N(cx)} ${N(cy - h)} Z"
    fill="${PAL.white}" stroke="${PAL.line}" stroke-width="${SW}" stroke-linejoin="round"/>`;

  // 등·어깨의 탠 — 참고 원화의 «등은 탠, 가슴은 흰» 배색
  const saddle = `<path d="M ${N(cx - w * 0.99)} ${N(cy - h * 0.02)}
    C ${N(cx - w * 0.99)} ${N(cy - h * 0.92)} ${N(cx + w * 0.99)} ${N(cy - h * 0.92)} ${N(cx + w * 0.99)} ${N(cy - h * 0.02)}
    C ${N(cx + w * 0.52)} ${N(cy - h * 0.46)} ${N(cx - w * 0.52)} ${N(cy - h * 0.46)} ${N(cx - w * 0.99)} ${N(cy - h * 0.02)} Z"
    fill="${PAL.tan}"/>`;

  const cyB = cy - h * 0.70;
  const band = `<path d="M ${N(cx - w * 0.62)} ${N(cyB - 12)}
    Q ${N(cx)} ${N(cyB + 20)} ${N(cx + w * 0.62)} ${N(cyB - 12)}
    L ${N(cx + w * 0.58)} ${N(cyB - 30)} Q ${N(cx)} ${N(cyB + 2)} ${N(cx - w * 0.58)} ${N(cyB - 30)} Z"
    fill="${collar}" stroke="${PAL.line}" stroke-width="7" stroke-linejoin="round"/>
    <circle cx="${N(cx)}" cy="${N(cyB + 22)}" r="12" fill="#FFCB57" stroke="${PAL.line}" stroke-width="6"/>`;

  return { svg: `${tail}${backL}${backR}${torso}${saddle}${frontL}${frontR}${band}`,
           neckY: cy - h + 8, ground: legBot + 20 * st.wide };
}

/** 강아지 전체 — 몸통 + 얼굴 */
export function dogSVG(over = {}, opt = {}) {
  const p = Object.assign({}, NEUTRAL, { crouch: 0, bounce: 0 }, over);
  const st = opt.stage || STAGES[1];
  const collar = opt.collar || '#2AB7A9';
  const b = bodySVG(p, st, collar);
  const hs = st.head;
  // 얼굴 모듈의 턱(y=344)이 몸통 목선에 닿도록 맞춘다
  const hx = CX - 200 * hs;
  const hy = b.neckY - 344 * hs - (p.bounce || 0) * 14;
  const face = faceSVG(p, { size: 400 }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const W = opt.size || 400;
  /* ★viewBox 위쪽을 −90 까지 열어야 아기 단계(머리 1.08배)의 귀 끝이 잘리지 않는다.
     세 단계의 키가 서로 다른 건 의도된 것 — 성장이 화면에서 보여야 한다. */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -90 440 620" width="${W}" height="${N(W * 620 / 440)}">
  <g>${b.svg}</g>
  <g transform="translate(${N(hx)} ${N(hy)}) scale(${N(hs)})">${face}</g>
</svg>`;
}

/** 실측: 이 단계의 등신비 (턱~정수리 대비 전체 높이). 귀는 제외한다. */
export function measure(st) {
  const b = bodySVG(NEUTRAL, st, '#000');
  const hs = st.head;
  const hy = b.neckY - 344 * hs;
  const skullTop = hy + 118 * hs, chin = hy + 344 * hs;
  const headH = chin - skullTop, total = b.ground - skullTop;
  return { headH: N(headH), total: N(total), ratio: N(total / headH) };
}
