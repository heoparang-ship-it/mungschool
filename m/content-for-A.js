/* 멍스쿨 모바일 — content.js 를 «A(train.js)의 키 모양»으로 보여 주는 어댑터 (C 소유)
 *
 * ─ 왜 필요한가 ───────────────────────────────────────────────────────────
 * A 는 `01_훈련장코어/out/stubs/stub-content.js` 를 기준으로 train.js 를 이미 다 짰다.
 * 그런데 A 의 스텁과 C 의 실물 content.js 는 두 곳에서 어긋난다:
 *
 *   ① 키 모양     A: home.* · succ.* · fail.line[] · tone.fb.* · exit.* · treatBuy.* · ui.*
 *                 C: yard.* · praise.* · rep.failLines[] · tone.* · leave.* · treat.* · ui.*
 *   ② 조사 토큰   A: {name은는} {name이가} {name아야} {name와과} {cmd을를} {sig} {gain} {rate}
 *                 C: {name:은}  {name:이}  {name:아}  {name:과}  {~cmd:을} {signal} …
 *                 (C 의 표기는 PROMPT_C 가 지정한 규약이라 C 쪽을 정본으로 둔다)
 *
 * 카피를 두 벌로 복제하면 반드시 한쪽이 낡는다. 그래서 이 파일은 **문구를 새로 쓰지 않고**
 * content.js 의 문구를 그대로 읽어 ①키를 A 모양으로 재배치하고 ②토큰만 A 표기로 변환한다.
 * 문구를 고칠 곳은 언제나 content.js 한 곳이다.
 *
 * ─ 쓰는 법 ──────────────────────────────────────────────────────────────
 *   train.js 의 import 를
 *       import { COMMANDS, BREEDS, TRAIN_COPY, CONFUSION, J } from './stubs/stub-content.js';
 *   에서
 *       import { COMMANDS, BREEDS, TRAIN_COPY, CONFUSION, J } from '<C>/content-for-A.js';
 *   로 **경로만** 바꾸면 된다. 시그니처는 스텁과 1:1이다.
 *
 *   조사 치환은 A 가 이미 구현했지만, 안 했다면 여기 `fillA()` 를 쓰면 된다.
 *       fillA(TRAIN_COPY.level.up, { name:'콩', cmd:'손', lv:3 })  →  '콩이 «손»을 Lv3까지 배웠어요!'
 *
 * ─ 통합 세션이 결정할 것 ────────────────────────────────────────────────
 *   장기적으로는 A 를 C 표기(`{name:은}` + `fill()`)로 수렴시키는 게 맞다.
 *   이 어댑터는 그 리팩터를 «나중»으로 미룰 수 있게 해 주는 다리이며, 영구 구조가 아니다.
 */

import {
  COMMANDS, BREEDS, CONFUSION, TRAIN_COPY as C, SIGNAL_IDS, SIGNAL_SOURCE, J, JOSA,
} from './content.js';

export { COMMANDS, BREEDS, CONFUSION, SIGNAL_IDS, SIGNAL_SOURCE, J };

/* ═══════════════════════════════════════════════════════════════════════
   1. 토큰 변환 — C 표기 → A 표기
   ═══════════════════════════════════════════════════════════════════════ */

/** C 조사 키 → A 토큰 접미사 */
const TOKEN = { '은': '은는', '이': '이가', '을': '을를', '과': '와과', '아': '아야' };

/**
 * '{name:은}' → '{name은는}' · '{~cmd:을}' → '{cmd을를}' · '{signal}' → '{sig}'
 * 매핑에 없는 조사는 A 가 모르는 토큰이 되므로, 그 자리에서 «받침 없는 형태»로 굳혀 버리지 않고
 * 예외를 던진다 — 조용히 비문이 되는 것보다 빌드가 깨지는 편이 낫다.
 */
export function toA(str) {
  return String(str).replace(/\{(~?)(\w+)(?::([^}]+))?\}/g, (m, only, key, josa) => {
    const k = key === 'signal' ? 'sig' : key;
    if (!josa) return `{${k}}`;
    const suf = TOKEN[josa];
    if (!suf) throw new Error(`content-for-A: A 표기로 옮길 수 없는 조사 «${josa}» — ${m}`);
    return `{${k}${suf}}`;      // ~ 여부와 무관하게 A 는 «조사만» 토큰으로 처리한다
  });
}

/** 문자열 / 배열 / 객체를 재귀적으로 변환 */
const A = v => (typeof v === 'string' ? toA(v)
  : Array.isArray(v) ? v.map(A)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, A(x)]))
      : v);

/* ═══════════════════════════════════════════════════════════════════════
   2. A 표기 렌더러
      {name은는} {cmd을를} 처럼 «키 + 조사쌍»이 붙은 토큰을 해소한다.
      ★{cmd을를} 은 A 의 규약대로 «조사만» 출력한다 (이름은 앞의 «{cmd}» 가 이미 찍었다).
   ═══════════════════════════════════════════════════════════════════════ */

