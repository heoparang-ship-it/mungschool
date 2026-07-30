/* ============================================================================
 * voice.js — 멍스쿨 «훈련장» 음성 · 톤 · 흔들기 모듈   (에이전트 B 소유)
 * CONTRACTS.md §3 시그니처 준수 · 의존성 0 · ES 모듈 1개
 *
 * 설계 원칙 (MASTER §3-8, §3-9)
 *   · 온디바이스 전용: 오디오 버퍼는 프레임 수치(rms·pitch)로 즉시 환산 후 폐기.
 *     PCM을 배열에 쌓지 않는다. 저장·전송 API를 이 파일은 아예 참조하지 않는다.
 *   · listen()은 절대 reject 하지 않는다. 모든 실패는 status로.
 *   · supported는 동기·정직. 런타임에 «못 하는 것»이 드러나면 즉시 false로 내린다.
 *   · Node(브라우저 API 없음)에서도 import 가능해야 한다 → 모든 전역 접근은 함수 안에서.
 *
 * 순수 함수(analyzeFrame·framesFromPcm·scoreTone·matchVoice)는 CI 검증용으로 export.
 * ========================================================================== */

/* ── 0. 튜닝 상수 (SPIKE_REPORT.md의 실측·근거와 1:1) ───────────────────── */
export const TUNING = {
  // 톤 3요소
  LEN_MIN_S: 0.30,        // ① 발화 길이 하한
  LEN_MAX_S: 0.80,        // ① 발화 길이 상한
  TAIL_MS: 200,           // ② 끝 200ms 상승 검사 구간
  PITCH_RISE_RATIO: 1.08, // ② 뒷절반 피치가 앞절반 대비 8% 이상 오르면 질문 톤
  RMS_RISE_RATIO: 1.35,   // ② 피치를 못 잡을 때의 대체 판정(끝을 키움)
  // 발화 구간 검출
  HOP_MS: 16,             // 프레임 간격 (~60fps 폴링과 동일)
  WIN: 2048,              // 분석 창 (Analyser 기본 fftSize와 동일 — 실측값)
  GAP_MERGE_MS: 90,       // 이 이하의 무음은 한 발화 안의 숨/파열음으로 본다
  MIN_CLUSTER_MS: 70,     // 이보다 짧은 소리는 클릭·잡음으로 버린다
  VAD_OVER_NOISE: 3.0,    // 배경 대비 3배 넘으면 발화
  VAD_OF_PEAK: 0.18,      // 피크 대비 18% 넘으면 발화
  VAD_ABS: 0.010,         // 절대 하한 (완전 무음 방에서 유령 검출 방지)
  // 소음 가드
  PREROLL_MS: 500,        // 청취 직전 배경 소음 측정 구간
  NOISE_GATE_RMS: 0.045,  // 배경 RMS가 이보다 크면 톤 채점 보류
  MIN_SNR: 3.0,           // 발화 피크/배경 비가 이보다 작아도 보류
  // 피치 검출
  PITCH_MIN_HZ: 70,
  PITCH_MAX_HZ: 400,
  TARGET_ANALYSIS_HZ: 12000, // ACF 전 데시메이션 목표 (모바일 CPU 보호)
  // ASR
  LISTEN_TIMEOUT_MS: 7000,   // SR이 아무 이벤트도 안 줄 수 있다(실측) → 워치독 필수
  GUM_TIMEOUT_MS: 10000,     // 권한 다이얼로그 방치 시 gUM은 영구 pending(실측)
  EDIT_DISTANCE_MAX: 1,      // 유사 발음 허용 편집거리
  // 흔들기
  SHAKE_DELTA: 3.2,          // m/s² — 이 이상 순간 변화가 있으면 «흔드는 중»
  SHAKE_HOLD_MS: 260,        // 마지막 흔듦 후 이 시간까지는 계속 흔드는 것으로 인정
  SHAKE_SENSOR_WAIT_MS: 1200,// 이 시간 안에 이벤트가 0건이면 센서 없음으로 판정
  SHAKE_MAX_FACTOR: 3,       // 목표 시간의 3배가 지나면 포기(false)
};

