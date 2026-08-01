export type Side = "banker" | "player";
export type Outcome = Side | "tie";

export interface Card {
  rank: number;
  suit: "club" | "diamond" | "heart" | "spade";
}

export interface RoundResult {
  id: number;
  outcome: Outcome;
  bankerCards: Card[];
  playerCards: Card[];
  bankerPoints: number;
  playerPoints: number;
  natural: boolean;
}

export interface RoadCell {
  row: number;
  column: number;
  outcome: Side;
  ties: number;
  roundIndex: number;
}

export interface BeadCell {
  row: number;
  column: number;
  outcome: Outcome;
}

export type DerivedRoadColor = "red" | "blue";

export interface DerivedRoadCell {
  row: number;
  column: number;
  color: DerivedRoadColor;
  roundIndex: number;
}

export interface DerivedRoads {
  bigEye: DerivedRoadCell[];
  small: DerivedRoadCell[];
  cockroach: DerivedRoadCell[];
}

export type PatternId = "long-banker" | "long-player" | "ping-pong" | "none";

export interface PatternInfo {
  id: PatternId;
  name: string;
  favored: Side | null;
  worldShift: number;
  skillShift: number;
}

export interface ProbabilityInfo {
  banker: number;
  player: number;
  tie: number;
  pattern: PatternInfo;
}

export type DerivedRoadBook = "big-eye" | "small" | "cockroach";
export type RoadBook = "bead" | "big" | DerivedRoadBook;

export interface ConfidenceRoadPattern {
  id: string;
  name: string;
  prediction: Side;
  length: number;
  source: "universal" | RoadBook;
}