const JOSA_ONLY = new Set(['cmd']);   // 조사만 출력할 키 (A _copy-notes.md §0)
const PAIR = Object.entries(TOKEN).map(([a, suf]) => [suf, a, JOSA[a]]);   // [접미사, 받침O, 받침X]

export function fillA(tpl, vars = {}) {
  let out = String(tpl);
  // ① 조사 붙은 토큰
  for (const [suf, a, b] of PAIR) {
    out = out.replace(new RegExp(`\\{(\\w+)${suf}\\}`, 'g'), (m, key) => {
      const v = vars[key];
      if (v == null) return m;
      const full = J(String(v), a, b);
      return JOSA_ONLY.has(key) ? full.slice(String(v).length) : full;
    });
  }
  // ② 조사 없는 토큰
  return out.replace(/\{(\w+)\}/g, (m, key) => (vars[key] == null ? m : String(vars[key])));
}

/* ═══════════════════════════════════════════════════════════════════════
   3. 키 재배치 — A 의 174키 모양
      ★ftue[n].screen / .action / .forced 는 «카피»가 아니라 A 의 상태기계 메타데이터다.
        C 가 정할 값이 아니므로 A 의 스텁 값을 그대로 옮겨 둔다 (아래 FTUE_MACHINE).
   ═══════════════════════════════════════════════════════════════════════ */

const FTUE_MACHINE = [
  { n: 1,  screen: 'intro',    action: 'start',   forced: null },
  { n: 2,  screen: 'sign',     action: 'swipeUp', forced: null },
  { n: 3,  screen: 'tilt',     action: 'treatOn', forced: 'tilt' },
  { n: 4,  screen: 'retry',    action: 'swipeUp', forced: null },
  { n: 5,  screen: 'succ',     action: 'praise',  forced: 'succ' },
  { n: 6,  screen: 'timing',   action: 'auto',    forced: null },
  { n: 7,  screen: 'gauge',    action: 'auto',    forced: null },
  { n: 8,  screen: 'micSheet', action: 'mic',     forced: null },
  { n: 9,  screen: 'speak',    action: 'speak',   forced: 'succ' },
  { n: 10, screen: 'report',   action: 'home',    forced: null },
];
/* ★n 은 없어도 화면은 그려지지만 `track('train_ftue_step'+st.n)` 이 «stepundefined» 를 찍는다.
   A 의 verify-train.mjs 가 CONTRACTS §6 이벤트 명세로 이걸 잡아냈다 — 반드시 유지할 것. */

const FTUE_COPY = [
  { copy: C.ftue.s1.copy,  cta: C.ftue.s1.cta },
  { copy: C.ftue.s2.copy,  cta: null },          // 스와이프로 넘어간다 (버튼 없음)
  { copy: C.ftue.s3.copy,  cta: C.ftue.s3.cta },
  { copy: C.ftue.s4.copy,  cta: C.ftue.s4.cta },
  { copy: C.ftue.s5.copy,  cta: C.ftue.s5.cta },
  { copy: C.ftue.s6.copy,  cta: C.ftue.next },
  { copy: C.ftue.s7.copy,  cta: C.ftue.next },
  { copy: C.ftue.s8.copy,  cta: C.ftue.s8.cta },
  { copy: C.ftue.s9.copy,  cta: null },          // 발화로 넘어간다
  { copy: C.ftue.s10.copy, cta: C.ftue.s10.cta },
];

