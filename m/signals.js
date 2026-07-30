/* 멍스쿨 모바일 — 카밍 시그널 라이브러리
   각 신호는 교육 3요소(무엇이 보이는가 / 무슨 뜻인가 / 사람은 무엇을 해야 하는가)를 반드시 갖는다.
   pose(t, ex) 는 원화 아틀라스의 표정 키와 과장 계수를 돌려준다. ex=1 이면 표정 그대로,
   낮을수록 «편안함» 얼굴에 섞여 신호가 옅어진다 — 난이도 사다리.
   ★과장은 «얼마나»에만 건다. 신호의 종류와 방향은 실제 그대로. (아트 디렉션 스펙 v2) */

export const LEVELS = [
  { tier: 'ok',      label: '좋아요',   color: '#1E8C74' },
  { tier: 'caution', label: '주의',     color: '#D9832B' },
  { tier: 'stop',    label: '즉시 멈춤', color: '#C0392B' },
];


export const SIGNALS = [
  {
    id: 'relaxed', name: '편안함', tier: 'ok', emoji: '😌',
    see: '눈이 부드럽게 반달로 휘고 입이 살짝 벌어져 있어요',
    mean: '지금 마음이 편해요',
    todo: '하던 걸 계속해도 좋아요',
    pose: (t, ex) => ({ face: 'relaxed', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'curious', name: '관심', tier: 'ok', emoji: '👀',
    see: '귀가 앞으로 서고 눈이 커지며 고개를 갸웃해요',
    mean: '당신에게 관심이 있어요',
    todo: '천천히 다가가도 괜찮아요',
    pose: (t, ex) => ({ face: 'curious', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'lipLick', name: '입술 핥기', tier: 'caution', emoji: '👅',
    see: '혀가 코 쪽으로 짧게 훑고 지나가요',
    mean: '초기 스트레스 신호예요. 지금 조금 불편해요',
    todo: '하던 행동을 멈추고 기다려 주세요',
    pose: (t, ex) => ({ face: 'lipLick', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'yawn', name: '하품', tier: 'caution', emoji: '🥱',
    see: '졸리지 않은데 입을 크게 벌리고 눈을 감아요',
    mean: '긴장을 풀려는 초기 스트레스 신호예요',
    todo: '자극을 줄이고 잠시 거리를 두세요',
    pose: (t, ex) => ({ face: 'yawn', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'lookAway', name: '시선 돌리기', tier: 'caution', emoji: '↔️',
    see: '고개와 눈이 옆으로 크게 돌아가요',
    mean: '“조금 부담스러워요”라고 말하는 중이에요',
    todo: '정면으로 마주 보지 말고 거리를 두세요',
    pose: (t, ex) => ({ face: 'lookAway', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'whaleEye', name: '눈 흰자 보임', tier: 'stop', emoji: '😨',
    see: '고개는 그대로인데 눈만 옆으로 돌아 흰자가 보여요',
    mean: '강한 불편함이에요. 위협을 느끼고 있어요',
    todo: '지금 바로 물러나세요',
    pose: (t, ex) => ({ face: 'whaleEye', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'earsBack', name: '귀 뒤로', tier: 'caution', emoji: '📉',
    see: '귀가 납작하게 뒤로 눕고 몸이 낮아져요',
    mean: '불안하거나 겁이 나요',
    todo: '자극을 줄이고 낮은 자세로 기다려 주세요',
    pose: (t, ex) => ({ face: 'earsBack', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'snarl', name: '코 주름 · 이빨', tier: 'stop', emoji: '😠',
    see: '주둥이에 주름이 잡히고 이빨이 보여요',
    mean: '마지막 경고예요',
    todo: '즉시 모든 행동을 멈추고 물러나세요',
    pose: (t, ex) => ({ face: 'snarl', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'joy', name: '기쁨', tier: 'ok', emoji: '😄',
    see: '눈이 반달이 되고 입이 활짝 벌어지며 몸을 흔들어요',
    mean: '정말 즐거워요',
    todo: '함께 즐거워해 주세요',
    pose: (t, ex) => ({ face: 'joy', ex: ex == null ? 1 : ex }),
  },
  {
    id: 'panting', name: '지침 · 헐떡임', tier: 'caution', emoji: '😮‍💨',
    see: '혀를 길게 늘어뜨리고 빠르게 숨을 쉬어요',
    mean: '덥거나 지쳤거나 긴장했어요',
    todo: '그늘과 물을 주고 쉬게 해 주세요',
    pose: (t, ex) => ({ face: 'panting', ex: ex == null ? 1 : ex }),
  },
];

export const byId = id => SIGNALS.find(s => s.id === id);
export const tierOf = t => LEVELS.find(l => l.tier === t);