export interface Rng {
  next(): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function cardValue(card: Card): number {
  return card.rank >= 10 ? 0 : card.rank;
}

export function handPoints(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;
}

export function playerShouldDraw(points: number): boolean {
  return points <= 5;
}

export function bankerShouldDraw(points: number, playerThirdValue: number | null): boolean {
  if (playerThirdValue === null) return points <= 5;
  return points <= 2
    || (points === 3 && playerThirdValue !== 8)
    || (points === 4 && playerThirdValue >= 2 && playerThirdValue <= 7)
    || (points === 5 && playerThirdValue >= 4 && playerThirdValue <= 7)
    || (points === 6 && playerThirdValue >= 6 && playerThirdValue <= 7);
}

export type BaccaratRevealForecast =
  | { kind: "outcome"; outcome: Outcome }
  | { kind: "draw"; side: Side }
  | { kind: "pending" };

export function forecastBaccaratReveal(
  playerValues: readonly (number | null)[],
  bankerValues: readonly (number | null)[],
  revealSide: Side,
  handIndex: number,
  value: number,
): BaccaratRevealForecast {
  const player = [playerValues[0] ?? null, playerValues[1] ?? null, playerValues[2] ?? null];
  const banker = [bankerValues[0] ?? null, bankerValues[1] ?? null, bankerValues[2] ?? null];
  (revealSide === "player" ? player : banker)[handIndex] = value;
  if (player[0] === null || player[1] === null || banker[0] === null || banker[1] === null) return { kind: "pending" };

  const initialPlayer = (player[0] + player[1]) % 10;
  const initialBanker = (banker[0] + banker[1]) % 10;
  const outcome = (playerPoints: number, bankerPoints: number): BaccaratRevealForecast => ({
    kind: "outcome",
    outcome: playerPoints === bankerPoints ? "tie" : playerPoints > bankerPoints ? "player" : "banker",
  });

  if (initialPlayer >= 8 || initialBanker >= 8) return outcome(initialPlayer, initialBanker);

  if (playerShouldDraw(initialPlayer)) {
    if (player[2] === null) return { kind: "draw", side: "player" };
    const playerPoints = (initialPlayer + player[2]) % 10;
    if (bankerShouldDraw(initialBanker, player[2])) {
      if (banker[2] === null) return { kind: "draw", side: "banker" };
      return outcome(playerPoints, (initialBanker + banker[2]) % 10);
    }
    return outcome(playerPoints, initialBanker);
  }

  if (bankerShouldDraw(initialBanker, null)) {
    if (banker[2] === null) return { kind: "draw", side: "banker" };
    return outcome(initialPlayer, (initialBanker + banker[2]) % 10);
  }
  return outcome(initialPlayer, initialBanker);
}

const suits: Card["suit"][] = ["club", "diamond", "heart", "spade"];

function randomCard(rng: Rng): Card {
  return {
    rank: Math.floor(rng.next() * 13) + 1,
    suit: suits[Math.floor(rng.next() * suits.length)] ?? "spade",
  };
}

export function dealRound(rng: Rng, id: number): RoundResult {
  const playerCards = [randomCard(rng), randomCard(rng)];
  const bankerCards = [randomCard(rng), randomCard(rng)];
  const initialPlayer = handPoints(playerCards);
  const initialBanker = handPoints(bankerCards);
  const natural = initialPlayer >= 8 || initialBanker >= 8;

  if (!natural) {
    let playerThird: number | null = null;
    if (playerShouldDraw(initialPlayer)) {
      const third = randomCard(rng);
      playerCards.push(third);
      playerThird = cardValue(third);
    }

    const banker = handPoints(bankerCards);
    if (bankerShouldDraw(banker, playerThird)) bankerCards.push(randomCard(rng));
  }

  const playerPoints = handPoints(playerCards);
  const bankerPoints = handPoints(bankerCards);
  const outcome: Outcome = bankerPoints === playerPoints
    ? "tie"
    : bankerPoints > playerPoints ? "banker" : "player";

  return { id, outcome, bankerCards, playerCards, bankerPoints, playerPoints, natural };
}

function legalRoundCardCandidates(result: RoundResult, side: Side, handIndex: number): RoundResult[] {
  const originalHand = side === "player" ? result.playerCards : result.bankerCards;
  const original = originalHand[handIndex];
  if (!original) return [];
  const candidates: RoundResult[] = [];

  for (let rank = 1; rank <= 13; rank += 1) {
    const playerCards = result.playerCards.map((card) => ({ ...card }));
    const bankerCards = result.bankerCards.map((card) => ({ ...card }));
    const hand = side === "player" ? playerCards : bankerCards;
    hand[handIndex] = { rank, suit: original.suit };
    const initialPlayer = handPoints(playerCards.slice(0, 2));
    const initialBanker = handPoints(bankerCards.slice(0, 2));
    const natural = initialPlayer >= 8 || initialBanker >= 8;
    const playerDraws = !natural && playerShouldDraw(initialPlayer);
    if (playerCards.length !== (playerDraws ? 3 : 2)) continue;
    const playerThird = playerDraws ? cardValue(playerCards[2]!) : null;
    const bankerDraws = !natural && bankerShouldDraw(initialBanker, playerThird);
    if (bankerCards.length !== (bankerDraws ? 3 : 2)) continue;
    const playerPoints = handPoints(playerCards);
    const bankerPoints = handPoints(bankerCards);
    const outcome: Outcome = bankerPoints === playerPoints ? "tie" : bankerPoints > playerPoints ? "banker" : "player";
    candidates.push({ ...result, playerCards, bankerCards, playerPoints, bankerPoints, outcome, natural });
  }

  return candidates;
}

export interface DivineCallInfo {
  word: string;
  meaning: string;
  successfulValues: number[];
}

export function divineCallForRound(result: RoundResult, side: Side, handIndex: number, target: Outcome): DivineCallInfo {
  const candidates = legalRoundCardCandidates(result, side, handIndex);
  const successful = candidates.filter((candidate) => candidate.outcome === target);
  const handFor = (candidate: RoundResult) => side === "player" ? candidate.playerCards : candidate.bankerCards;
  const valuesFor = (rounds: RoundResult[]) => rounds.map((candidate) => cardValue(handFor(candidate)[handIndex]!));
  const successfulValues = [...new Set(valuesFor(successful))].sort((a, b) => a - b);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const targetName = target === "banker" ? "庄" : target === "player" ? "闲" : "和";
  const pointText = successfulValues.length ? successfulValues.join("、") : "可胜";

  if (successfulValues.length === 1 && successfulValues[0] === 0) {
    return { word: "公！", meaning: `要公仔零点，让押${targetName}获胜`, successfulValues };
  }
  if (successfulValues.length === 1 && (successfulValues[0] === 8 || successfulValues[0] === 9)) {
    const point = successfulValues[0] === 8 ? "八" : "九";
    return { word: `${point}！`, meaning: `要${point}点，让押${targetName}获胜`, successfulValues };
  }
  if (average(successfulValues) >= 4.5) {
    return { word: "吸！", meaning: `要${pointText}点，吸出能让押${targetName}获胜的牌`, successfulValues };
  }
  return { word: "吹！", meaning: `要${pointText}点，吹出能让押${targetName}获胜的牌`, successfulValues };
}

export function retargetRoundCard(
  result: RoundResult,
  side: Side,
  handIndex: number,
  target: Outcome,
  shouldMatch: boolean,
  roll = 0,
): boolean {
  const candidates = legalRoundCardCandidates(result, side, handIndex)
    .filter((candidate) => (candidate.outcome === target) === shouldMatch);

  if (!candidates.length) return false;
  const selected = candidates[Math.min(Math.floor(roll * candidates.length), candidates.length - 1)]!;
  Object.assign(result, selected);
  return result.outcome === target;
}

const oppositeSide = (side: Side): Side => side === "banker" ? "player" : "banker";

function sideOutcomes(history: RoundResult[]): Side[] {
  return history.filter((round) => round.outcome !== "tie").map((round) => round.outcome as Side);
}

function trailingAlternationLength(sides: Side[]): number {
  if (!sides.length) return 0;
  let length = 1;
  for (let index = sides.length - 1; index > 0 && sides[index] !== sides[index - 1]; index -= 1) length += 1;
  return length;
}

function trailingSameLength(sides: Side[]): number {
  const last = sides.at(-1);
  if (!last) return 0;
  let length = 0;
  for (let index = sides.length - 1; index >= 0 && sides[index] === last; index -= 1) length += 1;
  return length;
}

function transitionRoad(sides: Side[], subject: Side, connects: boolean): ConfidenceRoadPattern | null {
  if (sides.length < 4 || sides.at(-1) !== subject) return null;
  let start = sides.length - 1;
  let confirmations = 0;
  for (let index = sides.length - 2; index >= 0; index -= 1) {
    if (sides[index] === subject) {
      const matched = (sides[index + 1] === subject) === connects;
      if (!matched) break;
      confirmations += 1;
    }
    start = index;
  }
  const span = sides.length - start;
  if (span < 4 || confirmations < 2) return null;
  const subjectName = subject === "banker" ? "庄" : "闲";
  return {
    id: `on-${subject}-${connects ? "connect" : "break"}`,
    name: `逢${subjectName}${connects ? "连" : "不连"}`,
    prediction: connects ? subject : oppositeSide(subject),
    length: Math.max(1, span - 3),
    source: "universal",
  };
}

function cappedRoad(sides: Side[], subject: Side): ConfidenceRoadPattern | null {
  if (sides.at(-1) !== subject) return null;
  const runs: { side: Side; count: number }[] = [];
  for (const side of sides) {
    const last = runs.at(-1);
    if (last?.side === side) last.count += 1;
    else runs.push({ side, count: 1 });
  }
  const current = runs.at(-1)!;
  const previous = runs.slice(0, -1).filter((run) => run.side === subject);
  if (previous.length < 2) return null;
  const cap = Math.max(...previous.map((run) => run.count));
  if (current.count !== cap) return null;
  const subjectName = subject === "banker" ? "庄" : "闲";
  return {
    id: `${subject}-cap-${cap}`,
    name: `${subjectName}不长过${cap}口`,
    prediction: oppositeSide(subject),
    length: Math.max(1, previous.length - 1),
    source: "universal",
  };
}

function universalConfidenceRoads(history: RoundResult[]): ConfidenceRoadPattern[] {
  const sides = sideOutcomes(history);
  const patterns: ConfidenceRoadPattern[] = [];
  const last = sides.at(-1);
  if (!last) return patterns;
  const streak = trailingSameLength(sides);
  if (streak >= 5) {
    patterns.push({
      id: `long-${last}`,
      name: last === "banker" ? "长庄" : "长闲",
      prediction: last,
      length: streak - 4,
      source: "universal",
    });
  }
  const alternation = trailingAlternationLength(sides);
  if (alternation >= 6) {
    patterns.push({
      id: "single-jump",
      name: "单跳",
      prediction: oppositeSide(last),
      length: 1 + Math.floor((alternation - 6) / 2),
      source: "universal",
    });
  }
  for (const subject of ["banker", "player"] as const) {
    for (const connects of [true, false]) {
      const pattern = transitionRoad(sides, subject, connects);
      if (pattern) patterns.push(pattern);
    }
    const cap = cappedRoad(sides, subject);
    if (cap) patterns.push(cap);
  }
  return patterns;
}

function beadConfidenceRoads(history: RoundResult[]): ConfidenceRoadPattern[] {
  const nextIndex = history.length;
  const sameRow: Outcome[] = [];
  for (let index = nextIndex - 6; index >= 0; index -= 6) {
    const outcome = history[index]?.outcome;
    if (outcome) sameRow.push(outcome);
  }
  const patterns: ConfidenceRoadPattern[] = [];
  const latest = sameRow[0];
  if (!latest || latest === "tie") return patterns;
  let same = 0;
  while (same < sameRow.length && sameRow[same] === latest) same += 1;
  if (same >= 4) {
    patterns.push({
      id: `diamond-${latest}`,
      name: `金刚${latest === "banker" ? "庄" : "闲"}`,
      prediction: latest,
      length: same - 3,
      source: "bead",
    });
  }
  let alternating = 1;
  while (alternating < sameRow.length
    && sameRow[alternating] !== "tie"
    && sameRow[alternating] !== sameRow[alternating - 1]) alternating += 1;
  if (alternating >= 4) {
    patterns.push({
      id: "bead-single-jump",
      name: "珠盘路单跳",
      prediction: oppositeSide(latest),
      length: alternating - 3,
      source: "bead",
    });
  }
  return patterns;
}

function runLengths(history: RoundResult[]): { side: Side; count: number }[] {
  const runs: { side: Side; count: number }[] = [];
  for (const side of sideOutcomes(history)) {
    const last = runs.at(-1);
    if (last?.side === side) last.count += 1;
    else runs.push({ side, count: 1 });
  }
  return runs;
}

function fixedRunRoad(history: RoundResult[], sequence: number[], id: string, name: string): ConfidenceRoadPattern | null {
  const runs = runLengths(history);
  if (runs.length < sequence.length) return null;
  let matchedStart = -1;
  for (let start = Math.max(0, runs.length - sequence.length); start >= 0; start -= 1) {
    if (runs.length - start < sequence.length) continue;
    const matches = runs.slice(start).every((run, relativeIndex, suffix) => {
      const expected = sequence[relativeIndex % sequence.length]!;
      return relativeIndex === suffix.length - 1 ? run.count <= expected : run.count === expected;
    });
    if (matches) matchedStart = start;
  }
  if (matchedStart < 0) return null;
  const current = runs.at(-1)!;
  const suffixLength = runs.length - matchedStart;
  const expected = sequence[(suffixLength - 1) % sequence.length]!;
  return {
    id,
    name,
    prediction: current.count < expected ? current.side : oppositeSide(current.side),
    length: Math.max(1, suffixLength - sequence.length + 1),
    source: "big",
  };
}

function bigConfidenceRoads(history: RoundResult[]): ConfidenceRoadPattern[] {
  return [
    fixedRunRoad(history, [1, 3, 2, 4], "big-1324", "1324交替"),
    fixedRunRoad(history, [2, 1, 2, 1], "big-2121", "两房一厅"),
  ].filter((pattern): pattern is ConfidenceRoadPattern => pattern !== null);
}

function confidencePatternPriority(id: string): number {
  if (id.startsWith("diamond-") || id === "bead-single-jump" || id.startsWith("big-")) return 0;
  if (id.startsWith("long-")) return 10;
  if (id === "single-jump") return 20;
  if (id.startsWith("on-")) return 30;
  if (id.includes("-cap-")) return 40;
  return 100;
}

function selectConfidenceRoadPattern<T extends { id: string; length: number }>(patterns: T[]): T | null {
  return [...patterns].sort((a, b) => confidencePatternPriority(a.id) - confidencePatternPriority(b.id) || b.length - a.length)[0] ?? null;
}

export function recognizeConfidenceRoads(history: RoundResult[], roadBook?: RoadBook): ConfidenceRoadPattern[] {
  if (roadBook && roadBook !== "bead" && roadBook !== "big") return [];
  const patterns = roadBook === "bead"
    ? beadConfidenceRoads(history)
    : roadBook === "big"
      ? [...bigConfidenceRoads(history), ...universalConfidenceRoads(history)]
      : universalConfidenceRoads(history);
  const selected = selectConfidenceRoadPattern(patterns);
  if (!selected) return [];
  return roadBook ? [{ ...selected, source: roadBook }] : [selected];
}

export function recognizePattern(history: RoundResult[], skills: Record<PatternId, number>): PatternInfo {
  const sides = history.filter((round) => round.outcome !== "tie").map((round) => round.outcome as Side);
  const recent = sides.slice(-5);
  const make = (id: PatternId, name: string, favored: Side | null): PatternInfo => ({
    id,
    name,
    favored,
    worldShift: favored ? 0.045 : 0,
    skillShift: favored ? (skills[id] ?? 0) * 0.018 : 0,
  });

  if (recent.length >= 3 && recent.slice(-3).every((side) => side === "banker")) {
    return make("long-banker", "长庄", "banker");
  }
  if (recent.length >= 3 && recent.slice(-3).every((side) => side === "player")) {
    return make("long-player", "长闲", "player");
  }
  if (recent.length >= 4 && recent.slice(-4).every((side, index, arr) => index === 0 || side !== arr[index - 1])) {
    const last = recent.at(-1);
    return make("ping-pong", "单跳", last === "banker" ? "player" : "banker");
  }
  return make("none", "无明显路势", null);
}

export function probabilityFor(history: RoundResult[], skills: Record<PatternId, number>): ProbabilityInfo {
  const pattern = recognizePattern(history, skills);
  const probabilities = { banker: 0.4586, player: 0.4462, tie: 0.0952 };
  if (pattern.favored) {
    const shift = pattern.worldShift + pattern.skillShift;
    const other: Side = pattern.favored === "banker" ? "player" : "banker";
    probabilities[pattern.favored] += shift;
    probabilities[other] -= shift;
  }
  return { ...probabilities, pattern };
}

export function generateInfluencedRound(
  rng: Rng,
  id: number,
  history: RoundResult[],
  skills: Record<PatternId, number>,
): { result: RoundResult; probability: ProbabilityInfo } {
  const probability = probabilityFor(history, skills);
  const roll = rng.next();
  const target: Outcome = roll < probability.banker
    ? "banker"
    : roll < probability.banker + probability.player ? "player" : "tie";

  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const result = dealRound(rng, id);
    if (result.outcome === target) return { result, probability };
  }
  return { result: dealRound(rng, id), probability };
}

