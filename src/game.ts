import {
  createRng,
  generateInfluencedRound,
  probabilityFor,
  type PatternId,
  type ProbabilityInfo,
  type Rng,
  type RoundResult,
  type Outcome,
  type Side,
  type RoadBook,
  type ConfidenceRoadPattern,
  recognizeConfidenceRoads,
  recognizeDerivedConfidenceRoads,
  confidenceRoadStartColumn,
  retargetRoundCard,
} from "./domain";

export interface Casino {
  id: string;
  name: string;
  subtitle: string;
  tableCount: number;
  entryFee: number;
  minBet: number;
  maxBet: number;
  tone: "jade" | "crimson";
}

export interface GameTable {
  id: string;
  name: string;
  history: RoundResult[];
  historyOffset: number;
  round: number;
  realtimeElapsedMs: number;
}

export interface Restaurant {
  level: number;
  cycleElapsedWorldMinutes: number;
  pawned: boolean;
}

export interface PendingRound {
  tableId: string;
  result: RoundResult;
  probability: ProbabilityInfo;
  bet: { side: Outcome; amount: number } | null;
  confidence: number;
  confidencePrediction: Side | null;
  confidenceBreakdown: ConfidenceBreakdown;
}

export interface RoadMark {
  roadBook: RoadBook;
  startColumn: number;
  startRound: number;
}

export interface ConfidenceBreakdown {
  base: number;
  wagerBonus: number;
  markedPatternBonus: number;
  lengthBonus: number;
  opposingPatternPenalty: number;
  roundStreakBonus: number;
  dayStreakBonus: number;
  markedPatterns: ConfidenceRoadPattern[];
  opposingPatterns: ConfidenceRoadPattern[];
  total: number;
}

export interface InlineWatchStep {
  kind: "deal" | "reveal";
  cardIndex: number;
}

export function inlineWatchSteps(result: RoundResult): InlineWatchStep[] {
  const steps: InlineWatchStep[] = [];
  for (let index = 0; index < 4; index += 1) steps.push({ kind: "deal", cardIndex: index });
  for (let index = 0; index < 4; index += 1) steps.push({ kind: "reveal", cardIndex: index });
  let nextIndex = 4;
  if (result.playerCards[2]) {
    steps.push({ kind: "deal", cardIndex: nextIndex }, { kind: "reveal", cardIndex: nextIndex });
    nextIndex += 1;
  }
  if (result.bankerCards[2]) {
    steps.push({ kind: "deal", cardIndex: nextIndex }, { kind: "reveal", cardIndex: nextIndex });
  }
  return steps;
}

export type SkillId = Exclude<PatternId, "none">;

export interface SkillDefinition {
  id: SkillId;
  name: string;
  roadName: string;
  description: string;
  baseUpgradeCost: number;
}

export const casinos: Casino[] = [
  { id: "harbor", name: "海湾娱乐城", subtitle: "低注码 · 四桌常开", tableCount: 4, entryFee: 100, minBet: 100, maxBet: 2000, tone: "jade" },
  { id: "grand", name: "金殿贵宾厅", subtitle: "高注码 · 六桌竞逐", tableCount: 6, entryFee: 1000, minBet: 1000, maxBet: 20000, tone: "crimson" },
];

export const LOBBY_ROUND_MS = 8_000;
export const RESTAURANT_CYCLE_WORLD_MINUTES = 60;
export const WORLD_MINUTES_PER_REAL_SECOND_OUTSIDE_CASINO = 60;
export const WORLD_MINUTES_PER_REAL_SECOND_INSIDE_CASINO = 1;
export const MAX_SKILL_LEVEL = 5;
export const BASE_CONFIDENCE = 0;
const MAX_TABLE_HISTORY = 240;

export const skillDefinitions: SkillDefinition[] = [
  { id: "long-banker", name: "长庄术", roadName: "长庄", description: "连续庄赢时预测庄势延续。", baseUpgradeCost: 1200 },
  { id: "long-player", name: "长闲术", roadName: "长闲", description: "连续闲赢时预测闲势延续。", baseUpgradeCost: 1200 },
  { id: "ping-pong", name: "单跳术", roadName: "单跳", description: "庄闲交替时预测下一手继续跳转。", baseUpgradeCost: 1600 },
];

