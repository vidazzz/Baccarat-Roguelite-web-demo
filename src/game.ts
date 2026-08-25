import {
  createRng,
  cardValue,
  handPoints,
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
  confidenceRoadStartColumn,
  legalRoundCardCandidates,
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
  maxChainRounds: number;
  dealerCash: number;
  tone: "jade" | "crimson";
}

export interface GameTable {
  id: string;
  name: string;
  dealerName: string;
  dealerRewardKind: "chips" | "cheat-skill";
  dealerRewardChips: number;
  history: RoundResult[];
  historyOffset: number;
  round: number;
  realtimeElapsedMs: number;
  dealerCash: number;
  dealerRewardClaimed: boolean;
}

export interface Restaurant {
  level: number;
  cycleElapsedWorldMinutes: number;
  pawned: boolean;
  open: boolean;
  closeAtWorldMinute: number;
  pawnDebtCash: number;
}

export interface DebugGameplayConfig {
  restaurantIncomePerCycle: number;
  restaurantCycleWorldMinutes: number;
  worldMinutesPerRealSecondOutsideCasino: number;
  worldMinutesPerRealSecondInsideCasino: number;
  sleepDebtPerMidnightWorldMinutes: number;
  sleepDebtThresholdWorldMinutes: number;
}

export interface PendingRound {
  tableId: string;
  result: RoundResult;
  probability: ProbabilityInfo;
  bet: { side: Outcome; amount: number } | null;
  confidence: number;
  confidencePrediction: Side | null;
  confidenceBreakdown: ConfidenceBreakdown;
  createdRoadPrediction: Side | null;
  betCurrency?: "cash" | "chip";
}

export interface ChainLeg {
  index: number;
  target: Outcome;
  result: RoundResult;
  settled: boolean;
}

export interface PendingChain {
  tableId: string;
  stake: number;
  plannedRounds: number;
  legs: ChainLeg[];
  currentLegIndex: number;
}

export interface ChainSettlementResult {
  stake: number;
  plannedRounds: number;
  effectiveRounds: number;
  ties: number;
  won: boolean;
  payout: number;
  dealerCashAfter: number;
  dealerReward: DealerReward | null;
}

export interface DealerReward {
  kind: "chips" | "cheat-skill";
  amount?: number;
  skillId?: CheatSkillId;
}

export interface RoadMark {
  roadBook: RoadBook;
  startColumn: number;
  startRound: number;
}

export interface RoadCreationResolution {
  predicted: Side;
  actual: Outcome;
  matched: boolean;
  confidencePenalty: number;
}

export interface SettlementResult {
  delta: number;
  income: number;
  roadCreation: RoadCreationResolution | null;
  dealerReward?: DealerReward | null;
  chainContinues?: boolean;
  chainCompleted?: boolean;
  chainIndex?: number;
}

export type DivineCardType = "face" | "no-edge" | "two-edge" | "three-edge" | "four-edge";
export const DIVINE_CARD_TYPE_OPTIONS: readonly { type: DivineCardType; label: string; detail: string }[] = [
  { type: "face", label: "公", detail: "J · Q · K" },
  { type: "no-edge", label: "没边", detail: "A · 2 · 3" },
  { type: "two-edge", label: "两边", detail: "4 · 5" },
  { type: "three-edge", label: "三边", detail: "6 · 7 · 8" },
  { type: "four-edge", label: "四边", detail: "9 · 10" },
];

export function divineCardTypeForRank(rank: number): DivineCardType {
  if (rank >= 11) return "face";
  if (rank <= 3) return "no-edge";
  if (rank <= 5) return "two-edge";
  if (rank <= 8) return "three-edge";
  return "four-edge";
}

export type NextRoundEffect =
  | { kind: "forecast"; outcome: Outcome; chance: number }
  | { kind: "lose" }
  | { kind: "all-in"; threshold: number; chance: number };

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

export type CheatSkillId = "peek-covered" | "swap-covered" | "set-edge" | "redraw-face-up" | "swap-face-up";
const cheatEdgeTypes: DivineCardType[] = ["face", "no-edge", "two-edge", "three-edge", "four-edge"];

export interface CheatSkillDefinition {
  id: CheatSkillId;
  name: string;
  timing: "covered" | "face-up";
  description: string;
}

export const cheatSkillDefinitions: readonly CheatSkillDefinition[] = [
  { id: "peek-covered", name: "透牌", timing: "covered", description: "查看盖牌牌面，但牌仍保持盖牌状态。" },
  { id: "swap-covered", name: "调牌", timing: "covered", description: "交换己方前两张盖牌的顺序。" },
  { id: "set-edge", name: "定边", timing: "covered", description: "将盖牌重新抽为指定边数类型。" },
  { id: "redraw-face-up", name: "重抽", timing: "face-up", description: "重新抽取当前明牌，并重新计算牌局结果。" },
  { id: "swap-face-up", name: "换牌", timing: "face-up", description: "交换己方前两张明牌的顺序。" },
];

export interface SkillDefinition {
  id: SkillId;
  name: string;
  roadName: string;
  description: string;
  baseUpgradeCost: number;
}

export const casinos: Casino[] = [
  { id: "harbor", name: "海湾娱乐城", subtitle: "低注码 · 四桌常开", tableCount: 4, entryFee: 100, minBet: 100, maxBet: 2000, maxChainRounds: 3, dealerCash: 10_000, tone: "jade" },
  { id: "grand", name: "金殿贵宾厅", subtitle: "高注码 · 六桌竞逐", tableCount: 6, entryFee: 1000, minBet: 1000, maxBet: 20_000, maxChainRounds: 5, dealerCash: 10_000, tone: "crimson" },
];

export const LOBBY_ROUND_MS = 8_000;
export const RESTAURANT_CYCLE_WORLD_MINUTES = 60;
export const RESTAURANT_OPENING_MINUTE = 8 * 60;
export const RESTAURANT_CLOSING_MINUTE = 20 * 60;
export const MINIMUM_NATURAL_WAKE_DEBT_WORLD_MINUTES = 60;
export const SLEEP_DEBT_PER_MIDNIGHT_WORLD_MINUTES = 8 * 60;
export const SLEEP_DEBT_THRESHOLD_WORLD_MINUTES = 10 * 60;
export const WORLD_MINUTES_PER_REAL_SECOND_OUTSIDE_CASINO = 60;
export const WORLD_MINUTES_PER_REAL_SECOND_INSIDE_CASINO = 1;
export const MAX_SKILL_LEVEL = 5;
export const BASE_CONFIDENCE = 0;
const MAX_TABLE_HISTORY = 240;
const nextSleepDeprivationCheckAt = (worldMinute: number): number => {
  const dayStart = Math.floor(worldMinute / 1440) * 1440;
  const todayAtOpening = dayStart + RESTAURANT_OPENING_MINUTE;
  return worldMinute < todayAtOpening ? todayAtOpening : todayAtOpening + 1440;
};

