/* ═══════════════════════════════════════════════════════════════════════════
   멍스쿨 모바일 — «훈련장» 코어  (train.js)
   CONTRACTS §4 소유: 에이전트 A. ES 모듈 1개로 로직·뷰·컨트롤러를 모두 담는다.

   구성
     §1 판정 엔진   — 순수 로직 (v2 §3 수식 그대로). DOM 을 만지지 않는다.
     §2 뷰          — CSS 문자열 + 순수 템플릿 함수. 상태를 모른다.
     §3 컨트롤러    — 상태기계·제스처·음성·FTUE 각본·시트. DOM 은 여기서만.

   ★모듈 최상위에서 document/window 를 만지지 않는다 — verify-train.mjs 가
     Node 에서 이 파일을 그대로 import 해 엔진을 검증하기 때문이다.
   ★엔진·뷰 심볼을 named export 로 열어 둔 것은 검증용이다. CONTRACTS §4 의
     createTrainingYard(ctx) 시그니처는 그대로다 (추가일 뿐, 변경 아님).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ §1 판정 엔진 ═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   멍스쿨 훈련장 — 판정 엔진 (train.js 에 그대로 이어붙는 조각)
   ★순수 로직만. DOM·import·전역 부수효과 없음. 난수는 반드시 주입받는다(rng)
     — 그래야 검증기가 같은 씨앗으로 같은 결과를 재현할 수 있다.
   ★수치는 전부 CONTRACTS v2 §3 그대로. 여기서 임의로 바꾸면 밸런스가 깨진다.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Lv0..Lv5 하한. Lv5(95~100)=마스터 — «간식 없이도 듣는다»의 증표 */
export const LV_MIN = [0, 20, 40, 60, 80, 95];
export const DAILY_CAP = 24;          // 명령당 하루 숙련도 상한 — 하루 몰아치기 방지
export const REPS_PER_SESSION = 8;    // 1세션 8회. 개의 집중력이 여기까지다
export const PRAISE_MS = 1200;        // 성공 후 칭찬 유효창
export const PITY_AFTER = 2;          // 2연속 실패 뒤부터 피티 — 3연속 실패는 만들지 않는다

/* ── 작은 도구들 ───────────────────────────────────────────────────────── */

export function clamp(v, a, b) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  return n < a ? a : n > b ? b : n;
}

/* 숫자 아닌 입력이 섞여도 판정이 NaN 으로 무너지지 않게 한다 */
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : (d || 0); }

export function lvOf(m) {
  const v = clamp(m, 0, 100);
  let lv = 0;
  for (let i = 0; i < LV_MIN.length; i++) if (v >= LV_MIN[i]) lv = i;
  return lv;
}

/* 밴드 진행률 — 게이지 UI 전용. Lv5 는 위가 없으므로 항상 100 */
export function lvBand(m) {
  const v = clamp(m, 0, 100);
  const lv = lvOf(v);
  const from = LV_MIN[lv];
  const to = lv >= LV_MIN.length - 1 ? 100 : LV_MIN[lv + 1];
  const span = to - from;
  const pct = lv >= LV_MIN.length - 1 ? 100 : clamp(((v - from) / (span || 1)) * 100, 0, 100);
  return { lv, from, to, pct };
}

/* 간식 3단계: 루어링(코앞에서 끌기) → 보상(하고 나서 주기) → 페이드아웃(없이) */
export function treatStage(lv) { return lv <= 1 ? 1 : lv <= 3 ? 2 : 3; }

/* 간식 성공률 보정. ★프렌치는 먹을 것 앞에서 특히 잘 움직인다 — 루어링 단계만 ×1.5 */
export function treatBonus(lv, breedKey) {
  const st = treatStage(lv);
  const base = st === 1 ? 20 : st === 2 ? 15 : 8;
  return st === 1 && breedKey === 'fr' ? base * 1.5 : base;
}

/* 지속형(기다려) 목표 유지 시간 — 레벨이 오를수록 길게 버텨야 한다 */
export function targetHoldMs(lv) { return 2000 + clamp(lv, 0, 5) * 1000; }

/* ── 해금 트리 ─────────────────────────────────────────────────────────── */
/* COMMANDS[x].unlock = null | ['sit',2] | ['avg',3]
   sit(기본) → stay(sit Lv2) → paw·down(sit Lv3) → come(stay Lv2) → spin(평균 Lv3) */