const restaurantLevels = [
  { cost: 0, income: 400, pawn: 4000 },
  { cost: 3000, income: 850, pawn: 6500 },
  { cost: 8000, income: 1800, pawn: 12000 },
  { cost: 18000, income: 3800, pawn: 22000 },
];

export class Game {
  cash = 8000;
  restaurant: Restaurant = { level: 1, cycleElapsedWorldMinutes: 0, pawned: false };
  worldMinutes = 18 * 60;
  skills: Record<PatternId, number> = { "long-banker": 2, "long-player": 1, "ping-pong": 1, none: 0 };
  equippedSkill: SkillId | null = "long-banker";
  confidence = BASE_CONFIDENCE;
  debugConfidenceForced = false;
  debugBaseConfidence = BASE_CONFIDENCE;
  tables = new Map<string, GameTable>();
  pending: PendingRound | null = null;
  notice = "先看路，再下注。";
  private rng: Rng = createRng(20260729);
  private lastRealtimeAt = Date.now();
  private reservedWager = 0;
  private roadMarks = new Map<string, RoadMark>();
  private roundWinStreak = 0;
  private dailyBetProfit = new Map<number, number>();

  constructor() {
    for (const casino of casinos) {
      for (let index = 0; index < casino.tableCount; index += 1) {
        const table: GameTable = { id: `${casino.id}-${index + 1}`, name: `${String(index + 1).padStart(2, "0")} 号桌`, history: [], historyOffset: 0, round: 0, realtimeElapsedMs: index * 900 };
        for (let round = 0; round < 14 + index; round += 1) this.advanceTable(table);
        this.tables.set(table.id, table);
      }
    }
  }

  table(id: string): GameTable {
    const table = this.tables.get(id);
    if (!table) throw new Error(`Unknown table: ${id}`);
    return table;
  }

  enterCasino(casinoId: string): boolean {
    const casino = casinos.find((item) => item.id === casinoId);
    if (!casino || this.cash < casino.entryFee) return false;
    this.cash -= casino.entryFee;
    this.notice = `已支付 ${casino.name} 门票`;
    return true;
  }

  previewProbability(tableId: string): ProbabilityInfo {
    return probabilityFor(this.table(tableId).history, { "long-banker": 0, "long-player": 0, "ping-pong": 0, none: 0 });
  }

  get reservedBetAmount(): number {
    return this.reservedWager;
  }

  reserveBetChip(amount: number): boolean {
    if (this.pending || !Number.isFinite(amount) || amount <= 0 || amount > this.cash) return false;
    this.cash -= amount;
    this.reservedWager += amount;
    return true;
  }

  cancelReservedBet(): number {
    if (this.pending || this.reservedWager <= 0) return 0;
    const refund = this.reservedWager;
    this.reservedWager = 0;
    this.cash += refund;
    return refund;
  }

  play(tableId: string, bet: { side: Outcome; amount: number } | null): PendingRound {
    if (this.pending) throw new Error("A round is already pending");
    const table = this.table(tableId);
    const liquidAssetsBeforeBet = this.cash + this.reservedWager;
    if (bet) {
      if (!Number.isFinite(bet.amount) || bet.amount <= 0) throw new Error("下注金额无效");
      if (this.reservedWager > 0) {
        if (bet.amount !== this.reservedWager) throw new Error("确认金额与暂存筹码不一致");
        this.reservedWager = 0;
      } else {
        if (bet.amount > this.cash) throw new Error("现金不足");
        this.cash -= bet.amount;
      }
    } else if (this.reservedWager > 0) {
      throw new Error("旁观前需取消暂存筹码");
    }
    const generated = generateInfluencedRound(this.rng, table.round + 1, table.history, { "long-banker": 0, "long-player": 0, "ping-pong": 0, none: 0 });
    const breakdown = this.calculateConfidence(tableId, bet, liquidAssetsBeforeBet);
    this.confidence = this.debugConfidenceForced ? 1 : breakdown.total;
    const prediction = breakdown.markedPatterns.find((pattern) => pattern.prediction === bet?.side)?.prediction ?? null;
    this.pending = {
      tableId,
      ...generated,
      bet,
      confidence: this.confidence,
      confidencePrediction: prediction,
      confidenceBreakdown: breakdown,
    };
    return this.pending;
  }