export const skillDefinitions: SkillDefinition[] = [
  { id: "long-banker", name: "长庄术", roadName: "长庄", description: "连续庄赢时预测庄势延续。", baseUpgradeCost: 1200 },
  { id: "long-player", name: "长闲术", roadName: "长闲", description: "连续闲赢时预测闲势延续。", baseUpgradeCost: 1200 },
  { id: "ping-pong", name: "单跳术", roadName: "单跳", description: "庄闲交替时预测下一手继续跳转。", baseUpgradeCost: 1600 },
];

const restaurantLevels = [
  { cost: 0, income: 400, chipChance: 0.35, chipsOnSuccess: 1, pawn: 4000 },
  { cost: 3000, income: 850, chipChance: 0.52, chipsOnSuccess: 1, pawn: 6500 },
  { cost: 8000, income: 1800, chipChance: 0.68, chipsOnSuccess: 2, pawn: 12000 },
  { cost: 18000, income: 3800, chipChance: 0.82, chipsOnSuccess: 3, pawn: 22000 },
];

const defaultDebugGameplayConfig = (): DebugGameplayConfig => ({
  restaurantIncomePerCycle: restaurantLevels[0]!.chipsOnSuccess,
  restaurantCycleWorldMinutes: RESTAURANT_CYCLE_WORLD_MINUTES,
  worldMinutesPerRealSecondOutsideCasino: WORLD_MINUTES_PER_REAL_SECOND_OUTSIDE_CASINO,
  worldMinutesPerRealSecondInsideCasino: WORLD_MINUTES_PER_REAL_SECOND_INSIDE_CASINO,
  sleepDebtPerMidnightWorldMinutes: SLEEP_DEBT_PER_MIDNIGHT_WORLD_MINUTES,
  sleepDebtThresholdWorldMinutes: SLEEP_DEBT_THRESHOLD_WORLD_MINUTES,
});

export class Game {
  cash = 8000;
  chips = 10;
  mudChips = 0;
  restaurant: Restaurant = { level: 1, cycleElapsedWorldMinutes: 0, pawned: false, open: true, closeAtWorldMinute: RESTAURANT_CLOSING_MINUTE, pawnDebtCash: 0 };
  worldMinutes = 18 * 60;
  skills: Record<PatternId, number> = { "long-banker": 2, "long-player": 1, "ping-pong": 1, none: 0 };
  equippedSkill: SkillId | null = "long-banker";
  confidence = BASE_CONFIDENCE;
  debugConfidenceForced = false;
  debugBaseConfidence = BASE_CONFIDENCE;
  tables = new Map<string, GameTable>();
  pending: PendingRound | null = null;
  pendingChain: PendingChain | null = null;
  nextRoundEffect: NextRoundEffect | null = null;
  sleepDebtWorldMinutes = 0;
  sleepDeprivationCollapseAtWorldMinute: number | null = null;
  nextSleepDebtAtWorldMinute = 1440;
  lastSleepDurationWorldMinutes = 0;
  notice = "先看路，再下注。";
  private rng: Rng = createRng(20260729);
  private lastRealtimeAt = Date.now();
  private reservedWager = 0;
  private reservedChipWager = 0;
  private roadMarks = new Map<string, RoadMark>();
  private roadCreations = new Map<string, Side[]>();
  private roundWinStreak = 0;
  private dailyBetProfit = new Map<number, number>();
  private debugRestaurantIncomeOverride: number | null = null;
  private debugGameplay = defaultDebugGameplayConfig();
  private dailyCheatSkills: CheatSkillId[] = [];

  constructor() {
    const dealerNames = ["阿成", "老K", "阿兰", "陈叔", "小杜", "梅姐"];
    for (const casino of casinos) {
      for (let index = 0; index < casino.tableCount; index += 1) {
        const tableNumber = index + 1;
        const table: GameTable = { id: `${casino.id}-${tableNumber}`, name: `${String(tableNumber).padStart(2, "0")} 号桌`, dealerName: dealerNames[(index + (casino.id === "grand" ? 2 : 0)) % dealerNames.length]!, dealerRewardKind: "chips", dealerRewardChips: 3, history: [], historyOffset: 0, round: 0, realtimeElapsedMs: index * 900, dealerCash: casino.dealerCash, dealerRewardClaimed: false };
        this.refreshDealerReward(table, 1);
        for (let round = 0; round < 14 + index; round += 1) this.advanceTable(table);
        this.tables.set(table.id, table);
      }
    }
    this.rollDailyCheatSkills();
  }

  get availableCheatSkills(): readonly CheatSkillId[] {
    return this.dailyCheatSkills;
  }

  rollDailyCheatSkills(): CheatSkillId[] {
    const pool = cheatSkillDefinitions.map((definition) => definition.id);
    const selected: CheatSkillId[] = [];
    while (selected.length < 2 && pool.length) {
      const index = Math.min(pool.length - 1, Math.floor(this.rng.next() * pool.length));
      selected.push(pool.splice(index, 1)[0]!);
    }
    this.dailyCheatSkills = selected;
    return [...selected];
  }

  grantTemporaryCheatSkill(): CheatSkillId {
    const available = cheatSkillDefinitions.map((definition) => definition.id).filter((id) => !this.dailyCheatSkills.includes(id));
    const skill = available[Math.min(available.length - 1, Math.floor(this.rng.next() * available.length))] ?? this.dailyCheatSkills[0]!;
    if (!this.dailyCheatSkills.includes(skill)) this.dailyCheatSkills.push(skill);
    return skill;
  }