export function makeBigRoad(history: RoundResult[]): RoadCell[] {
  const cells: RoadCell[] = [];
  const occupied = new Set<string>();
  let column = 0;
  let row = 0;
  let streakColumn = -1;
  let lastSide: Side | null = null;
  let pendingTies = 0;

  for (const [roundIndex, round] of history.entries()) {
    if (round.outcome === "tie") {
      if (cells.length) cells[cells.length - 1]!.ties += 1;
      else pendingTies += 1;
      continue;
    }
    const side = round.outcome;
    if (side !== lastSide) {
      streakColumn += 1;
      column = streakColumn;
      row = 0;
    } else {
      const below = `${column}:${row + 1}`;
      if (row < 5 && !occupied.has(below)) {
        row += 1;
      } else {
        column += 1;
        while (occupied.has(`${column}:${row}`)) column += 1;
      }
    }
    cells.push({ row, column, outcome: side, ties: pendingTies, roundIndex });
    occupied.add(`${column}:${row}`);
    pendingTies = 0;
    lastSide = side;
  }
  return cells;
}

export function makeBeadPlate(history: RoundResult[], historyOffset = 0): BeadCell[] {
  return history.map((round, index) => ({
    row: (historyOffset + index) % 6,
    column: Math.floor((historyOffset + index) / 6),
    outcome: round.outcome,
  }));
}