export function unlockedOf(tr, COMMANDS) {
  const ids = Object.keys(COMMANDS || {});
  const out = {};
  for (const id of ids) out[id] = !COMMANDS[id] || COMMANDS[id].unlock == null;

  const lvAt = id => {
    const c = tr && tr.cmds && tr.cmds[id];
    return c ? lvOf(c.m) : 0;
  };

  /* 해금은 연쇄한다(sit→stay→come). 변화가 없을 때까지 돌려 고정점을 찾는다 */
  for (let pass = 0; pass <= ids.length; pass++) {
    let changed = false;
    for (const id of ids) {
      if (out[id]) continue;
      const u = COMMANDS[id] && COMMANDS[id].unlock;
      if (!u) continue;
      const dep = u[0], need = num(u[1], 0);
      let ok;
      if (dep === 'avg') {
        /* ★자기 자신은 평균에서 뺀다. 넣으면 해금되는 순간 Lv0 이 평균을 끌어내려 다시 잠긴다 */
        const pool = ids.filter(x => out[x] && x !== id);
        ok = pool.length > 0 && pool.reduce((s, x) => s + lvAt(x), 0) / pool.length >= need;
      } else {
        ok = out[dep] === true && lvAt(dep) >= need;
      }
      if (ok) { out[id] = true; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

/* 잠긴 카드에 붙일 안내. 왜 못 쓰는지 «조건»으로 말해준다 */
export function lockLabel(cmdId, COMMANDS, tr) {
  const cmd = COMMANDS && COMMANDS[cmdId];
  if (!cmd || cmd.unlock == null) return '';
  if (tr && unlockedOf(tr, COMMANDS)[cmdId]) return '';
  const dep = cmd.unlock[0], need = num(cmd.unlock[1], 0);
  const who = dep === 'avg' ? '평균' : ((COMMANDS[dep] && COMMANDS[dep].name) || dep);
  return `${who} Lv${need}에 열려요`;
}

/* ── 톤·제스처 ─────────────────────────────────────────────────────────── */

/* tone={len,firm,once} 세 조건(짧게·단호하게·한 번만) 충족 개수 */
export function toneScore(tone) {
  if (!tone) return null;
  return (tone.len ? 1 : 0) + (tone.firm ? 1 : 0) + (tone.once ? 1 : 0);
}

/* 음성이 없으면 제스처로 대체 채점 — 마이크 거부한 사용자도 훈련이 되게 */
export function toneBonus(tone, gestureQuality) {
  const s = toneScore(tone);
  if (s == null) return gestureQuality === 'perfect' ? 10 : gestureQuality === 'ok' ? 5 : 0;
  return s >= 3 ? 10 : s === 2 ? 5 : 0;
}

/* ── 성공률 (v2 §3) ────────────────────────────────────────────────────── */

export function successRate(o) {
  const i = o || {};
  const B = num(i.B, 0), D = num(i.D, 0), m = clamp(i.m, 0, 100);
  const base = B * D;
  const M = m * 0.5;
  const T = toneBonus(i.tone, i.gestureQuality);

  /* 상황 보정 S — «개는 상황에 반응한다»를 숫자로 옮긴 부분 */
  const S =
      (i.treatOn ? treatBonus(lvOf(m), i.breed) : 0)
    + (i.afterCorrectSignal ? 15 : 0)          // 거부 신호를 읽고 옳게 대응했다
    + (i.forced ? -30 : 0)                     // 거부를 무시하고 밀어붙였다
    + (i.breed === 'chi' && num(i.mood, 0) > 0 ? -20 : 0)   // 치와와: 기분 나쁘면 안 듣는다
    + (i.breed === 'chi' && num(i.bond, 0) < 30 ? -15 : 0)  // 치와와: 유대 없으면 안 듣는다
    + (i.breed === 'bc' && num(i.gauge, 0) >= 6 ? -20 : 0)  // 보더콜리: 에너지 넘치면 못 참는다
    + (num(i.walkBoost, 0) > 0 ? 10 : 0);      // 산책으로 욕구를 풀어준 직후

  const pity = i.pity ? 20 : 0;
  const rate = clamp(base + M + T + S + pity, 5, 98);
  return { rate, parts: { B, D, base, M, T, S, pity } };
}

/* ── 숙련도 (v2 §3) ────────────────────────────────────────────────────── */

export function proficiencyGain(o) {
  const i = o || {};
  if (i.result === 'fail') return 2;          // 실패해도 시도는 훈련이다 — 배율·보너스 없음
  if (i.result !== 'succ' && i.result !== 'partial') return 0;

  let raw = 8 * num(i.breedMult, 1)
    + (i.praiseHit ? 2 : 0)                   // 칭찬 타이밍을 맞췄다
    + (i.toneFull ? 2 : 0)                    // 톤 3요소 만점
    + (i.treatStage2Given ? 2 : 0);           // 보상 단계에서 «하고 나서» 줬다
  if (i.afterCorrectSignal) raw *= 1.5;
  if (i.comeback) raw *= 2;                   // 복귀 첫 성공 — 다시 온 사람을 붙잡는다
  if (i.result === 'partial') raw /= 2;       // 부분 성공은 성공값의 절반
  return Math.round(raw);
}

/* ── 일일 상한 ─────────────────────────────────────────────────────────── */

/* 날짜가 바뀌면 오늘 획득량을 비운다. 호출측이 매 rep 앞에서 불러도 안전하다 */
export function ensureDay(tr, day) {
  if (!tr) return false;
  if (!tr.todayGain) tr.todayGain = {};
  if (tr.day !== day) { tr.day = day; tr.todayGain = {}; return true; }
  return false;
}

export function applyGain(tr, cmdId, raw) {
  if (!tr.todayGain) tr.todayGain = {};
  const want = Math.max(0, num(raw, 0));
  const cur = num(tr.todayGain[cmdId], 0);
  const room = Math.max(0, DAILY_CAP - cur);
  const applied = Math.min(want, room);
  const todayTotal = cur + applied;
  tr.todayGain[cmdId] = todayTotal;
  return { applied, capped: applied < want, todayTotal };
}

/* ── 레벨업 정보 ───────────────────────────────────────────────────────── */

export function lvUpInfo(before, after) {
  const from = lvOf(before), to = lvOf(after);
  const leveled = to > from;
  return {
    leveled,
    from, to,
    isMaster: leveled && to === 5,
    /* Lv3 부터 수신호로 바뀐다 — 연출이 완전히 달라지는 지점 */
    isSignSwitch: from < 3 && to >= 3,
  };
}

/* ── 1 rep 판정 ────────────────────────────────────────────────────────── */

export function rollRep(o, rng) {
  const i = o || {};
  const R = typeof rng === 'function' ? rng : Math.random;

  /* 피티: 2연속 실패 뒤에는 rate 에 +20 을 얹고, 판정 자체를 성공으로 못박는다.
     «3연속 실패는 구조적으로 불가능»(v2)은 이렇게만 성립한다 — 확률 보정만으로는 못 막는다 */
  const pity = !!(i.pity || num(i.failStreak, 0) >= PITY_AFTER);
  const sr = successRate(Object.assign({}, i, { pity }));
  const rate = sr.rate;

  const sustain = !!i.sustain;
  const holdTarget = sustain ? targetHoldMs(lvOf(i.m)) : 0;

  /* 톤 만점 여부는 호출측이 넘겨도 되고, 안 넘기면 tone/제스처에서 뽑는다 */
  const toneFull = i.toneFull != null
    ? !!i.toneFull
    : (i.tone ? toneScore(i.tone) === 3 : i.gestureQuality === 'perfect');

  const done = result => ({
    result, rate, holdTarget,
    /* 성공이 «굴림»이 아니라 피티로 나온 것인지 — 연출·로그에서 구분해야 한다 */
    forcedByPity: result === 'succ' && pity,
    gain: proficiencyGain({
      result,
      breedMult: num(i.breedMult, 1),
      praiseHit: !!i.praiseHit,
      toneFull,
      afterCorrectSignal: !!i.afterCorrectSignal,
      treatStage2Given: !!i.treatStage2Given,
      comeback: !!i.comeback,
    }),
  });

  /* 1) 프렌치 갸우뚱 — 간식 없이 부르면 «지금요?» 하고 고개만 돌린다. rep 미소모는 호출측 책임 */
  if (i.noTreatFrenchTilt) return { result: 'tilt', rate, forcedByPity: false, gain: 0, holdTarget };

  /* 3-a) 부분 성공은 실패가 아니다 → 피티보다 먼저 갈라내고, 피티를 적용하지 않는다 */
  const holdMs = num(i.holdMs, 0);
  if (sustain && holdMs >= holdTarget * 0.5 && holdMs < holdTarget) return done('partial');

  /* 2) 피티 — 여기서부터는 무조건 성공 */
  if (pity) return done('succ');

  /* 3-b) 목표의 절반도 못 버텼다 */
  if (sustain && holdMs < holdTarget * 0.5) return done('fail');

  /* 4) 일반 굴림 */
  return done(R() * 100 < rate ? 'succ' : 'fail');
}

/* ── rep 반영 + 마스터 판정 (v2 §3-1 페이드아웃) ───────────────────────── */

export function applyRep(tr, cmdId, repOut, opts) {
  const op = opts || {};
  if (op.day != null) ensureDay(tr, op.day);
  if (!tr.cmds) tr.cmds = {};
  if (!tr.cmds[cmdId]) tr.cmds[cmdId] = { m: 0, lv: 0, tries: 0, succ: 0, masterHits: 0 };

  const c = tr.cmds[cmdId];
  const rep = repOut || {};
  const mBefore = clamp(c.m, 0, 100);
  const lvBefore = lvOf(mBefore);

  /* 갸우뚱은 rep 이 아니다 — 아무것도 소모·적립하지 않는다 */
  if (rep.result === 'tilt') {
    return { applied: 0, capped: false, mBefore, mAfter: mBefore,
             lv: lvUpInfo(mBefore, mBefore), masterHit: false };
  }

  /* 1) 일일 상한 */
  const g = applyGain(tr, cmdId, rep.gain);
  let mAfter = clamp(mBefore + g.applied, 0, 100);

  /* 2) ★페이드아웃 벽: Lv4(80~94) 에서 «간식을 쓴» rep 은 94 를 넘길 수 없다.
        간식 없이 해낸 성공만 Lv5 로 넘어간다 — 간식 있을 때만 듣는 개는 훈련된 게 아니다.
        (실패 +2 로 몰래 넘어가는 구멍도 막아야 하므로 result 를 가리지 않고 벽을 세운다) */
  if (op.treatUsed && lvBefore === 4 && mAfter > 94) mAfter = 94;

  c.m = mAfter;
  c.lv = lvOf(mAfter);

  /* 3) 마스터 카운트 — Lv4 이상에서 «간식 없이» 성공한 횟수만 센다 */
  const masterHit = lvBefore >= 4 && rep.result === 'succ' && !op.treatUsed;
  if (masterHit) c.masterHits = num(c.masterHits, 0) + 1;

  /* 4) 시도·성공 집계 */
  c.tries = num(c.tries, 0) + 1;
  if (rep.result === 'succ') c.succ = num(c.succ, 0) + 1;

  return {
    applied: mAfter - mBefore,
    capped: g.capped,
    mBefore, mAfter,
    lv: lvUpInfo(mBefore, mAfter),
    masterHit,
  };
}

/* ═══ §2 뷰 (CSS · 템플릿) ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════
   훈련장 뷰 레이어 (SA-2)
   ── 이 파일은 train.js 안으로 «그대로» 이어붙는 조각이다.
   ── 상태도 이벤트도 없다. 문자열만 만든다. 그래야 컨트롤러가
      언제 어떤 화면을 그릴지 혼자 결정할 수 있고, 뷰는 테스트가 쉬워진다.
   ── 모든 셀렉터에 .ty 프리픽스를 붙였다. 이 CSS는 기존 앱의
      <style> 안으로 «주입»되므로, 프리픽스가 없으면 .opt/.row/.lock 같은
      기존 클래스와 정면충돌한다(기존 앱 주석에도 .lock 충돌 사고 기록이 있다).
   ═══════════════════════════════════════════════════════════════ */

/* 한 번만 <style>에 주입되는 훈련장 전용 CSS.
   기존 앱의 문법(3D 눌림 버튼 = box-shadow 0 5px 0 짙은색 + :active translateY,
   크림 배경, 900/1000 굵기, letter-spacing 마이너스, em으로 이모지 감싸기)을
   그대로 따랐다. 새 팔레트를 만들지 않고 :root 변수를 재사용한다 —
   훈련장이 «다른 앱»처럼 보이면 안 되기 때문이다. 다크 모드는 없다. */
export const TRAIN_CSS = `
/* ── 루트: 부모(섹션)를 꽉 채우는 세로 스택 ── */
.ty{position:relative;flex:1 1 auto;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;
    background:linear-gradient(#F2F9F5,#FFF8EE);color:var(--ink);
    font-family:'Pretendard','Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,sans-serif;
    line-height:1.6;overflow:hidden}
.ty *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.ty button{font-family:inherit;cursor:pointer;border:0}
.ty em{font-style:normal}
.ty-hide{display:none!important}

/* ── 컨트롤러 소유 껍데기 ──
   .ty-body 가 화면 하나를 통째로 갈아끼우는 자리다. 시트·오버레이는 그 «위»에 뜬다. */
.ty-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.ty-toast{position:absolute;left:50%;bottom:calc(var(--sb,0px) + 18px);transform:translateX(-50%) translateY(12px);
          z-index:70;padding:11px 18px;border-radius:14px;background:rgba(35,58,52,.94);color:#fff;
          font-size:12.5px;font-weight:800;opacity:0;transition:opacity .28s,transform .28s;
          pointer-events:none;max-width:86%;text-align:center;line-height:1.5}
.ty-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
/* FTUE 코치 말풍선 — 시트로 덮으면 손짓을 못 하므로 «막지 않는» 안내가 필요하다 */
.ty-coachbar{position:absolute;left:12px;right:12px;top:calc(var(--st,0px) + 56px);z-index:55;
             padding:12px 15px;border-radius:16px;background:rgba(30,140,116,.96);color:#fff;
             font-size:13px;font-weight:900;line-height:1.6;letter-spacing:-.3px;text-align:center;
             box-shadow:0 8px 24px rgba(30,140,116,.28);opacity:0;transform:translateY(-8px);
             transition:opacity .28s,transform .28s;pointer-events:none}
.ty-coachbar.on{opacity:1;transform:none}
/* 홈의 강아지 자리 — rep 화면보다 낮게 잡아 카드가 먼저 보이게 한다 */
.ty-dog.home{flex:none;height:26vh;max-height:190px;min-height:110px}
@media (prefers-reduced-motion: reduce){.ty-toast,.ty-coachbar{transition:none}}

/* ── 상단 바: 뒤로 38px + 제목 + 🍖 칩 ── */
.ty-head{display:flex;align-items:center;gap:10px;padding:calc(var(--st,0px) + 12px) 14px 8px;flex:none}
.ty-back{width:38px;height:38px;flex:none;border-radius:12px;background:rgba(255,255,255,.92);
         font-size:17px;color:#4a6d64;box-shadow:0 3px 10px rgba(60,110,95,.1);
         transition:transform .12s,box-shadow .12s}
.ty-back:active{transform:translateY(2px);box-shadow:0 1px 6px rgba(60,110,95,.12)}
.ty-title{flex:1;min-width:0;font-size:16.5px;font-weight:1000;letter-spacing:-.5px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ty-title small{display:block;font-size:11px;font-weight:800;color:var(--sub);letter-spacing:-.2px}
.ty-treats{flex:none;display:flex;align-items:center;gap:4px;padding:7px 12px;border-radius:999px;
           background:rgba(255,180,84,.2);color:var(--amber-d);font-size:12.5px;font-weight:1000;
           letter-spacing:-.3px}
.ty-treats em{font-size:15px;line-height:1}

/* ── 스크롤 본문(홈·리포트 공용) ── */
.ty-sc{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
.ty-wrap{padding:4px 14px calc(var(--sb,0px) + 22px);max-width:520px;margin:0 auto;width:100%}

/* ── 훈련장 홈: 말풍선 + 명령 카드 목록 ── */
.ty-bubble{position:relative;margin:6px auto 14px;max-width:300px;padding:10px 15px;border-radius:16px;
           background:#fff;color:#41645c;font-size:12.5px;font-weight:800;text-align:center;
           box-shadow:0 6px 18px rgba(60,110,95,.16)}
.ty-bubble::after{content:'';position:absolute;left:50%;bottom:-6px;margin-left:-6px;
                  border:6px solid transparent;border-top-color:#fff;border-bottom:0}
.ty-cards{display:grid;gap:10px}
.ty-card{width:100%;text-align:left;border-radius:18px;padding:13px 15px 14px;background:#fff;color:var(--ink);
         box-shadow:0 3px 10px rgba(60,110,95,.09);transition:transform .14s,box-shadow .14s}
.ty-card:active{transform:translateY(2px);box-shadow:0 1px 6px rgba(60,110,95,.1)}
.ty-ctop{display:flex;align-items:center;gap:8px}
.ty-ctop em{font-size:24px;line-height:1}
.ty-cname{font-size:15.5px;font-weight:1000;letter-spacing:-.4px}
.ty-lv{margin-left:auto;flex:none;padding:4px 10px;border-radius:999px;font-size:10.5px;font-weight:1000;
       background:rgba(30,140,116,.14);color:var(--mint-d);letter-spacing:-.2px}
.ty-lv.max{background:rgba(124,99,192,.16);color:var(--violet)}
.ty-grow{display:flex;align-items:center;gap:8px;margin-top:9px}
/* 숙련도 게이지 — 홈 카드와 rep 화면이 같은 문법을 쓴다 */
.ty-gauge{flex:1;height:12px;border-radius:8px;background:rgba(62,194,162,.18);overflow:hidden}
.ty-gauge i{display:block;height:100%;border-radius:8px;
            background:linear-gradient(90deg,#6DD6BB,#1E8C74);
            transition:width .7s cubic-bezier(.2,.9,.3,1)}
.ty-mval{flex:none;font-size:11px;font-weight:1000;color:var(--mint-d);min-width:44px;text-align:right}
.ty-cfoot{display:flex;align-items:center;gap:8px;margin-top:9px}
.ty-crate{font-size:11.5px;font-weight:800;color:var(--sub);letter-spacing:-.2px}
.ty-cgo{margin-left:auto;flex:none;min-height:38px;padding:0 15px;border-radius:13px;
        background:linear-gradient(140deg,#6DD6BB,#1E8C74);color:#fff;font-size:13px;font-weight:1000;
        box-shadow:0 4px 0 #17715E;display:flex;align-items:center;gap:5px;letter-spacing:-.3px}
.ty-card:active .ty-cgo{box-shadow:0 2px 0 #17715E}
.ty-sus{flex:none;padding:4px 9px;border-radius:999px;font-size:10px;font-weight:900;
        background:rgba(124,99,192,.14);color:var(--violet)}
/* 잠금 카드 = «티저». 회색으로 죽이되 무엇을 하면 열리는지 반드시 적는다 */
.ty-card.lock{background:#DCE6E1;box-shadow:none;color:#8FA69E}
.ty-card.lock:active{transform:none}
.ty-card.lock .ty-cname{color:#7C948B}
.ty-card.lock em{filter:grayscale(1);opacity:.55}
.ty-lockmsg{margin-top:8px;font-size:11.5px;font-weight:800;color:#7C948B;line-height:1.55}
/* 간식 사기 — 상점 톤(앰버)으로 «훈련과 다른 행동»임을 색으로 구분 */
.ty-buy{width:100%;margin-top:14px;min-height:50px;border-radius:16px;
        background:linear-gradient(140deg,#F0A968,#D9832B);color:#fff;font-size:14.5px;font-weight:1000;
        box-shadow:0 5px 0 #B2691E;display:flex;align-items:center;justify-content:center;gap:8px;
        letter-spacing:-.3px;transition:transform .14s,box-shadow .14s}
.ty-buy:active{transform:translateY(3px);box-shadow:0 2px 0 #B2691E}
.ty-buy em{font-size:19px;line-height:1}
.ty-note{margin-top:12px;font-size:11.5px;font-weight:700;color:var(--sub);text-align:center;line-height:1.6}

/* ── rep 화면 ── */
.ty-repbar{display:flex;align-items:center;gap:9px;padding:0 14px 6px;flex:none}
.ty-repbar .bar{flex:1;height:14px;border-radius:8px;background:rgba(62,194,162,.18);overflow:hidden}
.ty-repbar .bar i{display:block;height:100%;border-radius:8px;
                  background:linear-gradient(90deg,#6DD6BB,#1E8C74);transition:width .4s}
.ty-repn{flex:none;font-size:12px;font-weight:900;color:var(--sub);min-width:44px;text-align:right}
.ty-meta{display:flex;gap:7px;align-items:center;padding:0 14px;margin-bottom:4px;flex:none;flex-wrap:wrap}
.ty-chip{padding:6px 11px;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:-.2px}
.ty-chip.lv{background:rgba(30,140,116,.14);color:var(--mint-d)}
.ty-chip.rate{background:rgba(255,180,84,.18);color:var(--amber-d)}
.ty-chip.sus{background:rgba(124,99,192,.14);color:var(--violet)}
.ty-meta .ty-gauge{max-width:110px;height:10px}
/* 강아지 슬롯 — 화면이 좁아지면 «여기»가 먼저 줄어야 한다 */
.ty-dog{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
/* ★통합 세션 수정: 예전 강아지 뷰는 «캔버스 하나»였지만 지금 dog.js 는
   div(.mm-dog) 안에 몸통·목줄 SVG·표정 레이어를 겹쳐 놓는다.
   자손 셀렉터로 두면 이 규칙이 «목줄 SVG»의 폭까지 64vw 로 늘려
   목줄이 목에서 떨어져 엉덩이 쪽에 그려졌다. 직계 자식만 잡는다. */
.ty-dog>canvas,.ty-dog>svg,.ty-dog>img,.ty-dog>.mm-dog{width:min(260px,64vw);height:100%;max-height:34vh}
/* 1인칭 손 가이드 — «내가 지금 손으로 뭘 하는지»를 점선 카드로 분리해 보여준다 */
.ty-guide{margin:0 14px 8px;flex:none;display:flex;align-items:center;gap:11px;padding:11px 14px;
          border-radius:16px;background:rgba(255,255,255,.72);border:1.6px dashed var(--line)}
.ty-guide em{font-size:32px;line-height:1;flex:none}
.ty-guide .gt{flex:1;min-width:0}
.ty-guide b{display:block;font-size:13.5px;font-weight:1000;letter-spacing:-.35px;color:var(--mint-d)}
.ty-guide small{display:block;margin-top:2px;font-size:11.5px;font-weight:700;color:#5c7d74;line-height:1.55}
/* 제스처 입력면 — 브라우저 스크롤이 제스처를 먹지 않게 touch-action:none */
.ty-pad{position:relative;flex:none;margin:0 14px;height:132px;border-radius:20px;background:rgba(255,255,255,.66);
        border:1.6px solid var(--line);box-shadow:inset 0 2px 10px rgba(60,110,95,.06);
        touch-action:none;overscroll-behavior:contain;overflow:hidden;
        display:flex;align-items:center;justify-content:center}
.ty-padhint{font-size:12px;font-weight:800;color:var(--sub);letter-spacing:-.2px;text-align:center;padding:0 20px}
.ty-arrow{position:absolute;font-size:19px;line-height:1;color:#A9BDB5;opacity:.55;pointer-events:none;
          transition:opacity .2s,color .2s,transform .2s}
.ty-arrow.u{top:9px;left:50%;transform:translateX(-50%)}
.ty-arrow.d{bottom:9px;left:50%;transform:translateX(-50%)}
.ty-arrow.l{left:10px;top:50%;transform:translateY(-50%)}
.ty-arrow.r{right:10px;top:50%;transform:translateY(-50%)}
.ty-arrow.on{opacity:1;color:var(--mint-d)}
.ty-arrow.u.on{transform:translateX(-50%) translateY(-3px)}
.ty-arrow.d.on{transform:translateX(-50%) translateY(3px)}
.ty-arrow.l.on{transform:translateY(-50%) translateX(-3px)}
.ty-arrow.r.on{transform:translateY(-50%) translateX(3px)}
/* 스와이프 궤적 점 — 컨트롤러가 좌표만 style.left/top으로 꽂는다 */
.ty-trail{position:absolute;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;
          background:rgba(62,194,162,.5);pointer-events:none;animation:tyTrail .55s ease-out forwards}
@keyframes tyTrail{0%{opacity:.85;transform:scale(1)}100%{opacity:0;transform:scale(.35)}}

/* 홀드(기다려) 전용 원형 진행 링 — --p(0~100)만 바꾸면 채워진다 */
.ty-hold{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:94px;height:94px;
         border-radius:50%;display:flex;align-items:center;justify-content:center;
         background:conic-gradient(var(--mint) calc(var(--p,0) * 1%),rgba(62,194,162,.16) 0);
         transition:background .12s linear}
.ty-hold::after{content:'';position:absolute;inset:9px;border-radius:50%;background:#fff;
                box-shadow:inset 0 1px 6px rgba(60,110,95,.1)}
.ty-hold-lbl{position:relative;z-index:1;text-align:center;font-size:19px;font-weight:1000;
             color:var(--mint-d);letter-spacing:-.5px;line-height:1.1}
.ty-hold-lbl small{display:block;font-size:9.5px;font-weight:900;color:var(--sub);letter-spacing:0}
.ty-hold.done{background:conic-gradient(var(--mint) 100%,var(--mint) 0)}

/* ── 컨트롤 행: 마이크 홀드 + 간식 토글 ── */
.ty-ctrl{display:flex;gap:9px;align-items:stretch;padding:10px 14px calc(var(--sb,0px) + 12px);flex:none}
.ty-mic{flex:1;min-height:54px;border-radius:18px;background:linear-gradient(140deg,#6DD6BB,#1E8C74);
        color:#fff;font-size:14.5px;font-weight:1000;letter-spacing:-.35px;box-shadow:0 5px 0 #17715E;
        display:flex;align-items:center;justify-content:center;gap:8px;touch-action:none;
        transition:transform .14s,box-shadow .14s}
.ty-mic em{font-size:20px;line-height:1}
.ty-mic:active{transform:translateY(3px);box-shadow:0 2px 0 #17715E}
/* 청취 중 = 펄스. «말해도 된다»는 신호를 색이 아니라 «움직임»으로 준다 */
.ty-mic.on{background:linear-gradient(140deg,#FF9A8D,#E85A48);box-shadow:0 5px 0 #B4392A;
           animation:tyPulse 1.05s ease-in-out infinite}
@keyframes tyPulse{0%,100%{box-shadow:0 5px 0 #B4392A,0 0 0 0 rgba(255,122,107,.5)}
                   60%{box-shadow:0 5px 0 #B4392A,0 0 0 13px rgba(255,122,107,0)}}
.ty-treat{flex:none;min-width:88px;min-height:54px;border-radius:18px;background:#fff;color:#7A5A3C;
          font-size:12.5px;font-weight:1000;letter-spacing:-.3px;box-shadow:0 3px 10px rgba(60,110,95,.1);
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.ty-treat em{font-size:20px;line-height:1}
.ty-treat.on{background:rgba(255,180,84,.22);color:var(--amber-d);box-shadow:0 3px 0 rgba(217,131,43,.35)}
.ty-treat:disabled,.ty-treat.off{opacity:.42;box-shadow:none;cursor:default}

/* ── 톤 뱃지 3개: 말의 «길이·단호함·반복»을 즉시 되먹임 ── */
.ty-tone{display:flex;gap:6px;padding:0 14px 2px;flex:none}
.ty-tb{flex:1;padding:7px 6px;border-radius:12px;text-align:center;font-size:10.5px;font-weight:900;
       letter-spacing:-.2px;background:#F1F5F3;color:#A9BDB5;transition:background .2s,color .2s}
.ty-tb em{display:block;font-size:14px;line-height:1.2}
.ty-tb.on{background:rgba(62,194,162,.16);color:var(--mint-d)}
.ty-tb.off{background:rgba(255,122,107,.13);color:#C0523F}
.ty-tb.na{background:#F1F5F3;color:#B3C4BD;opacity:.75}

/* ── 칭찬 링: 1.2초 안에 칭찬해야 «타이밍»이 배워진다 ── */
.ty-praisewrap{position:relative;width:132px;height:132px;margin:8px auto 4px;flex:none}
.ty-praise{position:absolute;inset:9px;border-radius:50%;
           background:linear-gradient(140deg,#FFD27A,#F0A22C);color:#5A3D12;
           box-shadow:0 6px 0 #C97F16;display:flex;flex-direction:column;align-items:center;
           justify-content:center;gap:2px;font-size:14px;font-weight:1000;letter-spacing:-.4px;
           transition:transform .12s,box-shadow .12s}
.ty-praise em{font-size:34px;line-height:1}
.ty-praise:active{transform:translateY(3px);box-shadow:0 3px 0 #C97F16}
.ty-ring{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);pointer-events:none}
.ty-ring .tr{fill:none;stroke:rgba(62,194,162,.18);stroke-width:6}
.ty-ring .fg{fill:none;stroke:var(--mint-d);stroke-width:6;stroke-linecap:round;
             stroke-dasharray:283;stroke-dashoffset:0;animation:tyRing 1.2s linear forwards}
@keyframes tyRing{from{stroke-dashoffset:0}to{stroke-dashoffset:283}}

/* ── 숙련도 +n 팝업 / 성공 반짝임 ── */
.ty-pop{position:absolute;left:50%;top:46%;transform:translate(-50%,0);z-index:8;pointer-events:none;
        padding:6px 13px;border-radius:999px;background:rgba(30,140,116,.95);color:#fff;
        font-size:13.5px;font-weight:1000;letter-spacing:-.3px;box-shadow:0 6px 16px rgba(30,140,116,.3);
        animation:tyPop 1.1s cubic-bezier(.2,.9,.3,1) forwards}
@keyframes tyPop{0%{opacity:0;transform:translate(-50%,10px) scale(.8)}
                 22%{opacity:1;transform:translate(-50%,-4px) scale(1.06)}
                 100%{opacity:0;transform:translate(-50%,-52px) scale(1)}}
.ty-spark{position:absolute;inset:0;z-index:7;pointer-events:none;
          background:radial-gradient(46% 34% at 50% 44%,rgba(255,255,255,.85),rgba(255,235,190,.35) 45%,transparent 72%);
          animation:tySpark .72s ease-out forwards}
@keyframes tySpark{0%{opacity:0;transform:scale(.86)}30%{opacity:1}100%{opacity:0;transform:scale(1.12)}}

/* ── 리포트 ── */
.ty-report{padding:18px 16px calc(var(--sb,0px) + 22px);max-width:520px;margin:0 auto;width:100%}
.ty-remo{font-size:50px;text-align:center;line-height:1.1}
.ty-rtitle{margin-top:8px;font-size:22px;font-weight:1000;text-align:center;letter-spacing:-.6px}
.ty-rsub{margin-top:5px;font-size:13px;color:var(--sub);text-align:center;font-weight:700}
.ty-scrow{display:flex;gap:9px;margin-top:18px}
.ty-scb{flex:1;background:#fff;border-radius:16px;padding:13px 8px;text-align:center;
        box-shadow:0 3px 10px rgba(60,110,95,.1)}
.ty-scb b{display:block;font-size:22px;font-weight:1000;color:var(--mint-d);letter-spacing:-.5px}
.ty-scb small{display:block;font-size:10.5px;color:var(--sub);font-weight:800;margin-top:2px}
.ty-scb.warn b{color:var(--amber-d)}
/* 오늘의 목소리 — 성공/실패보다 «어떻게 말했나»가 다음 회차를 바꾼다 */
.ty-tonecard{margin-top:14px;border-radius:18px;padding:14px 15px;background:#fff;
             box-shadow:0 3px 10px rgba(60,110,95,.09)}
.ty-tonecard .th{display:flex;align-items:center;gap:8px}
.ty-tonecard .th em{font-size:22px;line-height:1}
.ty-tonecard .th b{font-size:14.5px;font-weight:1000;letter-spacing:-.4px}
.ty-tonecard .th i{margin-left:auto;font-style:normal;padding:4px 10px;border-radius:999px;
                   font-size:10.5px;font-weight:900;background:rgba(30,140,116,.13);color:var(--mint-d)}
.ty-tchk{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:12.5px;font-weight:800;
         color:#4a6d64;letter-spacing:-.2px}
.ty-tchk em{font-size:15px;line-height:1;flex:none}
.ty-tchk.no{color:#B3826A}
.ty-coach{margin-top:11px;padding:11px 13px;border-radius:14px;background:rgba(62,194,162,.11);
          font-size:12.5px;font-weight:800;color:#3d6a5f;line-height:1.65}
.ty-gainrow{display:flex;gap:9px;margin-top:12px}
.ty-gn{flex:1;border-radius:16px;padding:12px 8px;text-align:center}
.ty-gn.bond{background:rgba(255,122,107,.16)}
.ty-gn.treat{background:rgba(255,201,107,.24)}
.ty-gn.bone{background:rgba(139,106,74,.14)}
.ty-gn b{display:block;font-size:19px;font-weight:1000;letter-spacing:-.4px}
.ty-gn.bond b{color:#C0523F}.ty-gn.treat b{color:#C48606}.ty-gn.bone b{color:#7A5A3C}
.ty-gn small{display:block;font-size:10.5px;font-weight:800;color:#7b6a52;margin-top:1px}
.ty-cap{margin-top:12px;display:flex;gap:10px;align-items:center;padding:13px 14px;border-radius:16px;
        background:linear-gradient(135deg,rgba(255,180,84,.16),rgba(255,122,107,.1));
        border:1.5px dashed var(--amber)}
.ty-cap em{font-size:21px;line-height:1}
.ty-cap b{display:block;font-size:12.5px;font-weight:900;color:var(--amber-d)}
.ty-cap small{display:block;font-size:11.5px;color:#8a6a3a;font-weight:700;margin-top:2px}
.ty-rbtns{margin-top:18px;display:grid;gap:9px}
.ty-rbtns button{min-height:54px;border-radius:16px;font-size:15.5px;font-weight:1000;letter-spacing:-.4px}
.ty-again{background:linear-gradient(140deg,#6DD6BB,#1E8C74);color:#fff;box-shadow:0 5px 0 #17715E;
          transition:transform .14s,box-shadow .14s}
.ty-again:active{transform:translateY(3px);box-shadow:0 2px 0 #17715E}
.ty-rhome{background:#fff;color:#4a6d64;box-shadow:0 3px 10px rgba(60,110,95,.1)}

/* ── 시트 (기존 .sheet 문법 그대로, ty 프리픽스만) ── */
.ty-sheet{position:absolute;inset:0;z-index:60;display:none;align-items:flex-end;background:rgba(38,62,56,.34)}
.ty-sheet.on{display:flex}
.ty-sheetc{width:100%;border-radius:24px 24px 0 0;background:var(--cream);
           padding:20px 18px calc(var(--sb,0px) + 16px);animation:tyUp .3s cubic-bezier(.2,.9,.3,1);
           box-shadow:0 -12px 40px rgba(40,80,68,.2);max-height:88vh;overflow-y:auto}
@keyframes tyUp{from{transform:translateY(100%)}to{transform:none}}
.ty-shtop{display:flex;align-items:center;gap:10px}
.ty-shicon{font-size:30px;line-height:1}
.ty-shtitle{font-size:19px;font-weight:1000;letter-spacing:-.5px}
.ty-shtier{margin-left:auto;flex:none;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:900}
.ty-row{margin-top:11px;padding:12px 14px;border-radius:14px;background:#fff;
        box-shadow:0 2px 8px rgba(60,110,95,.07)}
.ty-row b{display:block;font-size:11px;font-weight:900;color:var(--mint-d);letter-spacing:.3px}
.ty-row p{margin-top:3px;font-size:13.5px;line-height:1.65}
.ty-row.todo{background:rgba(62,194,162,.11);box-shadow:none}
.ty-go{width:100%;min-height:54px;margin-top:15px;border-radius:16px;
       background:linear-gradient(140deg,#6DD6BB,#1E8C74);color:#fff;font-size:16px;font-weight:1000;
       letter-spacing:-.4px;box-shadow:0 5px 0 #17715E;transition:transform .14s,box-shadow .14s}
.ty-go:active{transform:translateY(3px);box-shadow:0 2px 0 #17715E}
.ty-go.ghost{background:#fff;color:#4a6d64;box-shadow:0 3px 10px rgba(60,110,95,.1);margin-top:9px}
.ty-go.ghost:active{transform:translateY(2px);box-shadow:0 1px 6px rgba(60,110,95,.12)}

/* ── 3택/2지선다 (기존 .opt 복제) ── */
.ty-opts{display:grid;gap:9px;margin-top:12px}
.ty-opt{width:100%;min-height:56px;border:2px solid var(--line);border-radius:16px;background:#fff;
        color:var(--ink);font-size:14.5px;font-weight:800;padding:10px 14px;text-align:left;
        display:flex;align-items:center;gap:10px;box-shadow:0 3px 0 var(--line);
        transition:transform .14s,border-color .2s,background .2s}
.ty-opt em{font-size:20px;line-height:1}
.ty-opt:active{transform:translateY(2px);box-shadow:0 1px 0 var(--line)}
.ty-opt.right{border-color:var(--mint);background:rgba(62,194,162,.1);box-shadow:0 3px 0 rgba(62,194,162,.35)}
.ty-opt.wrong{border-color:var(--coral);background:rgba(255,122,107,.1);box-shadow:0 3px 0 rgba(255,122,107,.35)}
.ty-opt.dim{opacity:.45}

/* ── 퀴즈 / 미학습 신호 ── */
.ty-q{padding:2px 2px 0}
.ty-qq{font-size:15.5px;font-weight:1000;letter-spacing:-.4px;text-align:center;padding:4px 8px 2px;line-height:1.55}
.ty-unlearn{margin-top:11px;padding:14px;border-radius:16px;background:rgba(255,255,255,.62);
            border:1.5px dashed var(--line);text-align:center}
.ty-unlearn em{font-size:30px;line-height:1;filter:grayscale(.6);opacity:.8}
.ty-unlearn b{display:block;margin-top:6px;font-size:14px;font-weight:1000;color:#8FA69E;letter-spacing:-.3px}
.ty-unlearn small{display:block;margin-top:3px;font-size:11.5px;font-weight:700;color:var(--sub)}
/* 견인 박스 = «지금은 못 하지만 어디서 배우는지»를 반드시 알려 준다 */
.ty-tow{display:flex;gap:10px;align-items:center;margin-top:11px;padding:13px 14px;border-radius:16px;
        background:linear-gradient(135deg,rgba(62,194,162,.16),rgba(255,180,84,.12));
        border:1.5px dashed var(--mint);text-align:left}
.ty-tow em{font-size:22px;line-height:1;flex:none}
.ty-tow .tt{flex:1;min-width:0}
.ty-tow b{display:block;font-size:13px;font-weight:900;color:var(--mint-d);letter-spacing:-.3px}
.ty-tow small{display:block;font-size:11.5px;color:#4d7a6e;font-weight:700;margin-top:2px;line-height:1.55}

/* ── 흔들기 폴백: 센서가 없으면 «연타»로 대체 ── */
.ty-tapper{margin:0 14px;padding:15px;border-radius:20px;background:#fff;
           box-shadow:0 3px 10px rgba(60,110,95,.09);text-align:center}
.ty-tapper > b{display:block;font-size:13.5px;font-weight:1000;letter-spacing:-.35px}
.ty-tapper > small{display:block;margin-top:2px;font-size:11.5px;font-weight:700;color:var(--sub)}
.ty-tapbtn{width:100%;margin-top:11px;min-height:64px;border-radius:18px;
           background:linear-gradient(140deg,#9E8AD8,#6B54AC);color:#fff;font-size:17px;font-weight:1000;
           letter-spacing:-.4px;box-shadow:0 5px 0 #574290;display:flex;align-items:center;
           justify-content:center;gap:9px;transition:transform .1s,box-shadow .1s}
.ty-tapbtn em{font-size:24px;line-height:1}
.ty-tapbtn:active{transform:translateY(3px);box-shadow:0 2px 0 #574290}
.ty-tapbar{height:14px;border-radius:8px;background:#E7EFEB;overflow:hidden;margin-top:11px;position:relative}
.ty-tapbar i{display:block;height:100%;border-radius:8px;
             background:linear-gradient(90deg,#B9A6EC,#6B54AC);transition:width .16s linear}
.ty-tapbar span{position:absolute;inset:0;text-align:center;font-size:9.5px;font-weight:900;
                color:#6F8A82;line-height:14px}

/* ── 레벨업 / 마스터 오버레이 ── */
.ty-fx{position:absolute;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
       background:rgba(38,62,56,.42);animation:tyFxBg .25s ease-out}
@keyframes tyFxBg{from{opacity:0}to{opacity:1}}
.ty-fxc{width:min(300px,82vw);border-radius:24px;padding:26px 22px;text-align:center;background:var(--cream);
        box-shadow:0 18px 46px rgba(30,60,50,.3);animation:tyFx .55s cubic-bezier(.2,1.35,.4,1)}
@keyframes tyFx{0%{opacity:0;transform:scale(.72) translateY(18px)}
                60%{opacity:1;transform:scale(1.04) translateY(0)}
                100%{opacity:1;transform:scale(1)}}
.ty-fxc em{display:block;font-size:56px;line-height:1.1}
.ty-fxc b{display:block;margin-top:9px;font-size:21px;font-weight:1000;letter-spacing:-.6px;color:var(--mint-d)}
.ty-fxc small{display:block;margin-top:5px;font-size:12.5px;font-weight:700;color:#4d7a6e;line-height:1.65}

/* ── 작은 폰(≤640px 높이): 강아지 슬롯과 패드부터 줄인다 ── */
@media (max-height:640px){
  .ty-dog{flex:1 1 0;min-height:0}
  .ty-dog>canvas,.ty-dog>svg,.ty-dog>img,.ty-dog>.mm-dog{max-height:26vh}
  .ty-pad{height:104px}
  .ty-guide{padding:9px 12px}
  .ty-guide em{font-size:26px}
  .ty-praisewrap{width:112px;height:112px}
  .ty-praise em{font-size:28px}
  .ty-hold{width:80px;height:80px}
}

/* ── 접근성: 애니메이션을 원치 않는 사용자에게는 «즉시» 보여준다 ── */
@media (prefers-reduced-motion: reduce){
  .ty *,.ty-sheet *,.ty-fx *{animation-duration:.001ms!important;animation-iteration-count:1!important;
                             transition-duration:.001ms!important;scroll-behavior:auto!important}
  .ty-ring .fg{animation:none;stroke-dashoffset:0}
  .ty-mic.on{animation:none;outline:3px solid rgba(255,122,107,.55);outline-offset:2px}
  .ty-pop{animation:none;transform:translate(-50%,-30px)}
}
`;

/* HTML 이스케이프. 강아지 이름·코칭 문구 등 «사람이 넣은 글자»가
   그대로 문자열 템플릿에 들어가므로, 뷰 안에서 반드시 한 번 걸러 준다.
   따옴표까지 막아야 속성값(data-*, style)이 깨지지 않는다. */
export function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* 게이지 폭 전용 정규화. NaN·음수·100 초과가 들어와도 바가 삐져나가지 않게
   뷰가 마지막 방어선을 친다(컨트롤러 계산 실수는 화면에서 티가 안 나야 한다). */
export function tyPct(v){
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

/* 숫자 안전 변환(정수). 표시용이므로 실패하면 0. */
export function tyNum(v){
  const n = Number(v);
  return isFinite(n) ? Math.round(n) : 0;
}

/* 훈련장 홈: 명령 카드 목록.
   잠금 카드를 «숨기지 않고» 회색 티저로 남기는 이유 —
   앞으로 뭘 배우게 되는지 보여야 오늘 한 번 더 하게 된다.
   해금 카드는 항상 «Lv·게이지·수치 → 성공률 → 시작 ⚡1» 순서로 읽힌다. */
export function tplHome(d){
  d = d || {};
  const cards = Array.isArray(d.cards) ? d.cards : [];
  const body = cards.map(c => {
    const id = esc(c && c.id);
    if (c && c.locked){
      return '<button class="ty-card lock" data-act="locked" data-id="' + id + '">'
        + '<div class="ty-ctop"><em>🔒</em>'
        + '<span class="ty-cname">' + esc(c.name) + '</span></div>'
        + '<div class="ty-lockmsg">' + esc(c.lockText || '') + '</div>'
        + '</button>';
    }
    const pct = tyPct(c && c.pct);
    const sus = (c && c.sustain && d.susLabel)
      ? '<span class="ty-sus">⏳ ' + esc(d.susLabel) + '</span>' : '';
    const lvMax = (c && c.lv >= 5) ? ' max' : '';
    return '<button class="ty-card" data-act="start" data-id="' + id + '">'
      + '<div class="ty-ctop"><em>🐾</em>'
      + '<span class="ty-cname">' + esc(c.name) + '</span>'
      + sus
      + '<span class="ty-lv' + lvMax + '">Lv' + tyNum(c.lv) + '</span></div>'
      + '<div class="ty-grow">'
      + '<span class="ty-gauge"><i style="width:' + pct + '%"></i></span>'
      + '<span class="ty-mval">' + esc(c.m) + '</span></div>'
      + '<div class="ty-cfoot">'
      + '<span class="ty-crate">' + esc(d.rateLabel || '') + ' ' + tyNum(c.rate) + '%</span>'
      + '<span class="ty-cgo">' + esc(d.goLabel || '') + ' <em>⚡</em>1</span></div>'
      + '</button>';
  }).join('');

  return '<div class="ty-head">'
    + '<button class="ty-back" data-act="back" aria-label="뒤로"><em>←</em></button>'
    + '<div class="ty-title">' + esc(d.title || '') + '<small>' + esc(d.sub || '') + '</small></div>'
    + '<button class="ty-treats" data-act="treats" aria-label="간식"><em>🍖</em>' + tyNum(d.treats) + '</button>'
    + '</div>'
    + '<div class="ty-dog home" data-slot="dog"></div>'
    + '<div class="ty-sc"><div class="ty-wrap">'
    + (d.bubble ? '<div class="ty-bubble">' + esc(d.bubble) + '</div>' : '')
    + '<div class="ty-cards">' + body + '</div>'
    + '<button class="ty-buy" data-act="buy"><em>🍖</em>' + esc(d.buyLabel || '') + '</button>'
    + (d.note ? '<p class="ty-note">' + esc(d.note) + '</p>' : '')
    + '</div></div>';
}

/* rep(1회차) 화면.
   위→아래 시선 순서를 고정했다: 진행(몇 번째) → 실력(Lv·성공률) →
   강아지 → 내 손이 할 일 → 손을 놓는 자리 → 목소리 되먹임 → 입력 버튼.
   손 가이드를 강아지 «바로 아래»에 둔 건, 1인칭 수신호를 보면서
   개를 볼 수 있어야 하기 때문이다. */
export function tplRep(d){
  d = d || {};
  const total = Math.max(1, tyNum(d.total) || 8);
  const rep = Math.max(0, Math.min(total, tyNum(d.rep)));
  const barPct = tyPct((rep / total) * 100);
  const g = d.guide || {};
  const hold = d.sustain
    ? '<div class="ty-hold" style="--p:0"><div class="ty-hold-lbl">' + tyNum(d.holdSec)
      + '<small>초</small></div></div>'
    : '';
  const padInner = d.sustain
    ? hold
    : '<div class="ty-padhint">' + esc(d.padHint || '') + '</div>';
  const mic = d.micShown
    ? '<button class="ty-mic" data-act="mic"><em>🎙️</em>' + esc(d.micLabel || '') + '</button>'
    : '<button class="ty-mic" data-act="mic-off"><em>🔇</em>' + esc(d.micOffLabel || '') + '</button>';
  const treatCls = 'ty-treat' + (d.treatOn ? ' on' : '') + (d.treatDisabled ? ' off' : '');
  const treatAttr = d.treatDisabled ? ' disabled' : '';

  return '<div class="ty-head">'
    + '<button class="ty-back" data-act="quit" aria-label="훈련 그만두기"><em>←</em></button>'
    + '<div class="ty-title">' + esc(d.cmdName) + '<small>' + esc(d.sub || '') + '</small></div>'
    + '<span class="ty-treats"><em>🍖</em>' + tyNum(d.treats) + '</span>'
    + '</div>'
    /* FTUE 각본 중에는 «몇 번째»가 의미 없다 — 진행 바를 숨겨 각본에 집중시킨다 */
    + (d.hideBar ? '' : '<div class="ty-repbar">'
        + '<span class="bar"><i style="width:' + barPct + '%"></i></span>'
        + '<span class="ty-repn">' + esc(d.repUnit || '') + ' ' + rep + '/' + total + '</span>'
        + '</div>')
    + '<div class="ty-meta">'
    + '<span class="ty-chip lv">Lv' + tyNum(d.lv) + '</span>'
    + '<span class="ty-gauge"><i style="width:' + tyPct(d.pct) + '%"></i></span>'
    + '<span class="ty-mval">' + esc(d.m) + '</span>'
    + '<span class="ty-chip rate">' + esc(d.rateLabel || '') + ' ' + tyNum(d.rate) + '%</span>'
    + (d.sustain ? '<span class="ty-chip sus">⏳ ' + tyNum(d.holdSec) + esc(d.holdUnit || '') + '</span>' : '')
    + '</div>'
    + '<div class="ty-dog" data-slot="dog"></div>'
    + (g.show
        ? '<div class="ty-guide"><em>' + esc(g.emoji || '🤚') + '</em><span class="gt">'
          + '<b>' + esc(g.sign || '수신호') + '</b>'
          + '<small>' + esc(g.text || '') + '</small></span></div>'
        : '')
    + '<div class="ty-pad" data-act="pad">'
    + '<span class="ty-arrow u"><em>↑</em></span>'
    + '<span class="ty-arrow d"><em>↓</em></span>'
    + '<span class="ty-arrow l"><em>←</em></span>'
    + '<span class="ty-arrow r"><em>→</em></span>'
    + padInner
    + '</div>'
    + '<div class="ty-tone" data-slot="tone">' + tplToneBadges(null, d.toneLabels) + '</div>'
    + '<div class="ty-ctrl">'
    + mic
    + '<button class="' + treatCls + '" data-act="treat"' + treatAttr + '>'
    + '<em>🍖</em>' + esc(d.treatOn ? (d.treatOnLabel || '') : (d.treatOffLabel || '')) + '</button>'
    + '</div>';
}

/* 톤 뱃지 3개.
   «틀렸다»가 아니라 «이렇게 말하면 개가 알아듣는다»를 가르치는 칸이라
   미측정(null)과 측정불가(na)를 실패(off)와 색으로 구분한다. */
export function tplToneBadges(t, L){
  const lb = L || { len:'', firm:'', once:'' };
  const items = [
    { em: '📏', label: lb.len,  ok: t && t !== 'na' ? !!t.len : null },
    { em: '💪', label: lb.firm, ok: t && t !== 'na' ? !!t.firm : null },
    { em: '☝️', label: lb.once, ok: t && t !== 'na' ? !!t.once : null }
  ];
  return items.map(it => {
    let cls = 'ty-tb';
    if (t === 'na') cls += ' na';
    else if (t) cls += it.ok ? ' on' : ' off';
    return '<span class="' + cls + '"><em>' + it.em + '</em>' + esc(it.label) + '</span>';
  }).join('');
}

/* 칭찬 링.
   개가 맞게 행동한 «1.2초 안»에 칭찬해야 연결이 생긴다.
   그래서 카운트다운을 숫자가 아니라 «줄어드는 링»으로 보여 준다 —
   숫자를 읽는 동안 시간이 지나 버리기 때문. */
export function tplPraise(label){
  return '<div class="ty-praisewrap">'
    + '<svg class="ty-ring" viewBox="0 0 100 100" aria-hidden="true">'
    + '<circle class="tr" cx="50" cy="50" r="45"></circle>'
    + '<circle class="fg" cx="50" cy="50" r="45"></circle>'
    + '</svg>'
    + '<button class="ty-praise" data-act="praise"><em>👏</em>' + esc(label || '') + '</button>'
    + '</div>';
}

/* 세션 리포트.
   «성공 몇 번»보다 «오늘 목소리가 어땠나»를 더 크게 다룬다.
   숙련도가 상한에 걸렸으면 그 이유(환경을 바꿔야 한다)를 반드시 말해 준다. */
export function tplReport(d){
  d = d || {};
  const total = Math.max(1, tyNum(d.total) || 8);
  const succ = Math.max(0, Math.min(total, tyNum(d.succ)));
  const rate = Math.round((succ / total) * 100);
  const emo = rate >= 75 ? '🎉' : rate >= 40 ? '🐕' : '🌱';
  const L = d.L || {};

  let tone = '';
  if (d.tone){
    const t = d.tone;
    const line = (ok, txt) => '<div class="ty-tchk' + (ok ? '' : ' no') + '">'
      + '<em>' + (ok ? '✅' : '⬜') + '</em>' + esc(txt) + '</div>';
    tone = '<div class="ty-tonecard">'
      + '<div class="th"><em>🗣️</em><b>' + esc(L.voiceCard || '') + '</b><i>' + tyNum(t.n) + esc(L.times || '') + '</i></div>'
      + line(t.lenOk, L.lenLine || '')
      + line(t.firmOk, L.firmLine || '')
      + line(t.onceOk, L.onceLine || '')
      + (t.coach ? '<div class="ty-coach">' + esc(t.coach) + '</div>' : '')
      + '</div>';
  }

  return '<div class="ty-sc"><div class="ty-report">'
    + '<div class="ty-remo"><em>' + emo + '</em></div>'
    + '<div class="ty-rtitle">' + esc(L.title || '') + '</div>'
    + '<div class="ty-rsub">' + esc(d.cmdName) + ' · ' + esc(d.subLine || '') + '</div>'
    + '<div class="ty-scrow">'
    + '<div class="ty-scb"><b>' + succ + '/' + total + '</b><small>' + esc(L.succ || '') + '</small></div>'
    + '<div class="ty-scb' + (rate < 40 ? ' warn' : '') + '"><b>' + rate + '%</b><small>' + esc(L.rate || '') + '</small></div>'
    + '<div class="ty-scb"><b>Lv' + tyNum(d.lv) + '</b><small>' + esc(L.gain || '') + ' ' + esc(d.m) + '</small></div>'
    + '</div>'
    + '<div class="ty-grow" style="margin-top:12px">'
    + '<span class="ty-gauge"><i style="width:' + tyPct(d.pct) + '%"></i></span>'
    + '<span class="ty-mval">+' + tyNum(d.gain) + '</span></div>'
    + tone
    + '<div class="ty-gainrow">'
    + '<div class="ty-gn bond"><b>+' + tyNum(d.bond) + '</b><small>💗 ' + esc(L.bond || '') + '</small></div>'
    + '<div class="ty-gn treat"><b>-' + tyNum(d.treatsUsed) + '</b><small>🍖 ' + esc(L.treat || '') + '</small></div>'
    + '<div class="ty-gn bone"><b>+' + tyNum(d.bones) + '</b><small>🦴 ' + esc(L.bone || '') + '</small></div>'
    + '</div>'
    + (d.capped
        ? '<div class="ty-cap"><em>🚧</em><span><b>' + esc(L.cappedTitle || '') + '</b>'
          + '<small>' + esc(L.cappedNote || '') + '</small></span></div>'
        : '')
    + '<div class="ty-rbtns">'
    + (d.canAgain ? '<button class="ty-again" data-act="again">' + esc(L.again || '') + '</button>' : '')
    + '<button class="ty-rhome" data-act="home">' + esc(L.home || '') + '</button>'
    + '</div>'
    + '</div></div>';
}

/* 시트 «내부» HTML만 만든다(껍데기 .ty-sheet/.ty-sheetc는 컨트롤러 소유).
   기존 피드백 시트와 동일한 리듬: 아이콘·제목·티어 → 설명 row들 →
   할 일(todo) → 선택지 → 버튼. 사람이 읽는 순서를 바꾸지 않았다. */
export function tplSheet(d){
  d = d || {};
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const opts = Array.isArray(d.opts) ? d.opts : null;
  const buttons = Array.isArray(d.buttons) ? d.buttons : [];
  const tier = d.tier
    ? '<span class="ty-shtier" style="background:' + esc(d.tier.color || 'rgba(62,194,162,.16)')
      + ';color:#2C3F3A">' + esc(d.tier.label) + '</span>'
    : '';
  return '<div class="ty-shtop">'
    + '<span class="ty-shicon"><em>' + esc(d.icon || '🐕') + '</em></span>'
    + '<span class="ty-shtitle">' + esc(d.title) + '</span>' + tier
    + '</div>'
    + rows.map(r => '<div class="ty-row' + (r && r.todo ? ' todo' : '') + '">'
        + '<b>' + esc(r && r.b) + '</b><p>' + esc(r && r.p) + '</p></div>').join('')
    + (opts
        ? '<div class="ty-opts">' + opts.map(o => '<button class="ty-opt" data-act="opt" data-key="'
            + esc(o && o.key) + '"><em>' + esc((o && o.emoji) || '•') + '</em>'
            + esc(o && o.label) + '</button>').join('') + '</div>'
        : '')
    + buttons.map(b => '<button class="ty-go' + (b && b.ghost ? ' ghost' : '') + '" data-act="'
        + esc(b && b.key) + '">' + esc(b && b.label) + '</button>').join('');
}

/* 거부 신호 퀴즈.
   개가 «싫다»고 말했을 때 사람이 뭘 해야 하는지 고르게 한다.
   훈련을 멈추는 선택지가 항상 «정답 후보»에 있어야 하므로
   선택지는 컨트롤러가 통째로 넘겨준다(뷰가 정답을 모른다). */
export function tplQuiz(d){
  d = d || {};
  const opts = Array.isArray(d.opts) ? d.opts : [];
  return '<div class="ty-q">'
    + '<div class="ty-qq">' + esc(d.question) + '</div>'
    + '<div class="ty-opts">'
    + opts.map(o => '<button class="ty-opt" data-act="opt" data-key="' + esc(o && o.key) + '">'
        + '<em>' + esc((o && o.emoji) || '•') + '</em>' + esc(o && o.label) + '</button>').join('')
    + '</div></div>';
}

/* 미학습 신호.
   «몰라도 괜찮다»로 끝내면 안 된다. 어디 가면 배울 수 있는지
   (산책길 유닛2) 견인 박스로 길을 알려 주고 바로 갈 수 있게 한다. */
export function tplUnlearned(d){
  d = d || {};
  return '<div class="ty-unlearn">'
    + '<em>' + esc(d.emoji || '❔') + '</em>'
    + '<b>' + esc(d.label || '') + '</b>'
    + '<small>' + esc(d.sub || '') + '</small>'
    + '</div>'
    + '<button class="ty-tow" data-act="goto-unit2"><em>🐾</em><span class="tt">'
    + '<b>' + esc(d.towTitle || '') + '</b>'
    + '<small>' + esc(d.towText || '') + '</small>'
    + '</span></button>';
}

/* 흔들기 폴백.
   가속도 센서 권한이 없거나 데스크톱이면 «흔들기»가 아예 불가능하다.
   같은 목표(에너지를 쏟아낸다)를 연타로 대체해, 기기 때문에
   훈련이 막히는 일이 없게 한다. */
export function tplTapper(d){
  d = d || {};
  const need = Math.max(1, tyNum(d.need) || 10);
  const got = Math.max(0, Math.min(need, tyNum(d.got)));
  return '<div class="ty-tapper">'
    + '<b>' + esc(d.title || '') + '</b>'
    + '<small>' + esc(d.sub || '') + '</small>'
    + '<button class="ty-tapbtn" data-act="tap"><em>👋</em>' + esc(d.btn || '') + '</button>'
    + '<div class="ty-tapbar"><i style="width:' + tyPct((got / need) * 100) + '%"></i>'
    + '<span>' + got + ' / ' + need + '</span></div>'
    + '</div>';
}

/* 레벨업·마스터 오버레이.
   축하는 짧고 크게. 아무 데나 눌러도 닫히도록 배경에도 data-act를 준다
   (기존 앱과 마찬가지로 confirm/alert은 쓰지 않는다). */
export function tplFx(d){
  d = d || {};
  return '<div class="ty-fx" data-act="fx-close">'
    + '<div class="ty-fxc">'
    + '<em>' + esc(d.emoji || '🎉') + '</em>'
    + '<b>' + esc(d.title || '') + '</b>'
    + '<small>' + esc(d.sub || '') + '</small>'
    + '</div></div>';
}

/* ═══ §3 컨트롤러 ═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   §3 컨트롤러 — 훈련장 상태기계
   ★CONTRACTS §4 시그니처: createTrainingYard(ctx) → { open, openFtue, dispose }
   ★DOM 접근은 전부 이 안에서만 일어난다 (모듈 최상위는 Node 에서도 안전해야 한다).
   ★confirm()/alert() 금지 — 모든 확인은 하단 시트로 한다 (MASTER §3-4).
   ═══════════════════════════════════════════════════════════════════════════ */

/* 표정 pose 어댑터. dog.js 의 play(pose, ex) 는 pose(t,ex) → {face} 를 기대한다.
   'sitPose'/'downPose' 는 아직 아틀라스에 없다 — dog.js 확장은 통합 세션 몫이고,
   현재 dog.js 는 모르는 키를 relaxed 로 떨어뜨리므로 안전하게 실패한다. */
const POSE = f => (t, ex) => ({ face: f, ex: ex == null ? 1 : ex });

/* 거부 시 뽑는 카밍 시그널 풀 — v2 §4-D 확률 그대로 */
const CALMING = [
  { id: 'lipLick',  name: '입술 핥기',  emoji: '👅', p: 40 },
  { id: 'lookAway', name: '시선 돌리기', emoji: '↔️', p: 30 },
  { id: 'yawn',     name: '하품',       emoji: '🥱', p: 20 },
  { id: 'earsBack', name: '귀 뒤로',    emoji: '📉', p: 10 },
];

const SHAKE_SEC = 5, TAP_NEED = 30, GAUGE_MAX = 6;

/* 으르렁·낑낑 — CONTRACTS §4 «growl/whine 신디는 A가 tone()으로 정의해 export».
   호출측(통합 세션)이 index.html 의 tone() 을 넘겨 주면 snd 에 얹어 쓴다. */
export function extraSounds(tone) {
  const t = typeof tone === 'function' ? tone : function () {};
  return {
    /* 낮은 톱니파 0.4초 — 경고는 «크게»가 아니라 «낮게» 들려야 한다 */
    growl() { t(90, 0, 0.4, 'sawtooth', 0.06); t(78, 0.06, 0.34, 'sawtooth', 0.05); },
    /* 높은 사인 두 번 — 조르는 소리 */
    whine() { t(880, 0, 0.14, 'sine', 0.06); t(990, 0.16, 0.18, 'sine', 0.06); },
  };
}

export function createTrainingYard(ctx) {
  const c = ctx || {};
  const el = c.el;
  if (!el) throw new Error('createTrainingYard: 컨테이너(ctx.el)가 없습니다');

  const G = c.G || {};
  const save = c.save || function () {};
  const track = c.track || function () {};
  const J = c.J || ((s, a, b) => s + b);
  const content = c.content || {};
  const COMMANDS = content.COMMANDS || {};
  const BREEDS = content.BREEDS || {};
  const COPY = content.TRAIN_COPY || {};
  const UI = COPY.ui || {};
  const dogView = c.dogView || null;
  /* ★강아지 뷰는 «자기 컨테이너»에 붙어서 온다. 훈련장은 화면을 통째로 갈아끼우므로
     그 컨테이너를 매 렌더마다 현재 화면의 슬롯으로 옮겨 심는다(뷰를 다시 만들지 않는다).
     ctx.dogEl 이 없으면 dogView.el 을 쓰고, 둘 다 없으면 조용히 건너뛴다. */
  const dogEl = c.dogEl || (dogView && dogView.el) || null;
  const voice = c.voice || null;
  const snd = c.snd || {};
  const rng = typeof c.rng === 'function' ? c.rng : Math.random;
  const goHome = typeof c.goHome === 'function' ? c.goHome : function () {};
  /* ★통합 세션 추가: 산책길 견인 전용 출구.
     A 는 «산책길 특정 노드로 보내려면 통합 세션에서 핸들러를 바꾸라»고 인수인계했다.
     goPath 가 없으면 예전대로 goHome 으로 떨어진다(단독 데모 호환). */
  const goPath = typeof c.goPath === 'function' ? c.goPath : goHome;

  /* ── G.tr 기본값 보정 ─────────────────────────────────────────────────
     통합 세션이 이행 코드를 쓰기 전에도 단독으로 돌아야 한다(스텁 구동 조건). */
  if (!G.tr) G.tr = {};
  const tr = G.tr;
  if (!tr.cmds) tr.cmds = {};
  for (const id in COMMANDS) if (!tr.cmds[id]) tr.cmds[id] = { m: 0, lv: 0, tries: 0, succ: 0, masterHits: 0 };
  if (typeof tr.treats !== 'number') tr.treats = 0;
  if (typeof tr.mood !== 'number') tr.mood = 0;
  if (typeof tr.gauge !== 'number') tr.gauge = 0;
  if (!tr.mic) tr.mic = 'unknown';
  if (!tr.tone) tr.tone = { n: 0, len: 0, firm: 0, once: 0 };
  if (!tr.todayGain) tr.todayGain = {};
  if (typeof tr.day !== 'string') tr.day = '';
  if (typeof tr.ftue !== 'number') tr.ftue = 0;
  if (!tr.breed) tr.breed = 'chi';
  if (!G.q) G.q = {};
  if (typeof G.q.reps !== 'number') G.q.reps = 0;
  if (typeof G.name !== 'string' || !G.name) G.name = '멍이';
  if (typeof G.bond !== 'number') G.bond = 0;
  if (typeof G.bones !== 'number') G.bones = 0;

  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  ensureDay(tr, todayStr());

  /* ── 카피 치환 ────────────────────────────────────────────────────────
     이름 뒤 조사는 절대 하드코딩하지 않는다 (MASTER §3-10). */
  function T(s, v) {
    if (s == null) return '';
    const nm = G.name;
    let out = String(s);
    out = out.replace(/\{name(은는|이가|을를|아야|와과)?\}/g, (_, p) =>
      !p ? nm
        : p === '은는' ? J(nm, '은', '는')
        : p === '이가' ? J(nm, '이', '가')
        : p === '을를' ? J(nm, '을', '를')
        : p === '아야' ? J(nm, '아', '야')
        : J(nm, '과', '와'));
    /* {cmd을를} — «손»를 같은 비문을 막는다. 명령 이름에 J() 를 따로 건다 */
    out = out.replace(/\{cmd을를\}/g, () => J(String((v && v.cmd) || ''), '을', '를').slice(String((v && v.cmd) || '').length));
    out = out.replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null) ? String(v[k]) : m);
    return out;
  }

  /* ── DOM 뼈대 ─────────────────────────────────────────────────────────
     시트·오버레이 껍데기는 컨트롤러 소유. 뷰는 «내부 HTML»만 만든다. */
  let cssNode = null;
  function injectCss() {
    if (document.getElementById('ty-css')) return;
    cssNode = document.createElement('style');
    cssNode.id = 'ty-css';
    cssNode.textContent = TRAIN_CSS;
    document.head.appendChild(cssNode);
  }
  injectCss();
  const root = document.createElement('div');
  root.className = 'ty';
  root.innerHTML = '<div class="ty-body"></div>'
    + '<div class="ty-sheet" data-slot="sheet"><div class="ty-sheetc"></div></div>'
    + '<div data-slot="fx"></div>';
  el.appendChild(root);
  const body = root.querySelector('.ty-body');
  const sheet = root.querySelector('[data-slot="sheet"]');
  const sheetC = sheet.querySelector('.ty-sheetc');
  const fxSlot = root.querySelector('[data-slot="fx"]');

  /* ── 세션 상태 ────────────────────────────────────────────────────────── */
  let S = null;              // 진행 중 세션 (없으면 null)
  let sheetHandler = null;   // 현재 시트의 data-act 처리기
  let timers = [];
  let disposed = false;
  const later = (fn, ms) => { const t = setTimeout(() => { if (!disposed) fn(); }, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function newSession(cmdId, isFtue) {
    return {
      cmd: cmdId, ftue: !!isFtue,
      rep: 0, total: isFtue ? 1 : REPS_PER_SESSION,
      succ: 0, gain: 0, treatsUsed: 0, bond: 0,
      failStreak: 0, afterCorrectSignal: false, forced: false,
      treatOn: false, walkBoost: 0, capped: false,
      tone: { n: 0, len: 0, firm: 0, once: 0 },
      exitGuard: false, busy: false, phase: 'input',
    };
  }

  /* ── 작은 도구 ────────────────────────────────────────────────────────── */
  const cmdOf = id => COMMANDS[id] || {};
  const breed = () => BREEDS[tr.breed] || { B: 35, mult: 1, name: '' };
  const stateOf = id => tr.cmds[id] || (tr.cmds[id] = { m: 0, lv: 0, tries: 0, succ: 0, masterHits: 0 });
  const pick = arr => arr[Math.floor(rng() * arr.length) % arr.length];

  function pose(face, ex) { if (dogView && dogView.play) dogView.play(POSE(face), ex == null ? 1 : ex); }
  function play(name) { const f = snd && snd[name]; if (typeof f === 'function') { try { f(); } catch (e) {} } }
  function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

  /* 토스트도 confirm 금지 원칙의 일부 — 흐름을 막지 않는 안내는 전부 이걸로 */
  let toastT = 0;
  function toast(msg) {
    let t = root.querySelector('.ty-toast');
    if (!t) { t = document.createElement('div'); t.className = 'ty-toast'; root.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }

  /* ── 성공률 입력 조립 ─────────────────────────────────────────────────── */
  function rateInput(extra) {
    const id = S.cmd, cmd = cmdOf(id), st = stateOf(id), b = breed();
    return Object.assign({
      B: b.B, D: cmd.D, m: st.m,
      tone: null, gestureQuality: null,
      breed: tr.breed, treatOn: S.treatOn,
      bond: G.bond, mood: tr.mood, gauge: tr.gauge,
      walkBoost: S.walkBoost,
      afterCorrectSignal: S.afterCorrectSignal,
      forced: S.forced,
      failStreak: S.failStreak,
      sustain: !!cmd.sustain, holdMs: 0,
      breedMult: b.mult,
    }, extra || {});
  }
  const shownRate = () => Math.round(successRate(rateInput({
    tone: null, gestureQuality: 'ok',
  })).rate);

  /* ══════════════════════════════════════════════════════════════════════
     화면 1 — 훈련장 홈
     ══════════════════════════════════════════════════════════════════════ */
  function renderHome() {
    S = null;
    const un = unlockedOf(tr, COMMANDS);
    const b = breed();
    const cards = Object.keys(COMMANDS).map(id => {
      const cmd = COMMANDS[id], st = stateOf(id), band = lvBand(st.m);
      if (!un[id]) {
        const u = cmd.unlock || [];
        const txt = u[0] === 'avg'
          ? T(COPY.lock && COPY.lock.byAvg, { lv: u[1] })
          : T(COPY.lock && COPY.lock.byCmd, { cmd: (COMMANDS[u[0]] || {}).name, lv: u[1] });
        return { id, name: cmd.name, locked: true, lockText: txt };
      }
      const rate = Math.round(successRate({
        B: b.B, D: cmd.D, m: st.m, tone: null, gestureQuality: 'ok',
        breed: tr.breed, treatOn: false, bond: G.bond, mood: tr.mood, gauge: tr.gauge,
        walkBoost: 0, afterCorrectSignal: false, forced: false,
      }).rate);
      return { id, name: cmd.name, lv: band.lv, m: st.m, pct: band.pct, rate,
               locked: false, sustain: !!cmd.sustain };
    });

    const anyTried = Object.keys(tr.cmds).some(k => (tr.cmds[k].tries || 0) > 0);
    body.innerHTML = tplHome({
      title: (COPY.home && COPY.home.title) || '',
      sub: T(UI.homeSub),
      treats: tr.treats,
      bubble: T(anyTried ? (COPY.home && COPY.home.bubble) : (COPY.home && COPY.home.bubbleFirst)),
      cards,
      rateLabel: UI.rateLabel, goLabel: UI.goLabel, susLabel: UI.susLabel,
      buyLabel: (COPY.home && COPY.home.buyTreat) || '',
      note: UI.homeNote,
    });
    attachDog();
    pose('curious', 0.7);
  }

  function attachDog() {
    const slot = root.querySelector('[data-slot="dog"]');
    if (!slot || !dogEl) return;
    if (dogEl.parentNode !== slot) slot.appendChild(dogEl);
    if (dogView && dogView.refit) { try { dogView.refit(); } catch (e) {} }
  }

  /* ══════════════════════════════════════════════════════════════════════
     화면 2 — rep 루프
     ══════════════════════════════════════════════════════════════════════ */
  function startSession(cmdId, isFtue) {
    const un = unlockedOf(tr, COMMANDS);
    if (!isFtue && !un[cmdId]) { toast(lockLabel(cmdId, COMMANDS, tr)); return; }
    if (!isFtue && !spendEnergy()) { openEnergySheet(); return; }
    S = newSession(cmdId, isFtue);
    if (!isFtue) S.total = REPS_PER_SESSION;
    track('train_start', { cmd: cmdId });
    renderRep();
    nextRep();
  }

  function spendEnergy() {
    if (typeof c.enSpend === 'function') return !!c.enSpend();
    if (typeof G.en !== 'number') return true;          // 에너지 시스템이 없는 단독 데모
    if (G.en <= 0) return false;
    G.en--; save(); return true;
  }

  function renderRep() {
    const id = S.cmd, cmd = cmdOf(id), st = stateOf(id), band = lvBand(st.m);
    /* 가이드 노출 규칙 (v2 §4-B): Lv0~1 항상 · Lv2 첫 rep만 · Lv3+ 숨김(수신호 전환) */
    const showGuide = band.lv <= 1 || (band.lv === 2 && S.rep <= 1);
    const micShown = !!(voice && voice.supported && voice.supported.asr && tr.mic !== 'denied');
    body.innerHTML = tplRep({
      cmdName: cmd.name, sub: UI.repSub,
      rep: S.rep, total: S.total, treats: tr.treats, hideBar: !!S.ftue, repUnit: UI.repUnit,
      lv: band.lv, m: st.m, pct: band.pct, rate: shownRate(), rateLabel: UI.rateLabel,
      /* ★통합 세션: guideVoice 는 «{cmd}»와 «{gestureHint}» 두 조각을 받는다.
         gestureHint 를 넘기지 않으면 화면에 «{gestureHint}» 원문이 그대로 노출된다.
         수신호 문구는 앱 전체의 요체에 맞춰 signSoft 를 우선한다 (C RESULT 제안 2번). */
      guide: { show: showGuide, emoji: '🤚', sign: cmd.signSoft || cmd.sign,
               text: micShown ? T(COPY.rep && COPY.rep.guideVoice, { cmd: cmd.name, gestureHint: cmd.gestureHint || '' })
                              : T(COPY.rep && COPY.rep.guideGesture && COPY.rep.guideGesture[cmd.gesture]) },
      micShown, treatOn: S.treatOn, treatDisabled: tr.treats <= 0 && !S.treatOn,
      sustain: !!cmd.sustain, holdSec: Math.round(targetHoldMs(band.lv) / 1000),
      holdUnit: UI.holdUnit, toneLabels: (COPY.tone && COPY.tone.badge) || {},
      padHint: UI.padHint, micLabel: UI.micLabel, micOffLabel: UI.micOff,
      treatOnLabel: UI.treatOn, treatOffLabel: UI.treatOff,
    });
    attachDog();
    bindPad();
  }

  function paintTone(t) {
    const s = root.querySelector('[data-slot="tone"]');
    if (s) s.innerHTML = tplToneBadges(t, (COPY.tone && COPY.tone.badge) || {});
  }

  /* rep 시작 — 성격 이벤트가 먼저 끼어들 수 있다 */
  function nextRep() {
    if (!S) return;
    if (S.rep >= S.total) return finish();
    S.phase = 'input';
    S.busy = false;
    renderRep();
    /* 보더콜리 «산책 조르기»: 게이지가 차면 명령 입력 자체가 잠긴다 */
    if (tr.breed === 'bc' && tr.gauge >= GAUGE_MAX) return quirkWalk();
  }

  /* ── 입력 → 판정 ───────────────────────────────────────────────────────── */
  function submit(input) {
    // input = { via:'gesture'|'voice', quality, holdMs, tone }
    if (!S || S.busy || S.phase !== 'input') return;
    if (S.ftue) return;            // FTUE 는 각본이 진행을 맡는다 (ftueTap)
    S.busy = true;
    const cmd = cmdOf(S.cmd);

    /* 프렌치불독 «갸우뚱»: 간식 없이 부르면 40% 확률로 판정 자체가 불발 (rep 미소모) */
    const tilt = tr.breed === 'fr' && !S.treatOn && rng() < 0.4;
    if (tilt) return quirkTilt();

    const st = stateOf(S.cmd);
    const treatUsedThisRep = S.treatOn && tr.treats > 0;
    const out = rollRep(rateInput({
      tone: input.tone || null,
      gestureQuality: input.quality || null,
      holdMs: input.holdMs || 0,
      sustain: !!cmd.sustain,
      praiseHit: false,
      treatStage2Given: treatUsedThisRep && treatStage(lvBand(st.m).lv) === 2,
    }), rng);

    /* FTUE 각본 강제 (v2 §5) — 3단계 갸우뚱 / 5·9단계 성공 */
    if (S.ftue && S.forceResult) { out.result = S.forceResult; if (out.result === 'succ') out.gain = out.gain || 8; }

    if (input.tone) {
      S.tone.n++; S.tone.len += input.tone.len ? 1 : 0;
      S.tone.firm += input.tone.firm ? 1 : 0; S.tone.once += input.tone.once ? 1 : 0;
      tr.tone.n++; tr.tone.len += input.tone.len ? 1 : 0;
      tr.tone.firm += input.tone.firm ? 1 : 0; tr.tone.once += input.tone.once ? 1 : 0;
    }

    track('rep', {
      cmd: S.cmd, input: input.via,
      tone: input.tone ? [input.tone.len, input.tone.firm, input.tone.once] : [0, 0, 0],
      treat: S.treatOn ? treatStage(lvBand(st.m).lv) : 0,
      result: out.result, pity: !!out.forcedByPity,
    });

    if (out.result === 'succ') return onSuccess(out, input, treatUsedThisRep);
    if (out.result === 'partial') return onPartial(out, treatUsedThisRep);
    return onFail(out, treatUsedThisRep);
  }

  /* ── 성공 → 칭찬 타이밍 링 1.2초 ────────────────────────────────────────── */
  function onSuccess(out, input, treatUsed) {
    S.phase = 'praise';
    const cmd = cmdOf(S.cmd);
    pose(cmd.gesture === 'swipeDown' ? 'downPose' : 'sitPose', 1);
    play('ok'); vib(20);
    const wrap = document.createElement('div');
    wrap.innerHTML = tplPraise((COPY.succ && COPY.succ.praise) || '');
    body.appendChild(wrap.firstChild);
    const t0 = Date.now();
    let done = false;
    const settle = hit => {
      if (done || !S || disposed) return; done = true;
      const w = root.querySelector('.ty-praisewrap'); if (w) w.remove();
      const ms = Date.now() - t0;
      track('praise', { timing_ms: ms, hit });
      if (hit) { pose('joy', 1); G.bond = Math.min(100, G.bond + 0.5); S.bond += 0.5; toast(T(COPY.succ && COPY.succ.hit)); }
      else toast(T(COPY.succ && COPY.succ.miss));
      commit(Object.assign({}, out, {
        gain: proficiencyGain({
          result: 'succ', breedMult: breed().mult, praiseHit: hit,
          toneFull: input.tone ? toneScore(input.tone) === 3 : input.quality === 'perfect',
          afterCorrectSignal: S.afterCorrectSignal,
          treatStage2Given: treatUsed && treatStage(lvBand(stateOf(S.cmd).m).lv) === 2,
        }),
      }), treatUsed, true);
    };
    S.praiseSettle = settle;
    later(() => settle(false), PRAISE_MS);
  }

  function onPartial(out, treatUsed) {
    pose('curious', 1);
    toast(T(COPY.rep && COPY.rep.partial));
    commit(out, treatUsed, false);
  }

  function onFail(out, treatUsed) {
    /* 실패의 60%는 «거부»로 드러난다 — 개는 못 하는 게 아니라 신호를 보내는 중이다 */
    if (rng() < 0.6) return refuseFlow(out, treatUsed);
    play('no'); pose('lookAway', 0.8);
    toast(T(pick((COPY.fail && COPY.fail.line) || [''])));
    commit(out, treatUsed, false);
  }

  /* ── 거부 분기 (v2 §4-D) ─────────────────────────────────────────────── */
  function refuseFlow(out, treatUsed) {
    S.phase = 'refuse';
    const sig = weighted(CALMING, rng);
    pose(sig.id, 1);
    play('no');
    const learned = Array.isArray(G.learned) ? G.learned : [];
    const known = learned.includes(sig.id);

    if (!known) {
      /* 아직 산책길에서 안 배운 신호 — 벌점 없이 이름만 알려주고 견인한다 */
      S.quizResult = 'unlearned';
      openSheetRaw(
        '<div class="ty-shtop"><span class="ty-shicon"><em>' + sig.emoji + '</em></span>'
        + '<span class="ty-shtitle">' + esc(T(COPY.refuse && COPY.refuse.intro)) + '</span></div>'
        + tplUnlearned({ emoji: sig.emoji, label: sig.name,
                         sub: UI.unlearnedSub, towTitle: T(COPY.refuse && COPY.refuse.unlearnedGo),
                         towText: UI.towText })
        + '<button class="ty-go" data-act="next">' + esc(UI.goLabel || '') + '</button>',
        key => { if (key === 'goto-unit2') { closeSheet(); goPath(); return; } closeSheet(); refuseChoice(sig, out, treatUsed); });
      return;
    }

    /* 배운 신호끼리 2지선다 */
    const others = CALMING.filter(x => x.id !== sig.id && learned.includes(x.id));
    const wrong = others.length ? pick(others) : CALMING.filter(x => x.id !== sig.id)[0];
    const opts = [{ key: sig.id, emoji: sig.emoji, label: sig.name },
                  { key: wrong.id, emoji: wrong.emoji, label: wrong.name }].sort(() => rng() - 0.5);
    openSheetRaw(
      '<div class="ty-shtop"><span class="ty-shicon"><em>' + sig.emoji + '</em></span>'
      + '<span class="ty-shtitle">' + esc(T(COPY.refuse && COPY.refuse.intro)) + '</span></div>'
      + tplQuiz({ question: T(COPY.refuse && COPY.refuse.quizQ), opts }),
      key => {
        const ok = key === sig.id;
        S.quizResult = ok ? 'ok' : 'miss';
        toast(ok ? T(COPY.refuse && COPY.refuse.quizOk)
                 : T(COPY.refuse && COPY.refuse.quizNo, { sig: sig.name }));
        closeSheet(); later(() => refuseChoice(sig, out, treatUsed), 260);
      });
  }

  /* 2단 — 대응 3택 */
  function refuseChoice(sig, out, treatUsed) {
    const o = (COPY.refuse && COPY.refuse.opts) || {};
    const opts = ['wait', 'treat', 'force']
      .filter(k => k !== 'treat' || tr.treats > 0)
      .map(k => ({ key: k, emoji: (o[k] || {}).emoji, label: (o[k] || {}).label }));
    openSheet({
      icon: sig.emoji, title: T(COPY.refuse && COPY.refuse.choose),
      rows: [{ b: sig.name, p: T(COPY.refuse && COPY.refuse.intro), todo: true }],
      opts, buttons: [],
    }, key => {
      closeSheet();
      /* ★refuse 는 «신호 + 퀴즈 결과 + 대응»을 한 건으로 남긴다 (CONTRACTS §6) */
      track('refuse', { signal: sig.id, quiz: S.quizResult || 'unlearned', choice: key });
      if (key === 'wait') {
        S.afterCorrectSignal = true; S.forced = false;
        G.bond = Math.min(100, G.bond + 1); S.bond += 1;
        toast(T(COPY.refuse.res.wait));
      } else if (key === 'treat') {
        S.afterCorrectSignal = true; S.forced = false;
        tr.treats = Math.max(0, tr.treats - 1); S.treatsUsed++;
        G.bond = Math.min(100, G.bond + 1); S.bond += 1;
        toast(T(COPY.refuse.res.treat));
      } else {
        S.afterCorrectSignal = false; S.forced = true;
        toast(T(COPY.refuse.res.force));
        /* 치와와는 여기서 «화냄»으로 격상될 수 있다 */
        if (tr.breed === 'chi' && rng() < 0.5) { commit(out, treatUsed, false, true); return quirkAnger(); }
      }
      commit(out, treatUsed, false);
    });
  }

  /* ── 성격 이벤트 3종 (v2 §4-E) ────────────────────────────────────────── */
  function quirkTilt() {
    pose('curious', 1);
    const q = (COPY.quirk && COPY.quirk.tilt) || {};
    track('quirk', { type: 'tilt', resolved: false });
    tr.tiltRun = (tr.tiltRun || 0) + 1;
    openSheet({
      icon: '🤨', title: T(q.title),
      rows: [{ b: T(q.noRep), p: T(q.body), todo: true }],
      buttons: [{ key: 'treat', label: (COPY.home && COPY.home.buyTreat) && tr.treats <= 0
                    ? T(COPY.treatBuy && COPY.treatBuy.buy) : T(UI.treatOn) },
                { key: 'skip', label: T(COPY.refuse && COPY.refuse.opts && COPY.refuse.opts.wait && COPY.refuse.opts.wait.label), ghost: true }],
    }, key => {
      closeSheet();
      if (key === 'treat') {
        if (tr.treats <= 0) return openTreatBuy();
        S.treatOn = true;
      }
      /* rep 미소모 — 판정 자체가 없었던 일이 된다 */
      S.busy = false; S.phase = 'input'; renderRep();
      /* 간식 0 + 프렌치: 3회째에 구매 시트를 «제안»한다 (강매 아님) */
      if (tr.treats <= 0 && tr.tiltRun >= 3) { tr.tiltRun = 0; later(openTreatBuy, 400); }
    });
  }

  function quirkAnger() {
    tr.mood = 2; save();
    pose('snarl', 1); play('growl'); vib([30, 60, 30]);
    const q = (COPY.quirk && COPY.quirk.anger) || {};
    const o = q.opts || {};
    openSheet({
      icon: '😠', title: T(q.title),
      rows: [{ b: (breed().name || '') + ' — ' + ((breed().basis) || ''), p: T(q.body), todo: true }],
      opts: ['back', 'pet', 'again'].map(k => ({ key: k, emoji: (o[k] || {}).emoji, label: (o[k] || {}).label })),
      buttons: [],
    }, key => {
      closeSheet();
      let resolved = false;
      if (key === 'back') { tr.mood = 0; resolved = true; G.bond = Math.min(100, G.bond + 2); S.bond += 2; toast(T(q.res.back)); }
      else if (key === 'pet') {
        if (rng() < 0.5) { tr.mood = 0; resolved = true; toast(T(q.res.pet)); }
        else toast(T(q.res.petFail));
      } else { tr.mood += 1; toast(T(q.res.again)); }
      track('quirk', { type: 'anger', resolved });
      if (resolved) pose('relaxed', 1);
      save(); nextRep();
    });
  }

  function quirkWalk() {
    const q = (COPY.quirk && COPY.quirk.walk) || {};
    pose('panting', 1); play('whine');
    const canShake = !!(voice && voice.supported && voice.supported.shake);
    let taps = 0;
    const inner = () => '<div class="ty-shtop"><span class="ty-shicon"><em>🐕‍🦺</em></span>'
      + '<span class="ty-shtitle">' + esc(T(q.title)) + '</span></div>'
      + '<div class="ty-row todo"><b>' + esc(T(canShake ? q.shake : q.fallback)) + '</b>'
      + '<p>' + esc(T(q.body)) + '</p></div>'
      + (canShake ? '<div class="ty-tapbar"><i style="width:0%"></i><span>0%</span></div>'
                  : tplTapper({ need: TAP_NEED, got: taps, title: UI.tapTitle,
                                sub: T(UI.tapSub, { need: TAP_NEED }), btn: UI.tapBtn }));

    const finishWalk = ok => {
      track('shake', { ok });
      tr.gauge = 0; G.bond = Math.min(100, G.bond + 3); if (S) { S.bond += 3; S.walkBoost = 3; }
      save(); closeSheet(); pose('joy', 1); toast(T(q.done));
      later(() => { if (S) { S.busy = false; S.phase = 'input'; renderRep(); } }, 300);
    };

    openSheetRaw(inner(), key => {
      if (key !== 'tap') return;
      taps++;
      const bar = sheetC.querySelector('.ty-tapbar i'), lbl = sheetC.querySelector('.ty-tapbar span');
      if (bar) bar.style.width = Math.min(100, taps / TAP_NEED * 100) + '%';
      if (lbl) lbl.textContent = taps + ' / ' + TAP_NEED;
      if (taps >= TAP_NEED) finishWalk(false);
    });

    if (canShake) {
      voice.shake(SHAKE_SEC, pct => {
        const bar = sheetC.querySelector('.ty-tapbar i'), lbl = sheetC.querySelector('.ty-tapbar span');
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (lbl) lbl.textContent = Math.round(pct) + '%';
      }).then(ok => {
        if (ok) finishWalk(true);
        else { /* 권한 거부·미지원 → 연타 폴백으로 자동 전환 (기능 손실 없음 원칙) */
          const box = sheetC.querySelector('.ty-tapbar');
          if (box) box.outerHTML = tplTapper({ need: TAP_NEED, got: 0, title: UI.tapTitle,
                                               sub: T(UI.tapSub, { need: TAP_NEED }), btn: UI.tapBtn });
        }
      }).catch(() => {});
    }
  }

  /* ── rep 확정 ─────────────────────────────────────────────────────────── */
  function commit(out, treatUsed, wasPraise, silent) {
    const st = stateOf(S.cmd);
    if (treatUsed) { tr.treats = Math.max(0, tr.treats - 1); S.treatsUsed++;
                     if (treatStage(lvBand(st.m).lv) === 2) { G.bond = Math.min(100, G.bond + 1); S.bond += 1; } }
    const res = applyRep(tr, S.cmd, out, { treatUsed, day: todayStr() });
    S.gain += res.applied;
    if (res.capped) S.capped = true;
    if (out.result === 'succ') S.succ++;
    S.failStreak = out.result === 'fail' ? S.failStreak + 1 : 0;
    S.rep++; G.q.reps = (G.q.reps || 0) + 1;
    if (tr.mood > 0) tr.mood--;
    if (S.walkBoost > 0) S.walkBoost--;
    if (tr.breed === 'bc') tr.gauge = Math.min(GAUGE_MAX, tr.gauge + 1);
    S.afterCorrectSignal = false; S.forced = false;
    save();

    if (!silent && res.applied > 0) popGain(res.applied);
    if (res.capped) toast(T(COPY.home && COPY.home.capped));

    if (res.lv.leveled) {
      track('levelup', { cmd: S.cmd, lv: res.lv.to });
      const cmdName = cmdOf(S.cmd).name;
      if (res.lv.isMaster) {
        track('master', { cmd: S.cmd });
        G.bones += 50; play('trophy');
        showFx('🏆', T(COPY.level.master, { cmd: cmdName }), T(COPY.level.masterReward));
      } else {
        play('chest');
        showFx('🎉', T(COPY.level.up, { cmd: cmdName, lv: res.lv.to }),
               res.lv.isSignSwitch ? T(COPY.level.sign) : '');
      }
      later(nextRep, 1600);
      return;
    }
    later(nextRep, silent ? 100 : 720);
  }

  function popGain(n) {
    const g = root.querySelector('.ty-grow');
    if (!g) return;
    const p = document.createElement('span'); p.className = 'ty-pop'; p.textContent = '+' + n;
    g.appendChild(p); setTimeout(() => p.remove(), 1100);
  }

  /* ══════════════════════════════════════════════════════════════════════
     화면 3 — 세션 리포트
     ══════════════════════════════════════════════════════════════════════ */
  function finish() {
    const st = stateOf(S.cmd), band = lvBand(st.m);
    G.bones += 2;
    const tAvg = S.tone.n
      ? { n: S.tone.n, lenOk: S.tone.len / S.tone.n >= 0.6, firmOk: S.tone.firm / S.tone.n >= 0.6,
          onceOk: S.tone.once / S.tone.n >= 0.6, coach: coachLine() }
      : null;
    track('session_end', { cmd: S.cmd, succ: S.succ, reps: S.rep, gain: S.gain,
                           tone_avg: S.tone.n ? +( (S.tone.len + S.tone.firm + S.tone.once) / (S.tone.n * 3) ).toFixed(2) : null });
    save();
    body.innerHTML = tplReport({
      cmdName: cmdOf(S.cmd).name, succ: S.succ, total: S.total,
      gain: S.gain, lv: band.lv, m: st.m, pct: band.pct, capped: S.capped,
      subLine: T(UI.subLine, { total: S.total, succ: S.succ }),
      tone: tAvg, bond: Math.round(S.bond), treatsUsed: S.treatsUsed, bones: 2,
      canAgain: true,
      L: {
        title: T(COPY.report && COPY.report.title), succ: COPY.report && COPY.report.succ,
        rate: UI.rate, gain: COPY.report && COPY.report.gain,
        voiceCard: COPY.report && COPY.report.voiceCard, times: UI.times,
        lenLine: UI.lenLine, firmLine: UI.firmLine, onceLine: UI.onceLine,
        bond: UI.bond, treat: UI.treat, bone: UI.bone,
        cappedTitle: UI.cappedTitle, cappedNote: T(COPY.report && COPY.report.cappedNote),
        again: T(COPY.report && COPY.report.again), home: T(COPY.report && COPY.report.home),
      },
    });
    pose(S.succ >= S.total / 2 ? 'joy' : 'relaxed', 1);
    const cmd = S.cmd; S.finished = true; S.repeatCmd = cmd;
  }

  /* 리포트 한 줄 코칭 — 가장 많이 어긋난 요소 하나만 짚는다 (잔소리 금지) */
  function coachLine() {
    const co = (COPY.tone && COPY.tone.coach) || {}, n = S.tone.n;
    if (n < 2) return T(co.few);
    const r = { long: 1 - S.tone.len / n, rising: 1 - S.tone.firm / n, repeat: 1 - S.tone.once / n };
    const worst = Object.keys(r).sort((a, b) => r[b] - r[a])[0];
    if (r[worst] < 0.25) return T(co.perfect);
    return T(co[worst], { cmd: cmdOf(S.cmd).name });
  }

  /* ══════════════════════════════════════════════════════════════════════
     시트 · 오버레이
     ══════════════════════════════════════════════════════════════════════ */
  function openSheetRaw(html, handler) { sheetC.innerHTML = html; sheetHandler = handler || null; sheet.classList.add('on'); }
  function openSheet(d, handler) { openSheetRaw(tplSheet(d), handler); }
  function closeSheet() { sheet.classList.remove('on'); sheetHandler = null; }

  function showFx(emoji, title, sub) {
    fxSlot.innerHTML = tplFx({ emoji, title: title || T(UI.lvUp), sub });
    later(() => { fxSlot.innerHTML = ''; }, 1500);
  }

  function openTreatBuy() {
    const b = COPY.treatBuy || {};
    openSheet({
      icon: '🍖', title: T(b.title),
      rows: [{ b: T(b.body), p: T(COPY.home && COPY.home.buyTreat), todo: true }],
      buttons: [{ key: 'buy', label: T(b.buy) }, { key: 'close', label: T(b.close), ghost: true }],
    }, key => {
      if (key === 'buy') {
        if (G.bones < 10) { toast(T(b.title)); return; }
        G.bones -= 10; tr.treats += 5; save(); track('treat_buy', { n: 5 });
      }
      closeSheet();
      if (S && S.phase === 'input') renderRep(); else if (!S) renderHome();
    });
  }

  function openEnergySheet() {
    /* ★통합 세션: ⚡ 시트는 기존 앱 것을 재사용한다 (v2 §8 «기존 에너지 시트 재사용»).
       자체 시트에는 🦴30 충전 버튼이 없어, 여기서 막히면 회복을 기다리는 길밖에 없다. */
    if (typeof c.openEnergy === 'function') { c.openEnergy(); return; }
    const e = COPY.energy || {};
    openSheet({ icon: '⚡', title: T(e.title),
      rows: [{ b: T(COPY.home && COPY.home.energyLocked), p: T(e.body), todo: true }],
      buttons: [{ key: 'close', label: T(COPY.treatBuy && COPY.treatBuy.close), ghost: true }] },
      () => closeSheet());
  }

  /* 이탈 방어 1회 — 말해보카식. 두 번째부터는 조르지 않는다 */
  function tryQuit() {
    if (!S || S.finished) { renderHome(); return; }
    if (S.exitGuard) { saveAndLeave(); return; }
    S.exitGuard = true;
    pose('earsBack', 1);
    const x = COPY.exit || {};
    openSheet({
      icon: '🥺', title: T(x.title),
      rows: [{ b: T(x.body, { n: Math.max(0, S.total - S.rep) }), p: T(COPY.report && COPY.report.cappedNote), todo: true }],
      buttons: [{ key: 'stay', label: T(x.stay) }, { key: 'go', label: T(x.go), ghost: true }],
    }, key => { closeSheet(); if (key === 'go') saveAndLeave(); else renderRep(); });
  }
  /* ★통합 QA 에서 잡힌 버그: 칭찬 링의 1.2초 타이머가 세션을 떠난 «뒤에» 깨어나
     이미 null 인 S 를 만지고 터졌다. 세션을 놓을 때는 예약분도 함께 놓는다. */
  function saveAndLeave() { clearTimers(); save(); S = null; renderHome(); }

  /* ══════════════════════════════════════════════════════════════════════
     제스처 인식 5종 + 지속형 홀드
     ══════════════════════════════════════════════════════════════════════ */
  let padOff = null;
  function bindPad() {
    if (padOff) { padOff(); padOff = null; }
    const pad = root.querySelector('.ty-pad');
    if (!pad) return;
    const pts = [];
    let downT = 0, active = false, holdRaf = 0;
    const cmd = cmdOf(S.cmd);
    const target = targetHoldMs(lvBand(stateOf(S.cmd).m).lv);

    const rect = () => pad.getBoundingClientRect();
    const rel = e => { const r = rect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: Date.now() }; };

    const onDown = e => {
      if (!S || S.busy || S.phase !== 'input') return;
      active = true; downT = Date.now(); pts.length = 0; pts.push(rel(e));
      pad.setPointerCapture && pad.setPointerCapture(e.pointerId);
      if (cmd.sustain) {
        const ring = pad.querySelector('.ty-hold');
        const tick = () => {
          if (!active) return;
          const p = Math.min(100, (Date.now() - downT) / target * 100);
          if (ring) { ring.style.setProperty('--p', p); ring.classList.toggle('done', p >= 100); }
          const lbl = pad.querySelector('.ty-hold-lbl');
          if (lbl) lbl.innerHTML = Math.max(0, Math.ceil((target - (Date.now() - downT)) / 1000)) + '<small>초</small>';
          holdRaf = requestAnimationFrame(tick);
        };
        tick();
      }
    };
    const onMove = e => { if (active) { pts.push(rel(e)); trail(pad, rel(e)); } };
    const onUp = () => {
      if (!active) return;
      active = false; cancelAnimationFrame(holdRaf);
      const held = Date.now() - downT;
      if (cmd.sustain) return submit({ via: 'gesture', holdMs: held,
        quality: held >= target ? 'perfect' : 'ok' });
      const g = classify(pts, held);
      if (!g.type) return;                                   // 의미 없는 터치는 무시
      if (g.type !== cmd.gesture) { toast(T(COPY.rep && COPY.rep.guideGesture && COPY.rep.guideGesture[cmd.gesture])); return; }
      submit({ via: 'gesture', quality: g.quality, holdMs: held });
    };
    pad.addEventListener('pointerdown', onDown);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', onUp);
    pad.addEventListener('pointercancel', onUp);
    padOff = () => { pad.removeEventListener('pointerdown', onDown); pad.removeEventListener('pointermove', onMove);
                     pad.removeEventListener('pointerup', onUp); pad.removeEventListener('pointercancel', onUp);
                     cancelAnimationFrame(holdRaf); };
  }

  function trail(pad, p) {
    const d = document.createElement('span'); d.className = 'ty-trail';
    d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
    pad.appendChild(d); setTimeout(() => d.remove(), 420);
  }

  /* 5종 분류: 위/아래 스와이프 · 안쪽 당기기 · 앞발 탭 · 원 그리기
     «품질»은 흔들림 없이 크게 그렸는가로 매긴다 (perfect=+10, ok=+5) */
  function classify(pts, held) {
    if (pts.length < 2) return { type: held < 250 ? 'tapPaw' : null, quality: held < 180 ? 'perfect' : 'ok' };
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    let path = 0;
    for (let i = 1; i < pts.length; i++) path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (dist < 14 && held < 250) return { type: 'tapPaw', quality: held < 180 ? 'perfect' : 'ok' };

    /* 원: 진행 방향의 누적 회전각이 한 바퀴에 가까운가 */
    let turn = 0;
    for (let i = 2; i < pts.length; i++) {
      const a1 = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x);
      const a2 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      turn += d;
    }
    const deg = Math.abs(turn) * 180 / Math.PI;
    if (deg > 270 && path > 160) return { type: 'circle', quality: deg > 320 ? 'perfect' : 'ok' };

    if (dist < 45) return { type: null };
    const straight = dist / (path || dist);
    const q = (dist >= 110 && straight >= 0.85) ? 'perfect' : 'ok';
    if (Math.abs(dy) > Math.abs(dx) * 1.4) return { type: dy < 0 ? 'swipeUp' : 'swipeDown', quality: q };
    /* 안쪽 당기기: 대각선으로 «내 몸쪽(아래·중앙)»으로 끌어온다 */
    if (dy > 20) return { type: 'pullIn', quality: q };
    return { type: null };
  }

  /* ══════════════════════════════════════════════════════════════════════
     음성 입력
     ══════════════════════════════════════════════════════════════════════ */
  function micHold() {
    if (!voice || !S || S.busy || S.phase !== 'input') return;
    const cmd = cmdOf(S.cmd);
    const btn = root.querySelector('.ty-mic'); if (btn) btn.classList.add('on');
    toast(T(COPY.rep && COPY.rep.listening));
    voice.listen(cmd.voice || []).then(r => {
      if (btn) btn.classList.remove('on');
      if (!r) return;
      if (r.status === 'other') { toast(T(COPY.rep && COPY.rep.guideVoice, { cmd: cmd.name, gestureHint: cmd.gestureHint || '' })); return; }  // rep 미소모
      if (r.status === 'nohear') { S.nohear = (S.nohear || 0) + 1;
        toast(T(COPY.rep && COPY.rep.guideGesture && COPY.rep.guideGesture[cmd.gesture])); return; }       // rep 미소모
      const measured = r.tone && r.tone.measured !== false && r.status !== 'noise';
      paintTone(measured ? r.tone : 'na');
      if (!measured) toast(T(COPY.tone && COPY.tone.na));
      else toast(T(toneFeedback(r.tone), { cmd: cmd.name }));
      later(() => submit({ via: 'voice', tone: measured ? r.tone : null, quality: measured ? null : 'ok' }), 420);
    }).catch(() => { if (btn) btn.classList.remove('on'); });
  }
  function toneFeedback(t) {
    const f = (COPY.tone && COPY.tone.fb) || {};
    if (!t.len) return f.long;
    if (!t.firm) return f.rising;
    if (!t.once) return f.repeat;
    return f.perfect;
  }

  /* ══════════════════════════════════════════════════════════════════════
     FTUE 10단계 각본 (v2 §5)
     ══════════════════════════════════════════════════════════════════════ */
  let ftue = null;
  function runFtue() {
    const steps = COPY.ftue || [];
    ftue = { i: 0, steps };
    S = newSession('sit', true);
    S.total = 99;                    // 각본이 끝을 정한다
    tr.treats = Math.max(tr.treats, 3);   // 튜토리얼 간식 3개 무료
    ftueStep();
  }
  function ftueStep() {
    if (!ftue) return;
    const st = ftue.steps[ftue.i];
    if (!st) { tr.ftue = 10; save(); S = null; renderHome(); return; }
    track('train_ftue_step' + st.n);
    tr.ftue = st.n; save();

    renderRep();
    /* 각본 단계별 연출 */
    if (st.screen === 'tilt') pose('curious', 1);
    else if (st.screen === 'succ') { pose('sitPose', 1); play('ok'); }
    else if (st.screen === 'timing') pose('joy', 1);
    else pose('curious', 1);

    if (st.screen === 'succ') {
      /* 5단계 — 칭찬 링을 각본으로 띄운다 */
      const wrap = document.createElement('div');
      wrap.innerHTML = tplPraise((COPY.succ && COPY.succ.praise) || '');
      body.appendChild(wrap.firstChild);
      S.praiseAt = Date.now();
      ftueSheet(st, () => {});
      return;
    }
    if (st.screen === 'micSheet') {
      const m = COPY.ftueMicSheet || {};
      openSheet({ icon: '🎙️', title: T(m.title),
        rows: [{ b: T(m.reward), p: T(m.body), todo: true }],
        buttons: [{ key: 'ok', label: T(m.ok) }, { key: 'later', label: T(m.later), ghost: true }] },
        key => {
          closeSheet();
          if (key === 'ok' && voice && voice.primeMic) {
            voice.primeMic().then(state => {
              tr.mic = state; track('mic', { state });
              if (state === 'granted') { G.bones += 20; }
              save(); ftueNext();
            });
          } else { tr.mic = tr.mic === 'granted' ? 'granted' : 'denied'; track('mic', { state: tr.mic }); save(); ftueNext(); }
        });
      return;
    }
    if (st.screen === 'gauge') {
      /* 7단계 — 게이지 첫 상승 +12 를 실제로 반영한다 */
      applyRep(tr, 'sit', { result: 'succ', gain: 12 }, { treatUsed: false, day: todayStr() });
      save(); renderRep(); popGain(12);
    }
    if (st.screen === 'report') {
      S.succ = 1; S.rep = 1; S.total = 1; S.gain = 12;
      finish();
      openSheetFtue(st);
      return;
    }
    ftueSheet(st);
  }
  function openSheetFtue(st) {
    openSheet({ icon: '🎓', title: T(st.copy), rows: [], buttons: [{ key: 'next', label: T(st.cta || UI.goLabel) }] },
      () => { closeSheet(); ftueNext(); });
  }
  function ftueSheet(st, onCta) {
    const needsGesture = st.action === 'swipeUp' || st.action === 'speak';
    if (needsGesture) {
      /* 각본 제스처 — 실패할 수 없다. 어떤 입력이든 다음 단계로 넘어간다 */
      openSheetRaw('', null); closeSheet();
      showCoach(T(st.copy));
      S.forceResult = (ftue.steps[ftue.i + 1] || {}).forced || null;
      S.busy = false; S.phase = 'input';
      S.ftueAdvance = true;
      if (st.action === 'speak') paintTone({ len: 1, firm: 1, once: 1 });
      return;
    }
    if (st.action === 'praise') { showCoach(T(st.copy)); S.ftueAdvance = true; S.phase = 'praise'; return; }
    openSheet({ icon: '🎓', title: T(st.copy), rows: [], buttons: [{ key: 'next', label: T(st.cta || UI.goLabel) }] },
      key => { closeSheet(); if (onCta) onCta(key); ftueNext(); });
  }
  function ftueNext() { if (!ftue) return; ftue.i++; ftueStep(); }
  function showCoach(text) {
    let cbox = root.querySelector('.ty-coachbar');
    if (!cbox) { cbox = document.createElement('div'); cbox.className = 'ty-coachbar'; root.appendChild(cbox); }
    cbox.textContent = text; cbox.classList.add('on');
    later(() => cbox.classList.remove('on'), 4200);
  }

  /* ══════════════════════════════════════════════════════════════════════
     이벤트 위임 — 뷰는 data-act 만 남기고 배선은 전부 여기서
     ══════════════════════════════════════════════════════════════════════ */
  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    /* 시트 안에서 눌렀으면 시트 처리기로 먼저 보낸다 */
    if (sheet.contains(t) && sheetHandler) {
      const key = act === 'opt' ? t.dataset.key : act;
      sheetHandler(key, t); return;
    }
    switch (act) {
      case 'back': goHome(); break;
      case 'quit': tryQuit(); break;
      case 'start': startSession(t.dataset.id, false); break;
      case 'locked': toast(lockLabel(t.dataset.id, COMMANDS, tr)); break;
      case 'buy': case 'treats': openTreatBuy(); break;
      case 'treat': toggleTreat(); break;
      case 'mic': micHold(); break;
      case 'mic-off': toast(T(COPY.rep && COPY.rep.guideGesture && COPY.rep.guideGesture[cmdOf(S && S.cmd).gesture])); break;
      case 'praise': if (S && S.praiseSettle) S.praiseSettle(true);
                     else if (S && S.ftueAdvance) { S.ftueAdvance = false;
                       const w = root.querySelector('.ty-praisewrap'); if (w) w.remove();
                       track('praise', { timing_ms: Date.now() - (S.praiseAt || Date.now()), hit: true }); ftueNext(); }
                     break;
      case 'again': if (S && S.repeatCmd) { const cm = S.repeatCmd; S = null; startSession(cm, false); } break;
      case 'home': renderHome(); break;
      case 'fx-close': fxSlot.innerHTML = ''; break;
      case 'goto-unit2': goPath(); break;
      default: break;
    }
  }
  function toggleTreat() {
    if (!S) return;
    if (!S.treatOn && tr.treats <= 0) return openTreatBuy();
    S.treatOn = !S.treatOn;
    toast(T(S.treatOn ? (COPY.rep && COPY.rep.treatOn) : (COPY.rep && COPY.rep.treatOff)));
    renderRep();
  }
  root.addEventListener('click', onClick);

  /* FTUE 각본 제스처: 패드 어디를 만져도 통과시킨다 (실패 불가) */
  function ftueTap(e) {
    if (!S || !S.ftueAdvance || !ftue) return;
    if (!e.target.closest('.ty-pad') && !e.target.closest('.ty-mic')) return;
    S.ftueAdvance = false;
    const forced = S.forceResult;
    if (forced === 'tilt') pose('curious', 1);
    if (forced === 'succ') { pose('sitPose', 1); play('ok'); }
    later(ftueNext, 520);
  }
  root.addEventListener('pointerup', ftueTap);

  /* rep 도중 백그라운드 전환 → 해당 rep 무효, 세션 상태는 저장 (v2 §8) */
  function onHide() { if (S) { S.busy = false; S.phase = 'input'; } save(); }
  addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); });

  /* ══════════════════════════════════════════════════════════════════════ */
  return {
    open() { clearTimers(); ftue = null; renderHome(); },
    openFtue() { clearTimers(); runFtue(); },
    dispose() {
      disposed = true; clearTimers();
      root.removeEventListener('click', onClick);
      root.removeEventListener('pointerup', ftueTap);
      removeEventListener('pagehide', onHide);
      if (padOff) padOff();
      if (voice && voice.dispose) { try { voice.dispose(); } catch (e) {} }
      root.remove();
    },
  };
}

/* 가중 추첨 — 카밍 시그널 풀처럼 «확률표»가 설계에 박혀 있을 때 쓴다 */
function weighted(list, rng) {
  const R = typeof rng === 'function' ? rng : Math.random;
  const total = list.reduce((s, x) => s + x.p, 0);
  let r = R() * total;
  for (const x of list) { r -= x.p; if (r <= 0) return x; }
  return list[list.length - 1];
}