  markRoad(tableId: string, roadBook: RoadBook, startColumn: number, startRound: number): RoadMark {
    this.table(tableId);
    const mark = {
      roadBook,
      startColumn: Math.max(0, Math.floor(startColumn)),
      startRound: Math.max(0, Math.floor(startRound)),
    };
    this.roadMarks.set(`${tableId}:${roadBook}`, mark);
    return mark;
  }

  markCurrentBeadRoad(tableId: string): ConfidenceRoadPattern[] {
    const table = this.table(tableId);
    const patterns = recognizeConfidenceRoads(table.history, "bead");
    const key = `${tableId}:bead`;
    this.roadMarks.set(key, { roadBook: "bead", startColumn: 0, startRound: 0 });
    return this.uniqueRoadPatterns(patterns);
  }

  roadMark(tableId: string, roadBook: RoadBook): RoadMark | null {
    return this.roadMarks.get(`${tableId}:${roadBook}`) ?? null;
  }

  clearRoadMarks(tableId: string): void {
    this.table(tableId);
    for (const roadBook of ["bead", "big", "big-eye", "small", "cockroach"] as const) {
      this.roadMarks.delete(`${tableId}:${roadBook}`);
    }
  }

  markedRoadPatterns(tableId: string): ConfidenceRoadPattern[] {
    const table = this.table(tableId);
    const patterns: ConfidenceRoadPattern[] = [];
    const beadMark = this.roadMark(tableId, "bead");
    if (beadMark) patterns.push(...recognizeConfidenceRoads(table.history, "bead"));
    const bigMark = this.roadMark(tableId, "big");
    const bigStart = confidenceRoadStartColumn(table.history, "big");
    if (bigMark && bigStart !== null && bigMark.startColumn === bigStart) {
      patterns.push(...recognizeConfidenceRoads(table.history, "big"));
    }
    for (const roadBook of ["big-eye", "small", "cockroach"] as const) {
      const mark = this.roadMark(tableId, roadBook);
      const exactStart = confidenceRoadStartColumn(table.history, roadBook);
      if (!mark || exactStart === null || mark.startColumn !== exactStart) continue;
      patterns.push(...recognizeDerivedConfidenceRoads(table.history, roadBook, 0));
    }
    return this.uniqueRoadPatterns(patterns);
  }

  private allRoadPatterns(tableId: string): ConfidenceRoadPattern[] {
    const history = this.table(tableId).history;
    return this.uniqueRoadPatterns([
      ...recognizeConfidenceRoads(history, "bead"),
      ...recognizeConfidenceRoads(history, "big"),
      ...recognizeDerivedConfidenceRoads(history, "big-eye"),
      ...recognizeDerivedConfidenceRoads(history, "small"),
      ...recognizeDerivedConfidenceRoads(history, "cockroach"),
    ]);
  }

  private uniqueRoadPatterns(patterns: ConfidenceRoadPattern[]): ConfidenceRoadPattern[] {
    return [...new Map(patterns.map((pattern) => [`${pattern.source}:${pattern.id}`, pattern])).values()];
  }

  private profitableDayStreak(): number {
    let streak = 0;
    for (let day = this.worldTimeInfo().day - 1; day >= 1 && (this.dailyBetProfit.get(day) ?? 0) > 0; day -= 1) streak += 1;
    return streak;
  }