interface DerivedColorEntry {
  color: DerivedRoadColor;
  roundIndex: number;
}

function placeDerivedColors(entries: DerivedColorEntry[]): DerivedRoadCell[] {
  const cells: DerivedRoadCell[] = [];
  const occupied = new Set<string>();
  let streakColumn = -1;
  let column = 0;
  let row = 0;
  let previous: DerivedRoadColor | null = null;

  for (const { color, roundIndex } of entries) {
    if (color !== previous) {
      streakColumn += 1;
      column = streakColumn;
      row = 0;
    } else if (row < 5 && !occupied.has(`${column}:${row + 1}`)) {
      row += 1;
    } else {
      column += 1;
      while (occupied.has(`${column}:${row}`)) column += 1;
    }
    cells.push({ row, column, color, roundIndex });
    occupied.add(`${column}:${row}`);
    previous = color;
  }
  return cells;
}

function derivedColors(bigRoad: RoadCell[], offset: number): DerivedColorEntry[] {
  const colors: DerivedColorEntry[] = [];
  const seen = new Set<string>();
  const height = new Map<number, number>();

  for (const cell of bigRoad) {
    seen.add(`${cell.column}:${cell.row}`);
    height.set(cell.column, Math.max(height.get(cell.column) ?? 0, cell.row + 1));
    if (cell.column < offset || (cell.column === offset && cell.row === 0)) continue;

    if (cell.row === 0) {
      const nearHeight = height.get(cell.column - 1) ?? 0;
      const farHeight = height.get(cell.column - 1 - offset) ?? 0;
      colors.push({ color: nearHeight === farHeight ? "red" : "blue", roundIndex: cell.roundIndex });
      continue;
    }

    const comparisonColumn = cell.column - offset;
    const sameRowExists = seen.has(`${comparisonColumn}:${cell.row}`);
    const previousRowExists = seen.has(`${comparisonColumn}:${cell.row - 1}`);
    colors.push({ color: sameRowExists || !previousRowExists ? "red" : "blue", roundIndex: cell.roundIndex });
  }
  return colors;
}

