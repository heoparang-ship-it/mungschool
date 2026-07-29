/* 멍스쿨 모바일 — 코스 구조
   신호 10종을 «점점 위험해지는 순서»로 유닛 4개에 배치한다.
   편안함부터 배우고, 마지막에 즉시 물러나야 하는 신호를 배운다.
   길은 레슨 → 보물상자 → 레슨 → 트로피로 이어지고, 앞의 노드를 끝내야 다음이 열린다. */

export const UNITS = [
  { key:'u1', no:'유닛 1', title:'편안한 신호',   hint:'괜찮을 때 개는 이렇게 말해요',
    color:'#1E8C74', soft:'#E4F5EF', signals:['relaxed','curious','joy'] },
  { key:'u2', no:'유닛 2', title:'불편의 시작',   hint:'가장 먼저 나오는 스트레스 신호',
    color:'#D9832B', soft:'#FDF0E0', signals:['lipLick','yawn','lookAway'] },
  { key:'u3', no:'유닛 3', title:'겁먹었을 때',   hint:'몸 전체로 말하는 불안',
    color:'#7C63C0', soft:'#EFEBFA', signals:['earsBack','panting'] },
  { key:'u4', no:'유닛 4', title:'즉시 멈춤',     hint:'여기서 물러나지 않으면 물립니다',
    color:'#C0392B', soft:'#FBE9E7', signals:['whaleEye','snarl'] },
];

export const XP_PER_RIGHT = 10;   // 정답 1개
export const XP_LESSON    = 20;   // 레슨 완주
export const XP_PERFECT   = 10;   // 만점 보너스
export const BONE_CHEST   = 15;   // 보물상자
export const BONE_TROPHY  = 30;   // 유닛 트로피

/** 길 위의 노드를 순서대로 만든다. 보물상자는 유닛의 두 번째 레슨 뒤에 온다. */
export function buildPath() {
  const nodes = [];
  UNITS.forEach((u, ui) => {
    u.signals.forEach((sid, li) => {
      nodes.push({ id:`${u.key}-l${li}`, type:'lesson', unit:u, ui, li, sig:sid,
                   label:`레슨 ${li+1}/${u.signals.length}` });
      if (li === 1) nodes.push({ id:`${u.key}-chest`, type:'chest', unit:u, ui,
                                 label:'보물상자', reward:BONE_CHEST });
    });
    nodes.push({ id:`${u.key}-trophy`, type:'trophy', unit:u, ui,
                 label:`${u.title} 완료`, reward:BONE_TROPHY });
  });
  nodes.forEach((n, i) => { n.idx = i; });
  const lessons = nodes.filter(n => n.type === 'lesson');
  lessons.forEach((n, i) => { n.depth = lessons.length > 1 ? i/(lessons.length-1) : 0; });
  return nodes;
}

export const PATH = buildPath();
export const TOTAL_LESSONS = PATH.filter(n => n.type === 'lesson').length;

/** 아직 끝내지 않은 첫 노드 = 지금 해야 할 것 */
export const currentIndex = done => {
  let i = 0;
  while (i < PATH.length && done.includes(PATH[i].id)) i++;
  return i;
};

/** 이 노드까지 왔을 때 이미 배운 신호들 — 문제 풀(pool)의 재료가 된다 */
export function unlockedSignals(done) {
  const out = [];
  for (const n of PATH) {
    if (n.type !== 'lesson') continue;
    if (done.includes(n.id)) { if (!out.includes(n.sig)) out.push(n.sig); }
  }
  return out;
}

/** 레슨 노드의 문제 풀: 이번 유닛에서 여기까지 배운 것 + 지난 유닛 복습 */
export function poolFor(node, done) {
  const learned = unlockedSignals(done);
  const upTo = node.unit.signals.slice(0, node.li + 1);      // 이번 유닛에서 지금까지
  const review = learned.filter(s => !upTo.includes(s));      // 지난 유닛 복습
  const pool = upTo.concat(review);
  // 첫 레슨은 재료가 1개뿐이라 변별이 안 된다 — 같은 유닛의 다음 신호를 미리 한 장 섞는다
  if (pool.length < 2) {
    const extra = node.unit.signals.filter(s => !pool.includes(s));
    if (extra.length) pool.push(extra[0]);
  }
  return pool;
}

/** 코스가 깊어질수록 과장을 걷어낸다 — 난이도 사다리 축 1 (코스 전체에 걸린다)
 *  i = 라운드 안에서의 문항 번호, depth = 코스에서의 진행도 0..1 */
export function exFor(i, roundLen, depth) {
  const hi = 1 - depth * 0.40;
  const lo = Math.max(0.12, 0.55 - depth * 0.43);
  return Math.max(lo, hi - i * ((hi - lo) / Math.max(1, roundLen - 1)));
}

/** 오늘의 퀘스트 — 하루가 바뀌면 초기화된다 */
export const QUESTS = [
  { id:'q_lesson', title:'훈련 1개 완료하기', goal:1,  bone:10, track:'lessons' },
  { id:'q_right',  title:'신호 8개 맞히기',   goal:8,  bone:15, track:'right'   },
  { id:'q_xp',     title:'XP 60 모으기',      goal:60, bone:20, track:'xp'      },
];