  useCheatSkill(skillId: CheatSkillId, side: Side, handIndex = 0, chainLegIndex: number | null = null): boolean {
    if ((!this.pending && !this.pendingChain) || !this.dailyCheatSkills.includes(skillId) || !this.consumeChips(1)) return false;
    const targetResult = this.pendingChain && chainLegIndex !== null
      ? this.pendingChain.legs[chainLegIndex]?.result
      : this.pending?.result;
    const targetLeg = this.pendingChain && chainLegIndex !== null
      ? this.pendingChain.legs[chainLegIndex]
      : null;
    if (!targetResult || targetLeg?.settled) {
      this.refundChips(1);
      return false;
    }
    const hand = side === "player" ? targetResult.playerCards : targetResult.bankerCards;
    if (!hand[handIndex]) {
      this.refundChips(1);
      return false;
    }
    if (skillId === "swap-covered" || skillId === "swap-face-up") {
      if (hand.length < 2) {
        this.refundChips(1);
        return false;
      }
      [hand[0], hand[1]] = [hand[1]!, hand[0]!];
      targetResult.playerPoints = handPoints(targetResult.playerCards);
      targetResult.bankerPoints = handPoints(targetResult.bankerCards);
      targetResult.outcome = targetResult.playerPoints === targetResult.bankerPoints
        ? "tie"
        : targetResult.bankerPoints > targetResult.playerPoints ? "banker" : "player";
    }
    if (skillId === "redraw-face-up") {
      const candidates = legalRoundCardCandidates(targetResult, side, handIndex);
      const replacement = candidates[Math.min(candidates.length - 1, Math.floor(this.rng.next() * candidates.length))];
      if (!replacement) {
        this.refundChips(1);
        return false;
      }
      Object.assign(targetResult, replacement);
    }
    if (skillId === "set-edge") {
      const desiredType = cheatEdgeTypes[Math.floor(this.rng.next() * cheatEdgeTypes.length)]!;
      const candidates = legalRoundCardCandidates(targetResult, side, handIndex)
        .filter((candidate) => {
          const card = (side === "player" ? candidate.playerCards : candidate.bankerCards)[handIndex];
          return card && divineCardTypeForRank(card.rank) === desiredType;
        });
      const replacement = candidates[Math.min(candidates.length - 1, Math.floor(this.rng.next() * candidates.length))];
      if (!replacement) {
        this.refundChips(1);
          return false;
        }
      Object.assign(targetResult, replacement);
    }
    return true;
  }