export function makeDerivedRoads(history: RoundResult[]): DerivedRoads {
  const bigRoad = makeBigRoad(history);
  return {
    bigEye: placeDerivedColors(derivedColors(bigRoad, 1)),
    small: placeDerivedColors(derivedColors(bigRoad, 2)),
    cockroach: placeDerivedColors(derivedColors(bigRoad, 3)),
  };
}

export function predictRoadColors(history: RoundResult[], side: Side): Partial<Record<keyof DerivedRoads, DerivedRoadColor>> {
  const previous = makeDerivedRoads(history);
  const synthetic: RoundResult = {
    id: (history.at(-1)?.id ?? 0) + 1,
    outcome: side,
    bankerCards: [],
    playerCards: [],
    bankerPoints: 0,
    playerPoints: 0,
    natural: false,
  };
  const next = makeDerivedRoads([...history, synthetic]);
  const result: Partial<Record<keyof DerivedRoads, DerivedRoadColor>> = {};
  for (const key of ["bigEye", "small", "cockroach"] as const) {
    if (next[key].length > previous[key].length) result[key] = next[key].at(-1)!.color;
  }
  return result;
}

interface DerivedColorPattern {
  id: string;
  name: string;
  predictedColor: DerivedRoadColor;
  length: number;
}

const oppositeColor = (color: DerivedRoadColor): DerivedRoadColor => color === "red" ? "blue" : "red";