const ZERO_TONE = Object.freeze({ len: 0, firm: 0, once: 0, measured: false });

/* ── 1. 문자열 / 유사 발음 매칭 (순수) ─────────────────────────────────── */

/** 공백·문장부호 제거, 소문자화. ASR 결과와 사전을 같은 판에 올린다. */
export function normalizeWord(s) {
  return String(s == null ? '' : s)
    .replace(/[\s.,!?~·…"'“”‘’()\[\]{}\-_]/g, '')
    .toLowerCase();
}

/**
 * 한글 음절 → 자모 배열 (겹받침 분해 포함).
 * ASR 오인식은 «음절»이 아니라 «자모» 한 개 차이인 경우가 많다.
 *   앉아 → ㅇㅏㄴㅈㅇㅏ(6) / 안자 → ㅇㅏㄴㅈㅏ(5)  → 자모 거리 1 (음절 거리는 2)
 */
export function toJamo(s) {
  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const JONG = ['','ㄱ','ㄲ','ㄱㅅ','ㄴ','ㄴㅈ','ㄴㅎ','ㄷ','ㄹ','ㄹㄱ','ㄹㅁ','ㄹㅂ','ㄹㅅ','ㄹㅌ','ㄹㅍ','ㄹㅎ','ㅁ','ㅂ','ㅂㅅ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c <= 11171) {
      out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
    } else out += ch;
  }
  return out;
}

/** 레벤슈타인 거리 (문자 단위. 한글 음절끼리 비교하면 음절 거리). */
export function editDistance(a, b) {
  a = normalizeWord(a); b = normalizeWord(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/**
 * 인식 문장에서 기대 발음 목록 중 하나를 찾는다.
 * 완전일치 → 부분포함 → 편집거리 ≤ EDIT_DISTANCE_MAX 순으로 관대해진다.
 * @returns {string|null} 사전에 적힌 표기(정규화 전 원본)
 */
export function matchVoice(transcript, voiceList) {
  const t = normalizeWord(transcript);
  if (!t || !Array.isArray(voiceList) || !voiceList.length) return null;
  const list = voiceList.filter((v) => typeof v === 'string' && v.length);
  for (const v of list) if (normalizeWord(v) === t) return v;
  for (const v of list) { const n = normalizeWord(v); if (n && t.includes(n)) return v; }
  // 조사·군더더기가 붙은 경우를 위해 문장을 어절로도 쪼개 본다
  const chunks = [t, ...String(transcript).split(/\s+/).map(normalizeWord)].filter(Boolean);
  let best = null, bestD = Infinity;
  for (const v of list) {
    const n = normalizeWord(v);
    if (!n) continue;
    const nJ = toJamo(n);
    // 음절 거리는 «두 글자 이상 단어»에서만, 자모 거리는 «자모 4개 이상»에서만 허용.
    // (한 글자 명령 «손»이 아무 데나 붙는 것을 막는다)
    const maxSyl = n.length >= 2 ? TUNING.EDIT_DISTANCE_MAX : 0;
    const maxJamo = nJ.length >= 4 ? TUNING.EDIT_DISTANCE_MAX : 0;
    for (const c of chunks) {
      const d = maxSyl ? editDistance(c, n) : Infinity;
      const dj = maxJamo ? editDistance(toJamo(c), nJ) : Infinity;
      const eff = Math.min(d <= maxSyl ? d : Infinity, dj <= maxJamo ? dj : Infinity);
      if (eff < bestD) { best = v; bestD = eff; }
    }
  }
  return bestD === Infinity ? null : best;
}

/* ── 2. 프레임 분석 (순수) ─────────────────────────────────────────────── */

/**
 * 시간영역 샘플 한 창(window)에서 RMS와 기본주파수를 뽑는다.
 * 브라우저(AnalyserNode)와 Node(합성 PCM)가 **같은 함수**를 쓴다 → CI 검증이 실물과 동치.
 * @param {Float32Array|Array<number>} buf  -1..1 시간영역 샘플
 * @param {number} sampleRate
 * @returns {{rms:number, pitch:number}} pitch=0 이면 무성/판정불가
 */
export function analyzeFrame(buf, sampleRate) {
  const n = buf.length;
  if (!n) return { rms: 0, pitch: 0 };
  let sum = 0, mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  for (let i = 0; i < n; i++) { const v = buf[i] - mean; sum += v * v; }
  const rms = Math.sqrt(sum / n);
  if (rms < TUNING.VAD_ABS * 0.5) return { rms, pitch: 0 };

  // 데시메이션 후 자기상관 (모바일 CPU 보호: 2048×566 → 512×141)
  const dec = Math.max(1, Math.floor(sampleRate / TUNING.TARGET_ANALYSIS_HZ));
  const sr = sampleRate / dec;
  const m = Math.floor(n / dec);
  if (m < 64) return { rms, pitch: 0 };
  const x = new Float32Array(m);
  for (let i = 0; i < m; i++) {          // 박스 평균으로 간이 안티에일리어싱
    let acc = 0;
    for (let k = 0; k < dec; k++) acc += buf[i * dec + k];
    x[i] = acc / dec - mean;
  }
  const lagMin = Math.max(2, Math.floor(sr / TUNING.PITCH_MAX_HZ));
  const lagMax = Math.min(m - 2, Math.ceil(sr / TUNING.PITCH_MIN_HZ));
  if (lagMax <= lagMin + 1) return { rms, pitch: 0 };

  let e0 = 0;
  for (let i = 0; i < m; i++) e0 += x[i] * x[i];
  if (e0 <= 0) return { rms, pitch: 0 };

  let bestLag = -1, bestVal = 0;
  const acf = new Float32Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0, e1 = 0;
    const lim = m - lag;
    for (let i = 0; i < lim; i++) { s += x[i] * x[i + lag]; e1 += x[i + lag] * x[i + lag]; }
    const norm = Math.sqrt((e0 || 1) * (e1 || 1));
    const v = norm > 0 ? s / norm : 0;
    acf[lag] = v;
    if (v > bestVal) { bestVal = v; bestLag = lag; }
  }
  if (bestLag < 0 || bestVal < 0.35) return { rms, pitch: 0 }; // 무성음/잡음
  // 포물선 보간으로 lag 정밀화
  const yl = acf[bestLag - 1] || 0, y0 = acf[bestLag], yr = acf[bestLag + 1] || 0;
  const denom = (yl - 2 * y0 + yr);
  const shift = denom !== 0 ? (0.5 * (yl - yr)) / denom : 0;
  const lag = bestLag + (Math.abs(shift) < 1 ? shift : 0);
  const pitch = lag > 0 ? sr / lag : 0;
  return { rms, pitch: pitch >= TUNING.PITCH_MIN_HZ && pitch <= TUNING.PITCH_MAX_HZ ? pitch : 0 };
}

/**
 * 연속 PCM → 프레임 배열. (Node 합성 검증용. 브라우저는 폴링으로 같은 모양을 만든다.)
 * @returns {Array<{t:number, rms:number, pitch:number}>} t는 창 중앙 시각(초)
 */
export function framesFromPcm(pcm, sampleRate, opts = {}) {
  const win = opts.win || TUNING.WIN;
  const hop = Math.max(1, Math.round((opts.hopMs || TUNING.HOP_MS) * sampleRate / 1000));
  const out = [];
  const scratch = new Float32Array(win);
  for (let start = 0; start + win <= pcm.length; start += hop) {
    for (let i = 0; i < win; i++) scratch[i] = pcm[start + i];
    const f = analyzeFrame(scratch, sampleRate);
    out.push({ t: (start + win / 2) / sampleRate, rms: f.rms, pitch: f.pitch });
  }
  scratch.fill(0);
  return out;
}

/* ── 3. 톤 채점 (순수) — 훈련장_풀플로우_v2 §6 ─────────────────────────── */

function median(arr) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((p, q) => p - q);
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
}

/**
 * 발화 클러스터 검출. 프레임 배열 → [{s,e}] (초)
 * @returns {{clusters:Array<{s:number,e:number}>, floor:number, peak:number, thr:number}}
 */
export function detectClusters(frames, opts = {}) {
  const rmsAll = frames.map((f) => f.rms);
  const peak = rmsAll.length ? Math.max(...rmsAll) : 0;
  const floor = opts.noiseFloor != null ? opts.noiseFloor : percentile(rmsAll, 0.20);
  const thr = Math.max(floor * TUNING.VAD_OVER_NOISE, peak * TUNING.VAD_OF_PEAK, TUNING.VAD_ABS);
  const hop = frames.length > 1 ? frames[1].t - frames[0].t : TUNING.HOP_MS / 1000;

  const raw = [];
  let cur = null;
  for (const f of frames) {
    if (f.rms >= thr) { if (!cur) cur = { s: f.t, e: f.t }; else cur.e = f.t; }
    else if (cur) { raw.push(cur); cur = null; }
  }
  if (cur) raw.push(cur);

  // 짧은 무음 병합 → 짧은 파편 제거
  const merged = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last && (c.s - last.e) * 1000 <= TUNING.GAP_MERGE_MS) last.e = c.e;
    else merged.push({ ...c });
  }
  const clusters = merged.filter((c) => (c.e - c.s + hop) * 1000 >= TUNING.MIN_CLUSTER_MS);
  return { clusters, floor, peak, thr, hop };
}