  private calculateConfidence(tableId: string, bet: { side: Outcome; amount: number } | null, liquidAssetsBeforeBet: number): ConfidenceBreakdown {
    const markedPatterns = this.markedRoadPatterns(tableId);
    const allPatterns = this.allRoadPatterns(tableId);
    const side = bet?.side === "banker" || bet?.side === "player" ? bet.side : null;
    const matching = side ? markedPatterns.filter((pattern) => pattern.prediction === side) : [];
    const opposing = side ? allPatterns.filter((pattern) => pattern.prediction === (side === "banker" ? "player" : "banker")) : [];
    const wagerShare = bet && liquidAssetsBeforeBet > 0 ? bet.amount / liquidAssetsBeforeBet : 0;
    const wagerBonus = Math.floor((wagerShare + 1e-9) / 0.1) * 0.05;
    const markedPatternBonus = matching.length * 0.05;
    const lengthBonus = matching.reduce((sum, pattern) => sum + Math.max(0, pattern.length - 1) * 0.02, 0);
    const opposingPatternPenalty = opposing.length * -0.05;
    const roundStreakBonus = bet ? this.roundWinStreak * 0.01 : 0;
    const dayStreakBonus = bet ? this.profitableDayStreak() * 0.05 : 0;
    const base = this.debugBaseConfidence;
    const total = bet ? Math.max(0, Math.min(1,
      base + wagerBonus + markedPatternBonus + lengthBonus + opposingPatternPenalty + roundStreakBonus + dayStreakBonus,
    )) : base;
    return {
      base,
      wagerBonus,
      markedPatternBonus,
      lengthBonus,
      opposingPatternPenalty,
      roundStreakBonus,
      dayStreakBonus,
      markedPatterns: matching,
      opposingPatterns: opposing,
      total,
    };
  }

  divineAssistInfo(): { target: Outcome | null; low: number; high: number } {
    if (!this.pending?.bet) return { target: null, low: 0, high: 0 };
    const target = this.pending.bet.side;
    const base = this.pending.probability[target];
    const low = Math.min(0.72, base + 0.05);
    return { target, low, high: Math.min(0.92, low + 0.24) };
  }

  shouldTriggerDivineAssist(): boolean {
    return Boolean(this.pending?.bet) && this.rng.next() < (this.pending?.confidence ?? 0);
  }

  applyDivineAssist(side: Side, handIndex: number, probability: number): boolean {
    if (!this.pending) return false;
    const target = this.divineAssistInfo().target;
    if (!target) return false;
    const shouldMatch = this.rng.next() < probability;
    const matched = retargetRoundCard(this.pending.result, side, handIndex, target, shouldMatch, this.rng.next());
    return shouldMatch && matched;
  }

  setDebugConfidenceForced(enabled: boolean): void {
    this.debugConfidenceForced = enabled;
    this.refreshDebugConfidence();
  }

  setDebugBaseConfidence(value: number): void {
    this.debugBaseConfidence = Math.max(0, Math.min(1, value));
    this.refreshDebugConfidence();
  }

  private refreshDebugConfidence(): void {
    if (this.pending) {
      const breakdown = this.pending.confidenceBreakdown;
      breakdown.base = this.debugBaseConfidence;
      breakdown.total = Math.max(0, Math.min(1, breakdown.base + breakdown.wagerBonus + breakdown.markedPatternBonus + breakdown.lengthBonus + breakdown.opposingPatternPenalty + breakdown.roundStreakBonus + breakdown.dayStreakBonus));
      this.confidence = this.debugConfidenceForced ? 1 : breakdown.total;
      this.pending.confidence = this.confidence;
      return;
    }
    this.confidence = this.debugConfidenceForced ? 1 : this.debugBaseConfidence;
  }

  equipSkill(skillId: SkillId | null): boolean {
    if (skillId && !skillDefinitions.some((skill) => skill.id === skillId)) return false;
    this.equippedSkill = skillId;
    return true;
  }

  skillUpgradeCost(skillId: SkillId): number | null {
    const definition = skillDefinitions.find((skill) => skill.id === skillId);
    const level = this.skills[skillId];
    if (!definition || level >= MAX_SKILL_LEVEL) return null;
    return definition.baseUpgradeCost * level;
  }

  upgradeSkill(skillId: SkillId): boolean {
    const cost = this.skillUpgradeCost(skillId);
    if (cost === null || this.cash < cost) return false;
    this.cash -= cost;
    this.skills[skillId] += 1;
    return true;
  }