function trailingColorAlternationLength(colors: DerivedRoadColor[]): number {
  if (!colors.length) return 0;
  let length = 1;
  for (let index = colors.length - 1; index > 0 && colors[index] !== colors[index - 1]; index -= 1) length += 1;
  return length;
}

function trailingSameColorLength(colors: DerivedRoadColor[]): number {
  const last = colors.at(-1);
  if (!last) return 0;
  let length = 0;
  for (let index = colors.length - 1; index >= 0 && colors[index] === last; index -= 1) length += 1;
  return length;
}

function derivedTransitionPattern(colors: DerivedRoadColor[], subject: DerivedRoadColor, connects: boolean): DerivedColorPattern | null {
  if (colors.length < 4 || colors.at(-1) !== subject) return null;
  let start = colors.length - 1;
  let confirmations = 0;
  for (let index = colors.length - 2; index >= 0; index -= 1) {
    if (colors[index] === subject) {
      const matched = (colors[index + 1] === subject) === connects;
      if (!matched) break;
      confirmations += 1;
    }
    start = index;
  }
  const span = colors.length - start;
  if (span < 4 || confirmations < 2) return null;
  return {
    id: `on-${subject}-${connects ? "connect" : "break"}`,
    name: `逢${subject === "red" ? "红" : "蓝"}${connects ? "连" : "不连"}`,
    predictedColor: connects ? subject : oppositeColor(subject),
    length: Math.max(1, span - 3),
  };
}