/**
 * 톤 3요소 채점.
 *   ① len  : 발화 전체 길이 0.30~0.80초
 *   ② firm : 마지막 발화의 끝 200ms에서 피치/RMS 상승 없음 (질문 톤 아님)
 *   ③ once : 발화 클러스터가 정확히 1개 (반복해서 부르지 않음)
 * @param {Array<{t,rms,pitch}>} frames
 * @param {{noiseFloor?:number, gated?:boolean}} opts  gated=true면 소음으로 이미 보류 확정
 * @returns {{len:0|1, firm:0|1, once:0|1, measured:boolean}}
 */
export function scoreTone(frames, opts = {}) {
  if (!Array.isArray(frames) || frames.length < 4) return { ...ZERO_TONE };
  const { clusters, floor, peak, hop } = detectClusters(frames, opts);

  // 소음 가드: 배경이 시끄럽거나 신호 대 배경비가 낮으면 «측정 보류».
  // 단, 아예 아무 소리도 없는 «조용한 무발화»는 소음이 아니라 무음이다 → 보류가 아니라 0점.
  const speechPresent = peak >= TUNING.VAD_ABS;
  const gated = !!opts.gated
    || floor > TUNING.NOISE_GATE_RMS
    || (speechPresent && floor > 0 && peak / floor < TUNING.MIN_SNR);
  if (gated) return { ...ZERO_TONE };
  // 발화를 하나도 못 잡았다 = 채점할 근거가 없다. 0점이 아니라 «보류».
  // (아주 작은 목소리·마이크 경로 실패를 감점으로 돌려주지 않는다 — MASTER §3-9)
  if (!clusters.length) return { ...ZERO_TONE };

  const once = clusters.length === 1 ? 1 : 0;
  const span = clusters[clusters.length - 1].e - clusters[0].s + hop;
  const len = span >= TUNING.LEN_MIN_S && span <= TUNING.LEN_MAX_S ? 1 : 0;

  // ② 끝 200ms: 앞절반 vs 뒷절반 비교
  const last = clusters[clusters.length - 1];
  const tailStart = Math.max(last.s, last.e - TUNING.TAIL_MS / 1000);
  const tail = frames.filter((f) => f.t >= tailStart - 1e-9 && f.t <= last.e + 1e-9);
  let firm = 1;
  if (tail.length >= 4) {
    const mid = Math.floor(tail.length / 2);
    const a = tail.slice(0, mid), b = tail.slice(mid);
    const pa = median(a.filter((f) => f.pitch > 0).map((f) => f.pitch));
    const pb = median(b.filter((f) => f.pitch > 0).map((f) => f.pitch));
    const ra = a.reduce((s, f) => s + f.rms, 0) / a.length;
    const rb = b.reduce((s, f) => s + f.rms, 0) / b.length;
    const pitchRise = pa > 0 && pb > 0 && pb / pa >= TUNING.PITCH_RISE_RATIO;
    const rmsRise = ra > 0 && rb / ra >= TUNING.RMS_RISE_RATIO;
    if (pitchRise || rmsRise) firm = 0;
  }
  return { len, firm, once, measured: true };
}