  private grantDealerReward(table: GameTable): DealerReward | null {
    if (table.dealerRewardClaimed || table.dealerCash > 0) return null;
    table.dealerRewardClaimed = true;
    if (table.dealerRewardKind === "chips") {
      const amount = table.dealerRewardChips;
      this.chips += amount;
      return { kind: "chips", amount };
    }
    return { kind: "cheat-skill", skillId: this.grantTemporaryCheatSkill() };
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

  enterCasinoWithChips(casinoId: string): boolean {
    const casino = casinos.find((item) => item.id === casinoId);
    const feeChips = casino ? Math.ceil(casino.entryFee / 100) : Number.POSITIVE_INFINITY;
    if (!casino || !this.consumeChips(feeChips)) return false;
    this.notice = `已支付 ${casino.name} 门票 · ${feeChips} 枚筹码`;
    return true;
  }

  resetDealerFunds(): void {
    const day = this.worldTimeInfo().day;
    for (const table of this.tables.values()) {
      const casino = casinos.find((item) => table.id.startsWith(`${item.id}-`));
      if (casino) {
        table.dealerCash = casino.dealerCash;
        table.dealerRewardClaimed = false;
        this.refreshDealerReward(table, day);
      }
    }
  }

  private refreshDealerReward(table: GameTable, day: number): void {
    const seed = [...table.id].reduce((total, character) => total + character.charCodeAt(0), day * 31);
    table.dealerRewardKind = seed % 2 === 0 ? "chips" : "cheat-skill";
    table.dealerRewardChips = 3 + ((seed * 13) % 8);
  }

  previewProbability(tableId: string): ProbabilityInfo {
    return probabilityFor(this.table(tableId).history, { "long-banker": 0, "long-player": 0, "ping-pong": 0, none: 0 });
  }

  get reservedBetAmount(): number {
    return this.reservedWager || this.reservedChipWager;
  }

  get reservedChainStake(): number {
    return this.reservedChipWager;
  }

  get availableChips(): number {
    return this.chips + this.mudChips;
  }

  private consumeChips(count: number): boolean {
    if (!Number.isInteger(count) || count < 0 || this.availableChips < count) return false;
    const mudUsed = Math.min(this.mudChips, count);
    this.mudChips -= mudUsed;
    this.chips -= count - mudUsed;
    return true;
  }

  private refundChips(count: number): void {
    this.chips += Math.max(0, Math.floor(count));
  }

  reserveChainStake(amount: number, tableId: string): boolean {
    const table = this.table(tableId);
    const casino = casinos.find((item) => table.id.startsWith(`${item.id}-`));
    if (!casino || this.pending || this.pendingChain || this.reservedWager > 0 || this.reservedChipWager > 0) return false;
    if (!Number.isInteger(amount) || amount < casino.minBet || amount > casino.maxBet || amount % 100 !== 0) return false;
    const chipCount = amount / 100;
    if (!this.consumeChips(chipCount)) return false;
    this.reservedChipWager = amount;
    return true;
  }

  reserveChipBet(amount: number): boolean {
    if (this.pending || this.pendingChain || this.reservedWager > 0 || this.reservedChipWager > 0) return false;
    if (!Number.isInteger(amount) || amount <= 0 || amount % 100 !== 0) return false;
    const chipCount = amount / 100;
    if (!this.consumeChips(chipCount)) return false;
    this.reservedChipWager = amount;
    return true;
  }

  addReservedChipBet(amount: number): boolean {
    if (this.pending || this.pendingChain || this.reservedChipWager <= 0) return false;
    if (!Number.isInteger(amount) || amount <= 0 || amount % 100 !== 0 || !this.consumeChips(amount / 100)) return false;
    this.reservedChipWager += amount;
    return true;
  }

  cancelReservedChainStake(): number {
    if (this.pendingChain || this.reservedChipWager <= 0) return 0;
    const amount = this.reservedChipWager;
    this.refundChips(amount / 100);
    this.reservedChipWager = 0;
    return amount;
  }

  reserveBetChip(amount: number): boolean {
    if (this.pending || !Number.isFinite(amount) || amount <= 0 || amount > this.cash) return false;
    this.cash -= amount;
    this.reservedWager += amount;
    return true;
  }

  cancelReservedBet(): number {
    if (this.pending || (this.reservedWager <= 0 && this.reservedChipWager <= 0)) return 0;
    if (this.reservedChipWager > 0) {
      const refund = this.reservedChipWager;
      this.refundChips(refund / 100);
      this.reservedChipWager = 0;
      return refund;
    }
    const refund = this.reservedWager;
    this.reservedWager = 0;
    this.cash += refund;
    return refund;
  }

  playChain(tableId: string, targets: Outcome[]): PendingChain {
    if (this.pending || this.pendingChain) throw new Error("A round is already pending");
    const table = this.table(tableId);
    const casino = casinos.find((item) => table.id.startsWith(`${item.id}-`));
    if (!casino) throw new Error("Unknown casino");
    const stake = this.reservedChipWager;
    if (!stake) throw new Error("请先暂存连战筹码");
    if (!targets.length || targets.length > casino.maxChainRounds) throw new Error("连战局数无效");
    if (targets.some((target) => target !== "banker" && target !== "player" && target !== "tie")) throw new Error("下注目标无效");
    const legs: ChainLeg[] = [];
    let projectedHistory = table.history;
    for (let index = 0; index < targets.length; index += 1) {
      const generated = generateInfluencedRound(this.rng, table.round + index + 1, projectedHistory, { "long-banker": 0, "long-player": 0, "ping-pong": 0, none: 0 });
      legs.push({ index, target: targets[index]!, result: generated.result, settled: false });
      projectedHistory = [...projectedHistory, generated.result];
    }
    this.reservedChipWager = 0;
    this.pendingChain = { tableId, stake, plannedRounds: targets.length, legs, currentLegIndex: 0 };
    this.pending = this.pendingRoundForChainLeg(this.pendingChain, legs[0]!);
    this.confidence = this.debugConfidenceForced ? 1 : this.pending.confidence;
    return this.pendingChain;
  }

  selectChainLeg(index: number): PendingRound | null {
    const chain = this.pendingChain;
    if (!chain || !Number.isInteger(index) || index < 0 || index >= chain.legs.length) return null;
    const leg = chain.legs[index]!;
    if (leg.settled) return null;
    chain.currentLegIndex = index;
    this.pending = this.pendingRoundForChainLeg(chain, leg);
    this.confidence = this.debugConfidenceForced ? 1 : this.pending.confidence;
    return this.pending;
  }

  private pendingRoundForChainLeg(chain: PendingChain, leg: ChainLeg): PendingRound {
    const table = this.table(chain.tableId);
    const probability = probabilityFor(table.history, { "long-banker": 0, "long-player": 0, "ping-pong": 0, none: 0 });
    const breakdown = this.calculateConfidence(chain.tableId, { side: leg.target, amount: chain.stake }, this.cash);
    return {
      tableId: chain.tableId,
      result: leg.result,
      probability,
      bet: { side: leg.target, amount: chain.stake },
      confidence: this.debugConfidenceForced ? 1 : breakdown.total,
      confidencePrediction: null,
      confidenceBreakdown: breakdown,
      createdRoadPrediction: null,
      betCurrency: "chip",
    };
  }

  private settleChainLeg(): SettlementResult {
    const chain = this.pendingChain!;
    const leg = chain.legs[chain.currentLegIndex]!;
    const table = this.table(chain.tableId);
    if (leg.settled) throw new Error("This chain leg is already settled");
    table.history.push(leg.result);
    table.round += 1;
    this.trimTableHistory(table);
    leg.settled = true;
    const tie = leg.result.outcome === "tie";
    const won = tie || leg.result.outcome === leg.target;
    const planned = this.roadCreation(chain.tableId);
    if (planned) {
      const remaining = this.roadCreationSequence(chain.tableId).slice(1);
      if (leg.result.outcome !== planned) this.roadCreations.delete(chain.tableId);
      else if (remaining.length) this.roadCreations.set(chain.tableId, remaining);
      else this.roadCreations.delete(chain.tableId);
    }
    if (!won) {
      this.pending = null;
      this.pendingChain = null;
      this.roundWinStreak = 0;
      return { delta: 0, income: 0, roadCreation: null, chainCompleted: true, chainIndex: leg.index, dealerReward: null };
    }
    if (!chain.legs.every((item) => item.settled)) {
      this.pending = null;
      return { delta: 0, income: 0, roadCreation: null, chainContinues: true, chainIndex: leg.index, dealerReward: null };
    }
    const ties = chain.legs.filter((item) => item.result.outcome === "tie").length;
    const effectiveRounds = chain.plannedRounds - ties;
    const payout = chain.stake * (2 ** effectiveRounds);
    this.cash += payout;
    table.dealerCash = Math.max(0, table.dealerCash - payout);
    const dealerReward = this.grantDealerReward(table);
    this.pending = null;
    this.pendingChain = null;
    this.roundWinStreak += 1;
    return { delta: payout, income: 0, roadCreation: null, chainCompleted: true, chainIndex: leg.index, dealerReward };
  }

  settleChain(): ChainSettlementResult {
    if (!this.pendingChain) throw new Error("No pending chain");
    const pending = this.pendingChain;
    const table = this.table(pending.tableId);
    let ties = 0;
    let won = true;
    for (const leg of pending.legs) {
      table.history.push(leg.result);
      table.round += 1;
      if (leg.result.outcome === "tie") {
        ties += 1;
        continue;
      }
      if (leg.result.outcome !== leg.target) won = false;
    }
    this.trimTableHistory(table);
    const effectiveRounds = pending.plannedRounds - ties;
    const payout = won ? pending.stake * (2 ** effectiveRounds) : 0;
    if (payout > 0) {
      this.cash += payout;
      table.dealerCash = Math.max(0, table.dealerCash - payout);
    }
    const dealerReward = this.grantDealerReward(table);
    this.pending = null;
    this.pendingChain = null;
    return { stake: pending.stake, plannedRounds: pending.plannedRounds, effectiveRounds, ties, won, payout, dealerCashAfter: table.dealerCash, dealerReward };
  }

  abandonPendingRound(): void {
    this.pending = null;
    this.pendingChain = null;
    this.reservedWager = 0;
    this.reservedChipWager = 0;
  }

  play(tableId: string, bet: { side: Outcome; amount: number } | null): PendingRound {
    if (this.pending || this.pendingChain) throw new Error("A round is already pending");
    const table = this.table(tableId);
    const chipBet = this.reservedChipWager > 0;
    const liquidAssetsBeforeBet = this.cash + this.reservedWager;
    if (bet) {
      if (!Number.isFinite(bet.amount) || bet.amount <= 0) throw new Error("下注金额无效");
      if (chipBet) {
        if (bet.amount !== this.reservedChipWager) throw new Error("确认金额与暂存筹码不一致");
        this.reservedChipWager = 0;
      } else if (this.reservedWager > 0) {
        if (bet.amount !== this.reservedWager) throw new Error("确认金额与暂存筹码不一致");
        this.reservedWager = 0;
      } else {
        if (bet.amount > this.cash) throw new Error("现金不足");
        this.cash -= bet.amount;
      }
    } else if (this.reservedWager > 0 || this.reservedChipWager > 0) {
      throw new Error("旁观前需取消暂存筹码");
    }
    const generated = generateInfluencedRound(this.rng, table.round + 1, table.history, { "long-banker": 0, "long-player": 0, "ping-pong": 0, none: 0 });
    this.applyNextRoundEffect(generated.result, bet);
    const breakdown = this.calculateConfidence(tableId, bet, liquidAssetsBeforeBet);
    this.confidence = this.debugConfidenceForced ? 1 : breakdown.total;
    const predictionTarget = this.roadCreationSequence(tableId).at(-1) ?? (bet?.side === "banker" || bet?.side === "player" ? bet.side : null);
    const prediction = breakdown.markedPatterns.find((pattern) => pattern.prediction === predictionTarget)?.prediction ?? null;
    this.pending = {
      tableId,
      ...generated,
      bet,
      confidence: this.confidence,
      confidencePrediction: prediction,
      confidenceBreakdown: breakdown,
      createdRoadPrediction: this.roadCreation(tableId),
      betCurrency: bet ? (chipBet ? "chip" : "cash") : undefined,
    };
    return this.pending;
  }

  roadCreation(tableId: string): Side | null {
    this.table(tableId);
    return this.roadCreations.get(tableId)?.[0] ?? null;
  }

  setRoadCreation(tableId: string, side: Side | null): Side | null {
    this.table(tableId);
    if (side) this.roadCreations.set(tableId, [side]);
    else this.roadCreations.delete(tableId);
    return side;
  }

  setRoadCreationSequence(tableId: string, sides: readonly Side[]): Side[] {
    this.table(tableId);
    const sequence = sides.filter((side): side is Side => side === "banker" || side === "player");
    if (sequence.length) this.roadCreations.set(tableId, [...sequence]);
    else this.roadCreations.delete(tableId);
    return [...sequence];
  }

  roadCreationSequence(tableId: string): Side[] {
    this.table(tableId);
    return [...(this.roadCreations.get(tableId) ?? [])];
  }

  appendRoadCreation(tableId: string, side: Side): Side[] {
    const sequence = this.roadCreationSequence(tableId);
    sequence.push(side);
    this.roadCreations.set(tableId, sequence);
    return [...sequence];
  }

  updateRoadCreation(tableId: string, index: number, side: Side | null): Side[] {
    const sequence = this.roadCreationSequence(tableId);
    const targetIndex = Math.floor(index);
    if (!Number.isFinite(index) || targetIndex < 0 || targetIndex > sequence.length) {
      throw new Error("Invalid road creation index");
    }
    const updated = sequence.slice(0, targetIndex);
    if (side) updated.push(side);
    if (updated.length) this.roadCreations.set(tableId, updated);
    else this.roadCreations.delete(tableId);
    return [...updated];
  }

  roadAnalysisHistory(tableId: string): RoundResult[] {
    const table = this.table(tableId);
    const predictions = this.roadCreationSequence(tableId);
    if (!predictions.length) return table.history;
    const firstId = (table.history.at(-1)?.id ?? table.round) + 1;
    return [...table.history, ...predictions.map((outcome, index): RoundResult => ({
      id: firstId + index,
      outcome,
      bankerCards: [],
      playerCards: [],
      bankerPoints: 0,
      playerPoints: 0,
      natural: false,
    }))];
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
    const patterns = recognizeConfidenceRoads(this.roadAnalysisHistory(tableId), "bead");
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

  clearRoadPlanning(tableId: string): void {
    this.clearRoadMarks(tableId);
    this.roadCreations.delete(tableId);
  }

  markedRoadPatterns(tableId: string): ConfidenceRoadPattern[] {
    this.table(tableId);
    const history = this.roadAnalysisHistory(tableId);
    const patterns: ConfidenceRoadPattern[] = [];
    const beadMark = this.roadMark(tableId, "bead");
    if (beadMark) patterns.push(...recognizeConfidenceRoads(history, "bead"));
    const bigMark = this.roadMark(tableId, "big");
    const bigStart = confidenceRoadStartColumn(history, "big");
    if (bigMark && bigStart !== null && bigMark.startColumn === bigStart) {
      patterns.push(...recognizeConfidenceRoads(history, "big"));
    }
    return this.uniqueRoadPatterns(patterns);
  }

  private allRoadPatterns(tableId: string): ConfidenceRoadPattern[] {
    const history = this.table(tableId).history;
    return this.uniqueRoadPatterns([
      ...recognizeConfidenceRoads(history, "bead"),
      ...recognizeConfidenceRoads(history, "big"),
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
    const plannedSequence = this.roadCreationSequence(tableId);
    const projectedHistory = this.roadAnalysisHistory(tableId);
    // 路数用于预测下一步，当前规划的最后一注只作为相合目标，不能先参与预测自身。
    const patternHistory = plannedSequence.length ? projectedHistory.slice(0, -1) : projectedHistory;
    const projectedPatterns = plannedSequence.length
      ? this.uniqueRoadPatterns([
        ...recognizeConfidenceRoads(patternHistory, "bead"),
        ...recognizeConfidenceRoads(patternHistory, "big"),
      ])
      : [];
    const markedPatterns = plannedSequence.length ? projectedPatterns : this.markedRoadPatterns(tableId);
    const allPatterns = plannedSequence.length ? projectedPatterns : this.allRoadPatterns(tableId);
    const side = bet?.side === "banker" || bet?.side === "player" ? bet.side : null;
    const planningTarget = plannedSequence.at(-1) ?? side;
    const matching = planningTarget ? markedPatterns.filter((pattern) => pattern.prediction === planningTarget) : [];
    const opposing = planningTarget ? allPatterns.filter((pattern) => pattern.prediction === (planningTarget === "banker" ? "player" : "banker")) : [];
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

  divineAssistProbability(): number {
    if (!this.pending?.bet) return 0;
    return Math.min(0.3, Math.max(0, this.confidence));
  }

  shouldTriggerDivineAssist(): boolean {
    const pending = this.pending;
    if (!pending?.bet) return false;
    const fatal = pending.result.outcome !== pending.bet.side;
    if (!fatal) return false;
    if (this.confidence <= 0) return false;
    return this.debugConfidenceForced || this.rng.next() < this.divineAssistProbability();
  }

  applyDivineAssist(side: Side, handIndex: number, probability: number): boolean {
    if (!this.pending) return false;
    const target = this.divineAssistInfo().target;
    if (!target) return false;
    const shouldMatch = this.rng.next() < probability;
    const matched = retargetRoundCard(this.pending.result, side, handIndex, target, shouldMatch, this.rng.next());
    return shouldMatch && matched;
  }

  applyDivineCardType(side: Side, handIndex: number, type: DivineCardType): boolean {
    if (!this.pending || this.rng.next() >= 0.72) return false;
    const candidates = legalRoundCardCandidates(this.pending.result, side, handIndex)
      .filter((candidate) => {
        const card = (side === "player" ? candidate.playerCards : candidate.bankerCards)[handIndex];
        return card ? divineCardTypeForRank(card.rank) === type : false;
      });
    if (!candidates.length) return false;
    Object.assign(this.pending.result, candidates[Math.min(Math.floor(this.rng.next() * candidates.length), candidates.length - 1)]!);
    return true;
  }

  applyDivineCall(side: Side, handIndex: number, call: "draw" | "blow"): boolean {
    if (!this.pending?.bet || this.rng.next() >= 0.78) return false;
    const target = this.pending.bet.side;
    const candidates = legalRoundCardCandidates(this.pending.result, side, handIndex)
      .filter((candidate) => candidate.outcome === target);
    if (!candidates.length) return false;
    const preferred = candidates.filter((candidate) => {
      const card = (side === "player" ? candidate.playerCards : candidate.bankerCards)[handIndex];
      const value = card ? cardValue(card) : 0;
      return call === "draw" ? value >= 5 : value <= 4;
    });
    const pool = preferred.length ? preferred : candidates;
    Object.assign(this.pending.result, pool[Math.min(Math.floor(this.rng.next() * pool.length), pool.length - 1)]!);
    return true;
  }

  setNextRoundEffect(effect: NextRoundEffect): void {
    this.nextRoundEffect = effect;
  }

  private forceRoundOutcome(result: RoundResult, target: Outcome): boolean {
    const entries: { side: Side; handIndex: number }[] = [
      { side: "banker", handIndex: result.bankerCards.length - 1 },
      { side: "player", handIndex: result.playerCards.length - 1 },
    ];
    for (const entry of entries) {
      const candidates = legalRoundCardCandidates(result, entry.side, entry.handIndex).filter((candidate) => candidate.outcome === target);
      if (!candidates.length) continue;
      Object.assign(result, candidates[Math.min(Math.floor(this.rng.next() * candidates.length), candidates.length - 1)]!);
      return true;
    }
    return false;
  }

  private applyNextRoundEffect(result: RoundResult, bet: { side: Outcome; amount: number } | null): void {
    const effect = this.nextRoundEffect;
    if (!effect || !bet) return;
    this.nextRoundEffect = null;
    if (effect.kind === "forecast") {
      if (this.rng.next() < effect.chance) this.forceRoundOutcome(result, effect.outcome);
      return;
    }
    if (effect.kind === "lose") {
      const loss = bet.side === "banker" ? "player" : "banker";
      this.forceRoundOutcome(result, loss);
      return;
    }
    if (bet.amount >= effect.threshold && this.rng.next() < effect.chance) this.forceRoundOutcome(result, bet.side);
  }

  setDebugConfidenceForced(enabled: boolean): void {
    this.debugConfidenceForced = enabled;
    this.refreshDebugConfidence();
  }

  setDebugBaseConfidence(value: number): void {
    this.debugBaseConfidence = Math.max(0, Math.min(1, value));
    this.refreshDebugConfidence();
  }

  adjustDebugCash(amount: number): number {
    if (!Number.isFinite(amount)) return this.cash;
    this.cash = Math.max(0, Math.round(this.cash + amount));
    return this.cash;
  }

  adjustDebugChips(amount: number): number {
    if (!Number.isFinite(amount)) return this.availableChips;
    const delta = Math.round(amount);
    if (delta > 0) {
      this.chips += delta;
      return this.availableChips;
    }
    let remaining = Math.min(this.availableChips, Math.abs(delta));
    const regular = Math.min(this.chips, remaining);
    this.chips -= regular;
    remaining -= regular;
    this.mudChips = Math.max(0, this.mudChips - remaining);
    return this.availableChips;
  }

  get debugGameplayConfig(): DebugGameplayConfig {
    return {
      ...this.debugGameplay,
      restaurantIncomePerCycle: this.debugRestaurantIncomeOverride
        ?? restaurantLevels[this.restaurant.level - 1]!.chipsOnSuccess,
    };
  }

  setDebugGameplayConfig(values: Partial<DebugGameplayConfig>): void {
    if (values.restaurantIncomePerCycle !== undefined && Number.isFinite(values.restaurantIncomePerCycle)) {
      this.debugRestaurantIncomeOverride = Math.max(0, Math.round(values.restaurantIncomePerCycle));
    }
    if (values.restaurantCycleWorldMinutes !== undefined && Number.isFinite(values.restaurantCycleWorldMinutes)) {
      this.debugGameplay.restaurantCycleWorldMinutes = Math.max(1, values.restaurantCycleWorldMinutes);
    }
    if (values.worldMinutesPerRealSecondOutsideCasino !== undefined && Number.isFinite(values.worldMinutesPerRealSecondOutsideCasino)) {
      this.debugGameplay.worldMinutesPerRealSecondOutsideCasino = Math.max(0, values.worldMinutesPerRealSecondOutsideCasino);
    }
    if (values.worldMinutesPerRealSecondInsideCasino !== undefined && Number.isFinite(values.worldMinutesPerRealSecondInsideCasino)) {
      this.debugGameplay.worldMinutesPerRealSecondInsideCasino = Math.max(0, values.worldMinutesPerRealSecondInsideCasino);
    }
    if (values.sleepDebtPerMidnightWorldMinutes !== undefined && Number.isFinite(values.sleepDebtPerMidnightWorldMinutes)) {
      this.debugGameplay.sleepDebtPerMidnightWorldMinutes = Math.max(0, values.sleepDebtPerMidnightWorldMinutes);
    }
    if (values.sleepDebtThresholdWorldMinutes !== undefined && Number.isFinite(values.sleepDebtThresholdWorldMinutes)) {
      this.debugGameplay.sleepDebtThresholdWorldMinutes = Math.max(1, values.sleepDebtThresholdWorldMinutes);
      this.refreshSleepDeprivationSchedule();
    }
  }

  resetDebugOptions(): void {
    this.debugBaseConfidence = BASE_CONFIDENCE;
    this.debugConfidenceForced = false;
    this.debugRestaurantIncomeOverride = null;
    this.debugGameplay = defaultDebugGameplayConfig();
    this.refreshDebugConfidence();
    this.refreshSleepDeprivationSchedule();
  }

  private refreshSleepDeprivationSchedule(): void {
    if (this.sleepDebtWorldMinutes >= this.debugGameplay.sleepDebtThresholdWorldMinutes) {
      this.sleepDeprivationCollapseAtWorldMinute ??= nextSleepDeprivationCheckAt(this.worldMinutes);
    } else {
      this.sleepDeprivationCollapseAtWorldMinute = null;
    }
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

  settle(): SettlementResult {
    if (!this.pending) throw new Error("No pending round");
    if (this.pendingChain) return this.settleChainLeg();
    const { tableId, result, bet, betCurrency, createdRoadPrediction } = this.pending;
    const table = this.table(tableId);
    table.history.push(result);
    table.round += 1;
    this.trimTableHistory(table);

    let payout = 0;
    let delta = bet ? (betCurrency === "chip" ? 0 : -bet.amount) : 0;
    if (bet && result.outcome === "tie" && bet.side !== "tie") {
      if (betCurrency === "chip") this.refundChips(bet.amount / 100);
      else payout = bet.amount;
      delta = 0;
    } else if (bet && result.outcome === bet.side) {
      payout = bet.side === "tie" ? bet.amount * 9 : bet.side === "banker" ? Math.floor(bet.amount * 1.95) : bet.amount * 2;
      delta = betCurrency === "chip" ? payout : payout - bet.amount;
    }
    this.cash += payout;
    if (bet && payout > 0 && betCurrency === "chip") table.dealerCash = Math.max(0, table.dealerCash - payout);
    const dealerReward = this.grantDealerReward(table);

    if (bet) {
      const day = this.worldTimeInfo().day;
      this.dailyBetProfit.set(day, (this.dailyBetProfit.get(day) ?? 0) + delta);
      if (delta > 0) this.roundWinStreak += 1;
      else if (delta < 0) this.roundWinStreak = 0;
    }

    let roadCreation: RoadCreationResolution | null = null;
    if (createdRoadPrediction) {
      const matched = result.outcome === createdRoadPrediction;
      const confidencePenalty = matched ? 0 : 0.05;
      roadCreation = { predicted: createdRoadPrediction, actual: result.outcome, matched, confidencePenalty };
      if (matched) {
        const remaining = this.roadCreationSequence(tableId).slice(1);
        if (remaining.length) this.roadCreations.set(tableId, remaining);
        else this.roadCreations.delete(tableId);
      } else {
        this.roadCreations.delete(tableId);
      }
      if (!matched && !this.debugConfidenceForced) this.confidence = Math.max(0, this.confidence - confidencePenalty);
    }

    this.pending = null;
    return { delta, income: 0, roadCreation, dealerReward };
  }

  tickRealtime(now: number, pausedTableId: string | null, insideCasino = false, worldTimePaused = false, pauseAtRestaurantClose = false): { income: number; tablesAdvanced: number; advancedTableIds: string[]; restaurantClosingReached: boolean; sleepDeprivationStarted: boolean; sleepDeprivationCollapseReached: boolean } {
    const elapsed = Math.max(0, now - this.lastRealtimeAt);
    this.lastRealtimeAt = now;
    const worldMinutesPerRealSecond = insideCasino
      ? this.debugGameplay.worldMinutesPerRealSecondInsideCasino
      : this.debugGameplay.worldMinutesPerRealSecondOutsideCasino;
    const requestedWorldMinutes = worldTimePaused ? 0 : elapsed / 1000 * worldMinutesPerRealSecond;
    const sleepDebtThreshold = this.debugGameplay.sleepDebtThresholdWorldMinutes;
    const sleepDebtPerMidnight = this.debugGameplay.sleepDebtPerMidnightWorldMinutes;
    const wasSleepDeprived = this.sleepDebtWorldMinutes >= sleepDebtThreshold;
    const closeInMinutes = this.restaurant.open ? this.restaurant.closeAtWorldMinute - this.worldMinutes : Number.POSITIVE_INFINITY;
    const crossesRestaurantClose = requestedWorldMinutes > 0 && closeInMinutes >= 0 && closeInMinutes <= requestedWorldMinutes;
    const restaurantPromptInMinutes = pauseAtRestaurantClose && crossesRestaurantClose ? closeInMinutes : Number.POSITIVE_INFINITY;
    const sleepDebtThresholdInMinutes = this.sleepDebtWorldMinutes >= sleepDebtThreshold || sleepDebtPerMidnight <= 0
      ? Number.POSITIVE_INFINITY
      : this.nextSleepDebtAtWorldMinute - this.worldMinutes + Math.max(0, Math.ceil((sleepDebtThreshold - this.sleepDebtWorldMinutes) / sleepDebtPerMidnight) - 1) * 1440;
    const reachesSleepDebtThreshold = requestedWorldMinutes > 0
      && sleepDebtThresholdInMinutes >= 0
      && sleepDebtThresholdInMinutes <= Math.min(requestedWorldMinutes, restaurantPromptInMinutes);
    const sleepDeprivationNoticeInMinutes = reachesSleepDebtThreshold ? sleepDebtThresholdInMinutes : Number.POSITIVE_INFINITY;
    if (reachesSleepDebtThreshold) {
      const thresholdAt = this.worldMinutes + sleepDebtThresholdInMinutes;
      this.sleepDeprivationCollapseAtWorldMinute = nextSleepDeprivationCheckAt(thresholdAt);
    }
    const collapseInMinutes = this.sleepDeprivationCollapseAtWorldMinute === null
      ? Number.POSITIVE_INFINITY
      : this.sleepDeprivationCollapseAtWorldMinute - this.worldMinutes;
    const crossesSleepDeprivationCollapse = requestedWorldMinutes > 0 && collapseInMinutes >= 0 && collapseInMinutes <= requestedWorldMinutes;
    const collapsePromptInMinutes = crossesSleepDeprivationCollapse ? collapseInMinutes : Number.POSITIVE_INFINITY;
    const elapsedWorldMinutes = Math.min(requestedWorldMinutes, restaurantPromptInMinutes, sleepDeprivationNoticeInMinutes, collapsePromptInMinutes);
    const restaurantClosingReached = restaurantPromptInMinutes === elapsedWorldMinutes && restaurantPromptInMinutes < collapsePromptInMinutes;
    const sleepDeprivationCollapseReached = collapsePromptInMinutes === elapsedWorldMinutes;
    const restaurantOperatingMinutes = !insideCasino && this.restaurant.open
      ? Math.min(elapsedWorldMinutes, Math.max(0, closeInMinutes))
      : 0;
    this.worldMinutes += elapsedWorldMinutes;
    const crossedMidnights = this.worldMinutes >= this.nextSleepDebtAtWorldMinute
      ? Math.floor((this.worldMinutes - this.nextSleepDebtAtWorldMinute) / 1440) + 1
      : 0;
    if (crossedMidnights > 0) {
      this.sleepDebtWorldMinutes += crossedMidnights * sleepDebtPerMidnight;
      this.nextSleepDebtAtWorldMinute += crossedMidnights * 1440;
      this.resetDealerFunds();
      for (let day = 0; day < crossedMidnights; day += 1) this.rollDailyCheatSkills();
    }
    const sleepDeprivationStarted = reachesSleepDebtThreshold || (!wasSleepDeprived && this.sleepDebtWorldMinutes >= sleepDebtThreshold);
    let income = 0;
    let tablesAdvanced = 0;
    const advancedTableIds: string[] = [];

    if (!this.restaurant.pawned && restaurantOperatingMinutes > 0) {
      this.restaurant.cycleElapsedWorldMinutes += restaurantOperatingMinutes;
      while (this.restaurant.cycleElapsedWorldMinutes >= this.debugGameplay.restaurantCycleWorldMinutes) {
        this.restaurant.cycleElapsedWorldMinutes -= this.debugGameplay.restaurantCycleWorldMinutes;
        const level = restaurantLevels[this.restaurant.level - 1]!;
        const chipsOnSuccess = this.debugRestaurantIncomeOverride ?? level.chipsOnSuccess;
        if (this.debugRestaurantIncomeOverride !== null || this.rng.next() < level.chipChance) {
          this.chips += chipsOnSuccess;
          income += chipsOnSuccess;
        }
      }
    }
    if (crossesRestaurantClose && !restaurantClosingReached && closeInMinutes <= elapsedWorldMinutes) this.closeRestaurant();

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
    return { income, tablesAdvanced, advancedTableIds, restaurantClosingReached, sleepDeprivationStarted, sleepDeprivationCollapseReached };
  }

  closeRestaurant(): void {
    this.restaurant.open = false;
  }

  continueRestaurantThroughNextClose(): boolean {
    if (this.restaurant.pawned) return false;
    this.restaurant.open = true;
    while (this.restaurant.closeAtWorldMinute <= this.worldMinutes) this.restaurant.closeAtWorldMinute += 1440;
    return true;
  }

  canOpenRestaurantNow(): boolean {
    const { hour } = this.worldTimeInfo();
    return !this.restaurant.pawned && !this.restaurant.open && hour >= 8 && hour < 20;
  }

  openRestaurant(): boolean {
    if (!this.canOpenRestaurantNow()) return false;
    const dayStart = Math.floor(this.worldMinutes / 1440) * 1440;
    this.restaurant.open = true;
    this.restaurant.closeAtWorldMinute = dayStart + RESTAURANT_CLOSING_MINUTE;
    return true;
  }

  canRestAtHome(): boolean {
    return true;
  }

  restUntilNextOpening(): { day: number; hour: number; minute: number } {
    const dayStart = Math.floor(this.worldMinutes / 1440) * 1440;
    const nextOpening = dayStart + 1440 + RESTAURANT_OPENING_MINUTE;
    return this.finishRest(nextOpening);
  }

  restUntilNaturalWake(): { day: number; hour: number; minute: number } {
    if (!this.canRestUntilNaturalWake()) {
      this.lastSleepDurationWorldMinutes = 0;
      return this.worldTimeInfo();
    }
    let wakeAt = this.worldMinutes;
    let remainingDebt = this.sleepDebtWorldMinutes;
    while (remainingDebt > 0) {
      const nextMidnight = Math.floor(wakeAt / 1440) * 1440 + 1440;
      const minutesUntilMidnight = nextMidnight - wakeAt;
      if (remainingDebt < minutesUntilMidnight) {
        wakeAt += remainingDebt;
        remainingDebt = 0;
        break;
      }
      remainingDebt -= minutesUntilMidnight;
      wakeAt = nextMidnight;
      remainingDebt += this.debugGameplay.sleepDebtPerMidnightWorldMinutes;
    }
    return this.finishRest(wakeAt);
  }

  canRestUntilNaturalWake(): boolean {
    return this.sleepDebtWorldMinutes >= MINIMUM_NATURAL_WAKE_DEBT_WORLD_MINUTES;
  }

  private finishRest(wakeAt: number): { day: number; hour: number; minute: number } {
    const restStartedAt = this.worldMinutes;
    let remainingDebt = this.sleepDebtWorldMinutes;
    let cursor = restStartedAt;
    while (cursor < wakeAt) {
      const nextMidnight = Math.floor(cursor / 1440) * 1440 + 1440;
      const segmentEnd = Math.min(wakeAt, nextMidnight);
      remainingDebt = Math.max(0, remainingDebt - (segmentEnd - cursor));
      cursor = segmentEnd;
      if (cursor === nextMidnight) remainingDebt += this.debugGameplay.sleepDebtPerMidnightWorldMinutes;
    }
    this.closeRestaurant();
    this.worldMinutes = wakeAt;
    this.lastSleepDurationWorldMinutes = wakeAt - restStartedAt;
    this.sleepDebtWorldMinutes = remainingDebt;
    this.nextSleepDebtAtWorldMinute = Math.floor(wakeAt / 1440) * 1440 + 1440;
    this.sleepDeprivationCollapseAtWorldMinute = remainingDebt >= this.debugGameplay.sleepDebtThresholdWorldMinutes
      ? nextSleepDeprivationCheckAt(wakeAt)
      : null;
    this.lastRealtimeAt = Date.now();
    return this.worldTimeInfo();
  }

  isSleepDeprived(): boolean {
    return this.sleepDebtWorldMinutes >= this.debugGameplay.sleepDebtThresholdWorldMinutes;
  }

  recoverFromSleepDeprivation(): { day: number; hour: number; minute: number } {
    return this.restUntilNaturalWake();
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
    this.closeRestaurant();
    this.cash += value;
    return value;
  }

  restaurantChipInfo() {
    const current = restaurantLevels[this.restaurant.level - 1]!;
    return {
      chance: current.chipChance,
      chipsOnSuccess: current.chipsOnSuccess,
      pawnLotChips: Math.max(1, Math.floor(current.pawn / 1000)),
      pawnCapacityCash: Math.max(0, current.pawn - this.restaurant.pawnDebtCash),
      pawnDebtCash: this.restaurant.pawnDebtCash,
    };
  }

  pawnRestaurantForChips(): number {
    if (this.restaurant.pawned) return 0;
    const info = this.restaurantChipInfo();
    const lotCash = Math.min(info.pawnCapacityCash, info.pawnLotChips * 100);
    if (lotCash <= 0) return 0;
    const chips = Math.floor(lotCash / 100);
    this.restaurant.pawnDebtCash += lotCash;
    this.mudChips += chips;
    if (this.restaurantChipInfo().pawnCapacityCash < 100) {
      this.restaurant.pawned = true;
      this.closeRestaurant();
    }
    return chips;
  }

  redeemRestaurant(): boolean {
    const debt = this.restaurant.pawnDebtCash;
    if (debt <= 0 || this.cash < Math.ceil(debt * 2.5)) return false;
    this.cash -= Math.ceil(debt * 2.5);
    this.restaurant.pawnDebtCash = 0;
    this.restaurant.pawned = false;
    this.restaurant.open = true;
    this.restaurant.closeAtWorldMinute = Math.floor(this.worldMinutes / 1440) * 1440 + RESTAURANT_CLOSING_MINUTE;
    return true;
  }

  restaurantInfo() {
    const current = restaurantLevels[this.restaurant.level - 1]!;
    const next = restaurantLevels[this.restaurant.level];
    return { ...current, income: 0, chipsOnSuccess: this.debugRestaurantIncomeOverride ?? current.chipsOnSuccess, pawnLotChips: Math.max(1, Math.floor(current.pawn / 1000)), nextCost: next?.cost ?? null, pawnDebtCash: this.restaurant.pawnDebtCash, pawnCapacityCash: Math.max(0, current.pawn - this.restaurant.pawnDebtCash) };
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
    return this.cash <= 0 && this.availableChips <= 0 && this.restaurantInfo().pawnCapacityCash <= 0;
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