function derivedCappedPattern(colors: DerivedRoadColor[], subject: DerivedRoadColor): DerivedColorPattern | null {
  if (colors.at(-1) !== subject) return null;
  const runs: { color: DerivedRoadColor; count: number }[] = [];
  for (const color of colors) {
    const last = runs.at(-1);
    if (last?.color === color) last.count += 1;
    else runs.push({ color, count: 1 });
  }
  const current = runs.at(-1)!;
  const previous = runs.slice(0, -1).filter((run) => run.color === subject);
  if (previous.length < 2) return null;
  const cap = Math.max(...previous.map((run) => run.count));
  if (current.count !== cap) return null;
  return {
    id: `${subject}-cap-${cap}`,
    name: `${subject === "red" ? "红" : "蓝"}不长过${cap}口`,
    predictedColor: oppositeColor(subject),
    length: Math.max(1, previous.length - 1),
  };
}

function derivedColorPatterns(colors: DerivedRoadColor[]): DerivedColorPattern[] {
  const patterns: DerivedColorPattern[] = [];
  const last = colors.at(-1);
  if (!last) return patterns;
  const streak = trailingSameColorLength(colors);
  if (streak >= 5) {
    patterns.push({
      id: `long-${last}`,
      name: `长${last === "red" ? "红" : "蓝"}`,
      predictedColor: last,
      length: streak - 4,
    });
  }
  const alternation = trailingColorAlternationLength(colors);
  if (alternation >= 6) {
    patterns.push({
      id: "single-jump",
      name: "单跳",
      predictedColor: oppositeColor(last),
      length: 1 + Math.floor((alternation - 6) / 2),
    });
  }
  for (const subject of ["red", "blue"] as const) {
    for (const connects of [true, false]) {
      const pattern = derivedTransitionPattern(colors, subject, connects);
      if (pattern) patterns.push(pattern);
    }
    const cap = derivedCappedPattern(colors, subject);
    if (cap) patterns.push(cap);
  }
  return patterns;
}

const derivedRoadKey = (roadBook: DerivedRoadBook): keyof DerivedRoads => {
  const keys: Record<DerivedRoadBook, keyof DerivedRoads> = {
    "big-eye": "bigEye",
    small: "small",
    cockroach: "cockroach",
  };
  return keys[roadBook];
};

const derivedRoadName = (roadBook: DerivedRoadBook): string => ({
  "big-eye": "大眼仔路",
  small: "小路",
  cockroach: "曱甴路",
})[roadBook];