  settle(): { delta: number; income: number } {
    if (!this.pending) throw new Error("No pending round");
    const { tableId, result, bet } = this.pending;
    const table = this.table(tableId);
    table.history.push(result);
    table.round += 1;
    this.trimTableHistory(table);

    let payout = 0;
    let delta = bet ? -bet.amount : 0;
    if (bet && result.outcome === "tie" && bet.side !== "tie") {
      payout = bet.amount;
      delta = 0;
    } else if (bet && result.outcome === bet.side) {
      payout = bet.side === "tie" ? bet.amount * 9 : bet.side === "banker" ? Math.floor(bet.amount * 1.95) : bet.amount * 2;
      delta = payout - bet.amount;
    }
    this.cash += payout;

    if (bet) {
      const day = this.worldTimeInfo().day;
      this.dailyBetProfit.set(day, (this.dailyBetProfit.get(day) ?? 0) + delta);
      if (delta > 0) this.roundWinStreak += 1;
      else if (delta < 0) this.roundWinStreak = 0;
    }

    this.pending = null;
    return { delta, income: 0 };
  }

  tickRealtime(now: number, pausedTableId: string | null, insideCasino = false, worldTimePaused = false): { income: number; tablesAdvanced: number; advancedTableIds: string[] } {
    const elapsed = Math.max(0, now - this.lastRealtimeAt);
    this.lastRealtimeAt = now;
    const worldMinutesPerRealSecond = insideCasino
      ? WORLD_MINUTES_PER_REAL_SECOND_INSIDE_CASINO
      : WORLD_MINUTES_PER_REAL_SECOND_OUTSIDE_CASINO;
    const elapsedWorldMinutes = worldTimePaused ? 0 : elapsed / 1000 * worldMinutesPerRealSecond;
    this.worldMinutes += elapsedWorldMinutes;
    let income = 0;
    let tablesAdvanced = 0;
    const advancedTableIds: string[] = [];

    if (!this.restaurant.pawned && !insideCasino) {
      this.restaurant.cycleElapsedWorldMinutes += elapsedWorldMinutes;
      while (this.restaurant.cycleElapsedWorldMinutes >= RESTAURANT_CYCLE_WORLD_MINUTES) {
        this.restaurant.cycleElapsedWorldMinutes -= RESTAURANT_CYCLE_WORLD_MINUTES;
        const payout = restaurantLevels[this.restaurant.level - 1]!.income;
        this.cash += payout;
        income += payout;
      }
    }

    for (const table of this.tables.values()) {
      if (table.id === pausedTableId) continue;
      table.realtimeElapsedMs += elapsed;
      while (table.realtimeElapsedMs >= LOBBY_ROUND_MS) {
        table.realtimeElapsedMs -= LOBBY_ROUND_MS;
        this.advanceTable(table);
        tablesAdvanced += 1;
        if (!advancedTableIds.includes(table.id)) advancedTableIds.push(table.id);
      }
    }
    return { income, tablesAdvanced, advancedTableIds };
  }

  upgradeRestaurant(): boolean {
    if (this.restaurant.pawned || this.restaurant.level >= restaurantLevels.length) return false;
    const cost = restaurantLevels[this.restaurant.level]!.cost;
    if (this.cash < cost) return false;
    this.cash -= cost;
    this.restaurant.level += 1;
    return true;
  }

  pawnRestaurant(): number {
    if (this.restaurant.pawned) return 0;
    const value = restaurantLevels[this.restaurant.level - 1]!.pawn;
    this.restaurant.pawned = true;
    this.cash += value;
    return value;
  }

  restaurantInfo() {
    const current = restaurantLevels[this.restaurant.level - 1]!;
    const next = restaurantLevels[this.restaurant.level];
    return { ...current, nextCost: next?.cost ?? null };
  }

  worldTimeInfo(): { day: number; hour: number; minute: number } {
    const wholeMinutes = Math.floor(this.worldMinutes);
    const minuteOfDay = ((wholeMinutes % 1440) + 1440) % 1440;
    return {
      day: Math.floor(wholeMinutes / 1440) + 1,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    };
  }

  get gameOver(): boolean {
    return this.cash <= 0 && this.restaurant.pawned;
  }

  private advanceTable(table: GameTable): void {
    const { result } = generateInfluencedRound(this.rng, table.round + 1, table.history, { "long-banker": 0, "long-player": 0, "ping-pong": 0, none: 0 });
    table.history.push(result);
    table.round += 1;
    this.trimTableHistory(table);
  }

  private trimTableHistory(table: GameTable): void {
    const overflow = table.history.length - MAX_TABLE_HISTORY;
    if (overflow <= 0) return;
    table.history.splice(0, overflow);
    table.historyOffset += overflow;
  }
}