export const TRAIN_COPY = A({

  /* ── ui — 뷰 라벨 (C.ui 그대로) ─────────────────────────────────── */
  ui: { ...C.ui },

  /* ── home ← C.yard ─────────────────────────────────────────────── */
  home: {
    title: C.yard.title,
    bubble: C.yard.greet,
    bubbleFirst: C.yard.greetFirst,
    buyTreat: C.yard.buy,
    capped: C.dailyCap.over,
    energyLocked: C.yard.energyLocked,
  },

  /* ── lock ← C.yard.locked / lockedAvg ──────────────────────────── */
  lock: {
    byCmd: C.yard.locked,
    byAvg: C.yard.lockedAvg,
  },

  /* ── ftue ← C.ftue.s1..s10 + A 의 상태기계 메타 ─────────────────── */
  ftue: FTUE_MACHINE.map((m, i) => ({ ...m, ...FTUE_COPY[i] })),
  ftueMicSheet: {
    title: '목소리로도 가르칠 수 있어요',
    body: C.voice.priming,
    ok: C.voice.primingYes,
    later: C.voice.primingNo,
    reward: '+🦴20',
  },

  /* ── rep ───────────────────────────────────────────────────────── */
  rep: {
    guideVoice: C.rep.guideHow,
    guideGesture: { ...C.rep.gestureGuide },
    holdKeep: C.sustain.keep,
    holdRelease: C.sustain.release,
    partial: C.rep.nearMiss,
    listening: C.rep.listening,
    treatOn: C.treat.stage1,
    treatOff: C.treat.stage3,
    treatEmpty: C.treat.empty,
    signSwitched: C.rep.signSwitched,
  },

  /* ── tone ← C.tone (즉시 피드백) + C.report.coach (리포트 코칭) ─── */
  tone: {
    badge: { ...C.tone.badges },
    na: C.tone.pending,
    fb: {
      long: C.tone.long,
      rising: C.tone.rising,
      repeat: C.tone.repeat,
      perfect: C.tone.perfect,
      quiet: C.tone.quiet,                 // ★A 스텁에 없던 4번째 요소
    },
    coach: {
      long: C.report.coach.len,
      rising: C.report.coach.firm,
      repeat: C.report.coach.once,
      perfect: C.report.coach.perfect,
      quiet: C.report.coach.quiet,         // ★A 스텁에 없던 4번째 요소
      few: C.report.coach.none,
    },
  },

  /* ── succ ← C.praise ───────────────────────────────────────────── */
  succ: {
    praise: C.praise.btn,
    hit: C.praise.hit,
    hitWhy: C.praise.hitWhy,
    miss: C.praise.miss,
  },

  /* ── fail ← C.rep.failLines ────────────────────────────────────── */
  fail: { line: [...C.rep.failLines] },

  /* ── refuse ────────────────────────────────────────────────────── */
  refuse: {
    intro: C.refuse.intro,
    quizQ: C.refuse.quizAsk,
    quizOk: C.refuse.quizOk,
    quizNo: C.refuse.quizMiss,
    unlearned: C.refuse.quizUnlearned,
    unlearnedGo: C.refuse.quizUnlearnedCta,
    choose: C.refuse.choose,
    opts: {
      wait:  { label: C.refuse.choice.wait.label,  emoji: C.refuse.choice.wait.emoji },
      treat: { label: C.refuse.choice.treat.label, emoji: C.refuse.choice.treat.emoji },
      force: { label: C.refuse.choice.force.label, emoji: C.refuse.choice.force.emoji },
    },
    res: {
      wait: C.refuse.choice.wait.result,
      treat: C.refuse.choice.treat.result,
      force: C.refuse.choice.force.result,
    },
  },

  /* ── quirk ─────────────────────────────────────────────────────── */
  quirk: {
    anger: {
      title: C.quirk.anger.title,
      body: C.quirk.anger.lesson,
      opts: {
        back:  { label: C.quirk.anger.choice.back.label,  emoji: C.quirk.anger.choice.back.emoji },
        pet:   { label: C.quirk.anger.choice.pet.label,   emoji: C.quirk.anger.choice.pet.emoji },
        again: { label: C.quirk.anger.choice.again.label,  emoji: C.quirk.anger.choice.again.emoji },
      },
      res: {
        back: C.quirk.anger.choice.back.result,
        pet: C.quirk.anger.choice.pet.ok,
        petFail: C.quirk.anger.choice.pet.no,
        again: C.quirk.anger.choice.again.result,
      },
    },
    walk: {
      title: C.quirk.walk.title,
      body: C.quirk.walk.lesson,
      shake: C.quirk.walk.shake,
      fallback: C.quirk.walk.fallback,
      done: C.quirk.walk.done,
    },
    tilt: {
      title: C.quirk.tilt.title,
      body: C.quirk.tilt.lesson,
      noRep: C.quirk.tilt.noRep,
    },
  },

  /* ── level ← C.level / C.master ────────────────────────────────── */
  level: {
    up: C.level.up,
    sign: C.level.lv3,
    master: C.master.body,
    masterReward: C.master.reward,
  },

  /* ── report ────────────────────────────────────────────────────── */
  report: {
    title: C.report.title,
    succ: C.report.succLabel,
    gain: C.report.gainLabel,
    voiceCard: C.report.toneTitle,
    again: C.report.more,
    home: C.report.toDog,
    cappedNote: C.dailyCap.over,
  },

  /* ── exit ← C.leave ────────────────────────────────────────────── */
  exit: {
    title: C.leave.title,
    body: C.leave.guard,
    stay: C.leave.stay,
    go: C.leave.go,
  },

  /* ── treatBuy ← C.treat ────────────────────────────────────────── */
  treatBuy: {
    title: C.treat.emptyTitle,
    body: C.treat.buy,
    buy: C.treat.buy,
    close: C.treat.buyClose,
  },

  /* ── energy ← C.common ─────────────────────────────────────────── */
  energy: {
    title: C.common.energyTitle,
    body: C.common.dogNeverTired,
  },
});

export default { COMMANDS, BREEDS, TRAIN_COPY, CONFUSION, J, fillA, toA };