export function recognizeDerivedConfidenceRoads(history: RoundResult[], roadBook: DerivedRoadBook, startColumn = 0): ConfidenceRoadPattern[] {
  const key = derivedRoadKey(roadBook);
  const colors = makeDerivedRoads(history)[key].filter((cell) => cell.column >= startColumn).map((cell) => cell.color);
  const bankerColor = predictRoadColors(history, "banker")[key];
  const playerColor = predictRoadColors(history, "player")[key];
  const pattern = selectConfidenceRoadPattern(derivedColorPatterns(colors));
  if (!pattern) return [];
  const bankerMatches = bankerColor === pattern.predictedColor;
  const playerMatches = playerColor === pattern.predictedColor;
  if (bankerMatches === playerMatches) return [];
  return [{
    id: `${roadBook}:${pattern.id}`,
    name: `${derivedRoadName(roadBook)}${pattern.name}`,
    prediction: bankerMatches ? "banker" : "player",
    length: pattern.length,
    source: roadBook,
  }];
}

export function confidenceRoadStartColumn(history: RoundResult[], roadBook: Exclude<RoadBook, "bead">): number | null {
  const activePattern = roadBook === "big"
    ? recognizeConfidenceRoads(history, "big")[0]
    : recognizeDerivedConfidenceRoads(history, roadBook, 0)[0];
  if (!activePattern) return null;

  const derived = roadBook === "big" ? null : makeDerivedRoads(history);
  const cells = roadBook === "big"
    ? makeBigRoad(history)
    : derived![derivedRoadKey(roadBook)];
  const columns = [...new Set(cells.map((cell) => cell.column))].sort((a, b) => b - a);
  for (const startColumn of columns) {
    const candidate = roadBook === "big"
      ? (() => {
        const startRound = cells
          .filter((cell) => cell.column >= startColumn)
          .reduce<number | null>((earliest, cell) => earliest === null ? cell.roundIndex : Math.min(earliest, cell.roundIndex), null);
        return startRound === null ? undefined : recognizeConfidenceRoads(history.slice(startRound), "big")[0];
      })()
      : recognizeDerivedConfidenceRoads(history, roadBook, startColumn)[0];
    if (candidate?.id === activePattern.id && candidate.prediction === activePattern.prediction) return startColumn;
  }
  return null;
}

export function cardLabel(card: Card): string {
  return `${rankLabel(card)}${suitSymbol(card)}`;
}

export function rankLabel(card: Card): string {
  return ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card.rank] ?? "?";
}

export function suitSymbol(card: Card): string {
  return { club: "♣", diamond: "♦", heart: "♥", spade: "♠" }[card.suit];
}

export function isRedCard(card: Card): boolean {
  return card.suit === "diamond" || card.suit === "heart";
}

export interface PipPosition {
  x: number;
  y: number;
  inverted?: boolean;
}

export function pipLayout(rank: number): PipPosition[] {
  const left = 0.28;
  const center = 0.5;
  const right = 0.72;
  const top = 0.2;
  const upper = 0.35;
  const middle = 0.5;
  const lower = 0.65;
  const bottom = 0.8;
  const p = (x: number, y: number): PipPosition => ({ x, y, inverted: y > middle });
  const layouts: Record<number, PipPosition[]> = {
    1: [p(center, middle)],
    2: [p(center, top), p(center, bottom)],
    3: [p(center, top), p(center, middle), p(center, bottom)],
    4: [p(left, top), p(right, top), p(left, bottom), p(right, bottom)],
    5: [p(left, top), p(right, top), p(center, middle), p(left, bottom), p(right, bottom)],
    6: [p(left, top), p(right, top), p(left, middle), p(right, middle), p(left, bottom), p(right, bottom)],
    7: [p(left, top), p(right, top), p(center, upper), p(left, middle), p(right, middle), p(left, bottom), p(right, bottom)],
    8: [p(left, top), p(right, top), p(center, upper), p(left, middle), p(right, middle), p(center, lower), p(left, bottom), p(right, bottom)],
    9: [p(left, top), p(right, top), p(left, upper), p(right, upper), p(center, middle), p(left, lower), p(right, lower), p(left, bottom), p(right, bottom)],
    10: [p(left, top), p(right, top), p(center, upper), p(left, upper), p(right, upper), p(left, lower), p(right, lower), p(center, lower), p(left, bottom), p(right, bottom)],
  };
  return layouts[rank] ?? [];
}