/* ── 4. 기능 감지 (동기·정직) ──────────────────────────────────────────── */

function W() { return typeof window !== 'undefined' ? window : null; }

function getSRCtor() {
  const w = W();
  if (!w) return null;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function detectSupport() {
  const w = W();
  if (!w) return { asr: false, tone: false, shake: false };
  const secure = w.isSecureContext !== false;
  const nav = w.navigator || {};
  const AC = w.AudioContext || w.webkitAudioContext || null;
  const gum = !!(nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
  // 모션: 이벤트 존재 ≠ 센서 존재(헤드리스 데스크톱도 true였다 — 실측).
  // 터치 포인터를 센서 유무의 대리 지표로 쓴다. 최종 판정은 shake() 첫 이벤트 타임아웃.
  const hasMotion = 'DeviceMotionEvent' in w;
  const coarse = (nav.maxTouchPoints || 0) > 0
    || (typeof w.matchMedia === 'function' && w.matchMedia('(pointer:coarse)').matches);
  return {
    asr: !!getSRCtor() && secure,
    tone: gum && !!AC && secure,
    shake: hasMotion && coarse,
  };
}

/* ── 5. createVoice — CONTRACTS §3 ─────────────────────────────────────── */

export function createVoice(opts = {}) {
  const lang = opts.lang || 'ko-KR';
  const onState = typeof opts.onState === 'function' ? opts.onState : () => {};
  // (계약 추가 제안 — 선택. 없어도 전부 동작한다)
  const otherVoices = Array.isArray(opts.otherVoices) ? opts.otherVoices : null;
  const log = typeof opts.onDebug === 'function' ? opts.onDebug : null;

  const supported = detectSupport();
  const w = W();

  let disposed = false;
  let state = 'idle';
  let stream = null;        // MediaStream (재사용)
  let ac = null;            // AudioContext
  let srcNode = null, analyser = null;
  let scratch = null;       // ★ 유일한 오디오 버퍼. 매 폴링 덮어쓰고 종료 시 0으로 채운 뒤 버린다.
  let pollTimer = null;
  let rec = null;           // SpeechRecognition
  let activeListen = null;  // 진행 중 listen의 취소 훅

  function setState(s) { if (state !== s) { state = s; try { onState(s); } catch (_) {} } }
  function dbg(...a) { if (log) { try { log(...a); } catch (_) {} } }

  /* --- 5-1. 마이크 권한 -------------------------------------------------- */

  async function queryMicPermission() {
    if (!w || !w.navigator || !w.navigator.permissions) return 'unknown';
    try {
      const st = await w.navigator.permissions.query({ name: 'microphone' });
      return st && st.state ? st.state : 'unknown';   // 'granted'|'denied'|'prompt'
    } catch (_) { return 'unknown'; }                  // 일부 브라우저는 TypeError
  }

  function withTimeout(promise, ms, fallback) {
    let to;
    return Promise.race([
      Promise.resolve(promise).then((v) => { clearTimeout(to); return v; },
        (e) => { clearTimeout(to); throw e; }),
      new Promise((res) => { to = setTimeout(() => res(fallback), ms); }),
    ]);
  }

  async function ensureStream() {
    if (!supported.tone) return null;
    if (stream && stream.active !== false) return stream;
    const nav = w.navigator;
    try {
      // 권한 다이얼로그를 방치하면 gUM은 영구 pending 이다(실측) → 반드시 타임아웃.
      const got = await withTimeout(
        nav.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        }),
        TUNING.GUM_TIMEOUT_MS, '__timeout__');
      if (got === '__timeout__') { dbg('gum:timeout'); return null; }
      stream = got;
    } catch (e) {
      dbg('gum:error', e && e.name);
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        supported.asr = false; supported.tone = false;   // 정직하게 내린다
      }
      return null;
    }
    const AC = w.AudioContext || w.webkitAudioContext;
    try {
      ac = ac || new AC();
      if (ac.state === 'suspended') { try { await ac.resume(); } catch (_) {} }
      srcNode = ac.createMediaStreamSource(stream);
      analyser = ac.createAnalyser();
      analyser.fftSize = TUNING.WIN;
      analyser.smoothingTimeConstant = 0;
      srcNode.connect(analyser);        // destination 연결 불필요(실측) — 하울링 방지
      scratch = new Float32Array(analyser.fftSize);
    } catch (e) { dbg('audioctx:error', e && e.message); supported.tone = false; return null; }
    return stream;
  }

  async function primeMic() {
    const pre = await queryMicPermission();
    if (pre === 'denied') { supported.asr = false; supported.tone = false; return 'denied'; }
    if (!supported.tone && !supported.asr) return 'denied';
    const s = await ensureStream();
    return s ? 'granted' : 'denied';
  }

  /* --- 5-2. 프레임 수집기 (버퍼 비저장의 핵심) ---------------------------- */

  function startPolling(sink) {
    if (!analyser || !scratch) return () => {};
    const sr = (ac && ac.sampleRate) || 48000;
    const t0 = (w.performance || Date).now();
    const tick = () => {
      if (!analyser || !scratch) return;
      analyser.getFloatTimeDomainData(scratch);     // ← 매번 같은 배열을 덮어쓴다
      const f = analyzeFrame(scratch, sr);          // ← 즉시 숫자 2개로 환산
      sink({ t: ((w.performance || Date).now() - t0) / 1000, rms: f.rms, pitch: f.pitch });
      // scratch의 내용은 다음 tick에서 전부 덮어써진다. 어디에도 복사하지 않는다.
    };
    pollTimer = setInterval(tick, TUNING.HOP_MS);
    return () => { clearInterval(pollTimer); pollTimer = null; };
  }

  async function measureNoiseFloor() {
    if (!analyser) return null;
    try {
      const frames = [];
      const stop = startPolling((f) => frames.push(f));
      await new Promise((r) => setTimeout(r, TUNING.PREROLL_MS));
      stop();
      if (!frames.length) return null;
      return percentile(frames.map((f) => f.rms), 0.5);
    } catch (e) { dbg('noisefloor:error', e && e.message); return null; }  // 예외를 위로 올리지 않는다
  }

  /* --- 5-3. listen — 절대 reject 하지 않는다 ----------------------------- */

  function listen(expectVoiceList, listenOpts = {}) {
    // ★ 이 함수는 throw 하거나 reject 하는 경로가 없다.
    //   내부 전 구간을 try/catch로 감싸고, 실패는 전부 status로 환원한다.
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status, word, tone) => {
        if (settled) return;
        settled = true;
        cleanup();
        setState('idle');
        resolve({ status, word: word || null, tone: tone || { ...ZERO_TONE } });
      };

      let stopPoll = () => {};
      let watchdog = null;
      let localRec = null;
      let frames = [];
      let noiseFloor = null;
      let gated = false;

      function cleanup() {
        try { stopPoll(); } catch (_) {}
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        if (localRec) {
          try { localRec.onresult = localRec.onerror = localRec.onend = localRec.onstart = null; } catch (_) {}
          try { localRec.abort(); } catch (_) {}
          if (rec === localRec) rec = null;
          localRec = null;
        }
        frames = [];                       // 프레임 수치도 남기지 않는다
        activeListen = null;
      }
      activeListen = () => finish('nohear', null, { ...ZERO_TONE });

      (async () => {
        try {
          if (disposed) return finish('nohear');
          const expect = Array.isArray(expectVoiceList) ? expectVoiceList : [expectVoiceList];

          if (!supported.asr) return finish('nohear');   // 호출측이 🎙을 숨기는 것이 정상 경로

          // (a) 톤 준비 + 배경 소음 측정 (실패해도 인식은 계속한다)
          if (supported.tone) {
            const s = await ensureStream();
            if (s) {
              noiseFloor = await measureNoiseFloor();
              if (noiseFloor != null && noiseFloor > TUNING.NOISE_GATE_RMS) gated = true;
            }
          }
          if (disposed || settled) return;

          // (b) 인식 시작
          setState('listening');
          const SR = getSRCtor();
          if (!SR) return finish('nohear');
          try {
            localRec = new SR();
            rec = localRec;
            localRec.lang = listenOpts.lang || lang;
            localRec.continuous = false;
            localRec.interimResults = true;
            localRec.maxAlternatives = 3;
          } catch (e) { dbg('sr:ctor', e && e.message); supported.asr = false; return finish('nohear'); }

          if (analyser) stopPoll = startPolling((f) => { if (frames.length < 1200) frames.push(f); });

          let heard = '';
          let gotStart = false;
          // 아무것도 못 들었을 때: 배경이 시끄러웠다면 «못 들었다»보다 «시끄러웠다»가 정확하다
          const nothingHeard = () => finish(gated ? 'noise' : 'nohear');

          localRec.onstart = () => { gotStart = true; };
          localRec.onresult = (ev) => {
            try {
              for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const r = ev.results[i];
                for (let k = 0; k < r.length; k++) {
                  const alt = r[k] && r[k].transcript;
                  if (alt) heard = (heard + ' ' + alt).trim();
                }
                if (r.isFinal) { score(heard); return; }
              }
            } catch (_) { /* 파싱 실패도 status로 */ }
          };
          localRec.onerror = (ev) => {
            const code = (ev && ev.error) || 'unknown';
            dbg('sr:error', code, 'gotStart=', gotStart);
            if (code === 'not-allowed' || code === 'service-not-allowed') {
              supported.asr = false;                    // 재요청으로 조르지 않는다
              return finish('nohear');
            }
            if (code === 'audio-capture') { supported.tone = false; return finish('nohear'); }
            if (code === 'no-speech' || code === 'aborted') return nothingHeard();
            return nothingHeard();                      // network 등 — 사용자 불이익 없음
          };
          localRec.onend = () => { if (!settled) { if (heard) score(heard); else nothingHeard(); } };

          function score(text) {
            if (settled) return;
            setState('scoring');
            let tone = { ...ZERO_TONE };
            try {
              tone = scoreTone(frames, { noiseFloor, gated });
            } catch (e) { dbg('tone:error', e && e.message); tone = { ...ZERO_TONE }; }
            const hit = matchVoice(text, expect);
            if (hit) return finish('ok', hit, tone);
            if (otherVoices) {
              const other = matchVoice(text, otherVoices);
              return finish('other', other || text.trim() || null, tone);
            }
            const t = String(text || '').trim();
            return t ? finish('other', t, tone) : nothingHeard();
          }

          // (c) 워치독 — SR이 아무 이벤트도 안 주고 멈추는 경우가 실재한다(실측)
          watchdog = setTimeout(() => {
            if (settled) return;
            if (heard) score(heard);
            else nothingHeard();
          }, listenOpts.timeoutMs || TUNING.LISTEN_TIMEOUT_MS);

          try { localRec.start(); }
          catch (e) { dbg('sr:start', e && e.message); return finish('nohear'); }
        } catch (e) {
          dbg('listen:fatal', e && e.message);
          finish('nohear');                     // ★ 어떤 예외도 reject로 새어 나가지 않는다
        }
      })();
    });
  }

  function stopListen() {
    try { if (rec) rec.stop(); } catch (_) {}
    if (activeListen) { const f = activeListen; activeListen = null; try { f(); } catch (_) {} }
    setState('idle');
  }

  /* --- 5-4. shake — DeviceMotion 누적 ------------------------------------ */

  function shake(seconds, onProgress) {
    const target = Math.max(0.5, Number(seconds) || 5);
    const report = typeof onProgress === 'function' ? onProgress : () => {};
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        try { w && w.removeEventListener('devicemotion', onMotion); } catch (_) {}
        clearInterval(ticker);
        try { report(ok ? 100 : Math.min(99, Math.round((active / target) * 100))); } catch (_) {}
        resolve(!!ok);
      };
      if (!w || !('DeviceMotionEvent' in w)) return resolve(false);

      let events = 0, active = 0, lastMag = null, lastShakeAt = 0, tPrev = 0;
      const started = Date.now();

      function onMotion(ev) {
        events++;
        const a = ev.accelerationIncludingGravity || ev.acceleration;
        if (!a) return;
        const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
        if (lastMag != null && Math.abs(mag - lastMag) >= TUNING.SHAKE_DELTA) lastShakeAt = Date.now();
        lastMag = mag;
      }
      const ticker = setInterval(() => {
        const now = Date.now();
        const dt = tPrev ? (now - tPrev) / 1000 : 0;
        tPrev = now;
        if (now - lastShakeAt <= TUNING.SHAKE_HOLD_MS) active += dt;
        try { report(Math.min(100, Math.round((active / target) * 100))); } catch (_) {}
        if (active >= target) return finish(true);
        // 센서가 애초에 없으면(데스크톱) 이벤트 0건으로 조기 판정 → 연타 폴백으로 즉시 전환
        if (events === 0 && now - started > TUNING.SHAKE_SENSOR_WAIT_MS) return finish(false);
        if (now - started > target * 1000 * TUNING.SHAKE_MAX_FACTOR) return finish(false);
      }, 100);

      (async () => {
        try {
          const DME = w.DeviceMotionEvent;
          if (typeof DME.requestPermission === 'function') {   // iOS 13+ (사용자 제스처 안에서 호출돼야 함)
            let res = 'denied';
            try { res = await DME.requestPermission(); } catch (e) { res = 'denied'; }
            if (res !== 'granted') { supported.shake = false; return finish(false); }
          }
          w.addEventListener('devicemotion', onMotion, { passive: true });
        } catch (_) { finish(false); }
      })();
    });
  }

  /* --- 5-5. dispose ------------------------------------------------------ */

  function dispose() {
    disposed = true;
    stopListen();
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (scratch) { scratch.fill(0); scratch = null; }        // 마지막 창까지 0으로 지운다
    try { if (srcNode) srcNode.disconnect(); } catch (_) {}
    srcNode = null; analyser = null;
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    stream = null;
    try { if (ac && ac.state !== 'closed') ac.close(); } catch (_) {}
    ac = null;
    setState('idle');
  }

  return {
    supported,
    primeMic,
    listen,
    stopListen,
    shake,
    dispose,
    // — 부가(계약 외, 호출측 선택 사용) —
    queryMicPermission,
    get state() { return state; },
  };
}

export default createVoice;
