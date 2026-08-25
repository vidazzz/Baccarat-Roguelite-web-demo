import { describe, expect, it, vi } from "vitest";
import {
  BASE_CONFIDENCE,
  divineCardTypeForRank,
  Game,
  LOBBY_ROUND_MS,
  RESTAURANT_CLOSING_MINUTE,
  RESTAURANT_CYCLE_WORLD_MINUTES,
  SLEEP_DEBT_PER_MIDNIGHT_WORLD_MINUTES,
  SLEEP_DEBT_THRESHOLD_WORLD_MINUTES,
  WORLD_MINUTES_PER_REAL_SECOND_INSIDE_CASINO,
  WORLD_MINUTES_PER_REAL_SECOND_OUTSIDE_CASINO,
  inlineWatchSteps,
} from "./game";
import { confidenceRoadStartColumn, type RoundResult } from "./domain";

const historyRound = (outcome: RoundResult["outcome"], id: number): RoundResult => ({
  id, outcome, bankerCards: [{ rank: 7, suit: "spade" }, { rank: 2, suit: "heart" }],
  playerCards: [{ rank: 4, suit: "club" }, { rank: 3, suit: "diamond" }],
  bankerPoints: 9, playerPoints: 7, natural: true,
});

describe("Divine Assist card types", () => {
  it("classifies every rank by its edge type", () => {
    expect([1, 2, 3].map(divineCardTypeForRank)).toEqual(["no-edge", "no-edge", "no-edge"]);
    expect([4, 5].map(divineCardTypeForRank)).toEqual(["two-edge", "two-edge"]);
    expect([6, 7, 8].map(divineCardTypeForRank)).toEqual(["three-edge", "three-edge", "three-edge"]);
    expect([9, 10].map(divineCardTypeForRank)).toEqual(["four-edge", "four-edge"]);
    expect([11, 12, 13].map(divineCardTypeForRank)).toEqual(["face", "face", "face"]);
  });
});

describe("chain wagering and chip economy", () => {
  it("locks one chip stake and settles independent targets with ties removed", () => {
    const game = new Game();
    const beforeChips = game.chips;
    expect(game.reserveChainStake(300, "harbor-1")).toBe(true);
    expect(game.chips).toBe(beforeChips - 3);
    const pending = game.playChain("harbor-1", ["banker", "player", "banker"]);
    pending.legs[0]!.result.outcome = "banker";
    pending.legs[1]!.result.outcome = "tie";
    pending.legs[2]!.result.outcome = "banker";
    const settlement = game.settleChain();
    expect(settlement.effectiveRounds).toBe(2);
    expect(settlement.won).toBe(true);
    expect(settlement.payout).toBe(300 * 4);
    expect(game.cash).toBe(8000 + 1200);
  });

  it("loses the whole chain when one non-tie leg misses", () => {
    const game = new Game();
    game.reserveChainStake(200, "harbor-1");
    const pending = game.playChain("harbor-1", ["banker", "player"]);
    pending.legs[0]!.result.outcome = "banker";
    pending.legs[1]!.result.outcome = "banker";
    const settlement = game.settleChain();
    expect(settlement.won).toBe(false);
    expect(settlement.payout).toBe(0);
    expect(game.cash).toBe(8000);
  });

  it("keeps the next leg pending until the current leg settles", () => {
    const game = new Game();
    game.reserveChainStake(200, "harbor-1");
    const chain = game.playChain("harbor-1", ["banker", "player"]);
    chain.legs[0]!.result.outcome = "banker";
    chain.legs[1]!.result.outcome = "player";
    const first = game.settle();
    expect(first.chainContinues).toBe(true);
    expect(game.pending).toBeNull();
    expect(game.selectChainLeg(1)?.bet?.side).toBe("player");
    const final = game.settle();
    expect(final.chainCompleted).toBe(true);
    expect(game.pending).toBeNull();
  });

  it("allows chain legs to settle in any order", () => {
    const game = new Game();
    game.reserveChainStake(200, "harbor-1");
    const chain = game.playChain("harbor-1", ["banker", "player"]);
    chain.legs[0]!.result.outcome = "banker";
    chain.legs[1]!.result.outcome = "player";
    game.selectChainLeg(1);
    expect(game.settle().chainContinues).toBe(true);
    expect(game.selectChainLeg(0)?.bet?.side).toBe("banker");
    expect(game.settle().chainCompleted).toBe(true);
  });

  it("projects confirmed bet targets into the shared road sequence", () => {
    const game = new Game();
    game.setRoadCreationSequence("harbor-1", ["banker", "player"]);
    expect(game.roadCreationSequence("harbor-1")).toEqual(["banker", "player"]);
    expect(game.roadAnalysisHistory("harbor-1")).toHaveLength(game.table("harbor-1").history.length + 2);
  });

  it("supports repeated pawn lots with a redemption multiplier", () => {
    const game = new Game();
    const first = game.pawnRestaurantForChips();
    const second = game.pawnRestaurantForChips();
    expect(first).toBe(4);
    expect(second).toBe(4);
    expect(game.mudChips).toBe(8);
    expect(game.restaurant.pawnDebtCash).toBe(800);
    expect(game.redeemRestaurant()).toBe(true);
    expect(game.cash).toBe(8000 - 2000);
    expect(game.restaurant.pawnDebtCash).toBe(0);
  });
});

describe("real-time simulation", () => {
  it("rerolls each table's dealer collateral when a new day begins", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    const before = { kind: table.dealerRewardKind, chips: table.dealerRewardChips };
    game.worldMinutes = 1440 - 1;
    game.tickRealtime(Date.now() + 1000, null, false, false, false);
    expect(table.dealerRewardClaimed).toBe(false);
    expect(["chips", "cheat-skill"]).toContain(table.dealerRewardKind);
    expect(table.dealerRewardChips).toBeGreaterThanOrEqual(3);
    expect(table.dealerRewardChips).toBeLessThanOrEqual(10);
    expect(before.kind === table.dealerRewardKind && before.chips === table.dealerRewardChips).toBe(false);
  });
  it("pays restaurant income by elapsed time", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    const before = game.chips;
    game.setDebugGameplayConfig({ restaurantIncomePerCycle: 1 });
    game.tickRealtime(1_000 + 1_000, null, false);
    expect(game.chips).toBe(before + 1);
    vi.restoreAllMocks();
  });

  it("advances lobby tables but pauses the occupied table", () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const game = new Game();
    const paused = game.table("harbor-1");
    const running = game.table("harbor-2");
    const pausedRound = paused.round;
    const runningRound = running.round;
    game.tickRealtime(5_000 + LOBBY_ROUND_MS, paused.id);
    expect(paused.round).toBe(pausedRound);
    expect(running.round).toBeGreaterThan(runningRound);
    vi.restoreAllMocks();
  });

  it("advances world time at one game hour per real second outside the casino", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.tickRealtime(2_000, null, false);
    expect(game.worldMinutes).toBe(18 * 60 + 60);
    expect(game.restaurant.cycleElapsedWorldMinutes).toBe(0);
    vi.restoreAllMocks();
  });

  it("advances world time at one game minute per real second inside the casino", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.tickRealtime(2_000, null, true);
    expect(game.worldMinutes).toBe(18 * 60 + 1);
    expect(game.restaurant.cycleElapsedWorldMinutes).toBe(0);
    vi.restoreAllMocks();
  });

  it("stops restaurant income inside the casino and resumes it after leaving", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.restaurant.cycleElapsedWorldMinutes = 30;
    const before = game.cash;

    game.tickRealtime(31_000, null, true);
    expect(game.cash).toBe(before);
    expect(game.restaurant.cycleElapsedWorldMinutes).toBe(30);

    game.tickRealtime(32_000, null, false);
    expect(game.cash).toBe(before + game.restaurantInfo().income);
    expect(game.restaurant.cycleElapsedWorldMinutes).toBe(30);
    expect(RESTAURANT_CYCLE_WORLD_MINUTES).toBe(60);
    vi.restoreAllMocks();
  });

  it("rolls the world clock into the next day after 24 hours", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();

    game.tickRealtime(7_000, null, false);

    expect(game.worldTimeInfo()).toEqual({ day: 2, hour: 0, minute: 0 });
    vi.restoreAllMocks();
  });

  it("pauses world time and restaurant progress while real-time tables keep advancing", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    const runningTable = game.table("harbor-2");
    const runningRound = runningTable.round;
    game.tickRealtime(1_000 + LOBBY_ROUND_MS, "harbor-1", true, true);

    expect(game.worldMinutes).toBe(18 * 60);
    expect(game.restaurant.cycleElapsedWorldMinutes).toBe(0);
    expect(runningTable.round).toBeGreaterThan(runningRound);
    vi.restoreAllMocks();
  });

  it("stops exactly at closing time when the player is in the restaurant", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    const before = game.cash;
    const tick = game.tickRealtime(3_000, null, false, false, true);

    expect(game.worldMinutes).toBe(RESTAURANT_CLOSING_MINUTE);
    expect(game.cash).toBe(before + game.restaurantInfo().income * 2);
    expect(game.restaurant.open).toBe(true);
    expect(tick.restaurantClosingReached).toBe(true);
    vi.restoreAllMocks();
  });

  it("accumulates eight hours of sleep debt at each midnight", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.tickRealtime(3_000, null, false, false, true);
    expect(game.continueRestaurantThroughNextClose()).toBe(true);

    const morning = game.tickRealtime(27_000, null, false, false, true);
    expect(game.worldTimeInfo()).toEqual({ day: 2, hour: 20, minute: 0 });
    expect(morning.sleepDeprivationStarted).toBe(false);
    expect(morning.sleepDeprivationCollapseReached).toBe(false);
    expect(game.sleepDebtWorldMinutes).toBe(8 * 60);
    expect(morning.restaurantClosingReached).toBe(true);

    game.continueRestaurantThroughNextClose();
    const secondMidnight = game.tickRealtime(31_000, null, false, false, true);
    expect(game.worldTimeInfo()).toEqual({ day: 3, hour: 0, minute: 0 });
    expect(secondMidnight.sleepDeprivationStarted).toBe(true);
    expect(game.sleepDebtWorldMinutes).toBe(16 * 60);
    vi.restoreAllMocks();
  });

  it("automatically closes when closing time passes away from the restaurant", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    const before = game.cash;
    game.tickRealtime(4_000, null, false);

    expect(game.worldTimeInfo()).toEqual({ day: 1, hour: 21, minute: 0 });
    expect(game.cash).toBe(before + game.restaurantInfo().income * 2);
    expect(game.restaurant.open).toBe(false);
    vi.restoreAllMocks();
  });

  it("reopens a closed restaurant until the next closing time", () => {
    const game = new Game();
    game.worldMinutes = 21 * 60;
    game.closeRestaurant();

    expect(game.continueRestaurantThroughNextClose()).toBe(true);
    expect(game.restaurant.open).toBe(true);
    expect(game.restaurant.closeAtWorldMinute).toBe(1440 + RESTAURANT_CLOSING_MINUTE);
  });

  it("rests until the next 08:00 and can open for the new day", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.tickRealtime(3_000, null, false);
    expect(game.restaurant.open).toBe(false);

    expect(game.restUntilNextOpening()).toEqual({ day: 2, hour: 8, minute: 0 });
    expect(game.openRestaurant()).toBe(true);
    expect(game.restaurant.closeAtWorldMinute).toBe(1440 + RESTAURANT_CLOSING_MINUTE);
    vi.restoreAllMocks();
  });

  it("allows rest at any time and jumps to the following day 08:00", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.worldMinutes = 6 * 60;

    expect(game.restUntilNextOpening()).toEqual({ day: 2, hour: 8, minute: 0 });
    expect(game.lastSleepDurationWorldMinutes).toBe(26 * 60);
    expect(game.isSleepDeprived()).toBe(false);
    vi.restoreAllMocks();
  });

  it("counts a new midnight debt while sleeping to natural wake", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.worldMinutes = 18 * 60;
    game.sleepDebtWorldMinutes = 8 * 60;
    game.nextSleepDebtAtWorldMinute = 1440;

    expect(game.restUntilNaturalWake()).toEqual({ day: 2, hour: 10, minute: 0 });
    expect(game.lastSleepDurationWorldMinutes).toBe(16 * 60);
    expect(game.sleepDebtWorldMinutes).toBe(0);
    vi.restoreAllMocks();
  });

  it("does not start natural wake with less than one hour of debt", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.worldMinutes = 22 * 60;
    game.sleepDebtWorldMinutes = 0;
    game.restaurant.open = true;

    expect(game.canRestUntilNaturalWake()).toBe(false);
    expect(game.restUntilNaturalWake()).toEqual({ day: 1, hour: 22, minute: 0 });
    expect(game.lastSleepDurationWorldMinutes).toBe(0);
    expect(game.restaurant.open).toBe(true);
    vi.restoreAllMocks();
  });

  it("keeps uncleared debt after sleeping only until 08:00", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.worldMinutes = 18 * 60;
    game.sleepDebtWorldMinutes = 8 * 60;
    game.nextSleepDebtAtWorldMinute = 1440;

    expect(game.restUntilNextOpening()).toEqual({ day: 2, hour: 8, minute: 0 });
    expect(game.sleepDebtWorldMinutes).toBe(2 * 60);
    vi.restoreAllMocks();
  });

  it("triggers collapse at 08:00 on the same day sleep deprivation starts", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.sleepDebtWorldMinutes = 2 * 60;

    const deprivation = game.tickRealtime(7_000, null, false);
    expect(game.worldTimeInfo()).toEqual({ day: 2, hour: 0, minute: 0 });
    expect(deprivation.sleepDeprivationStarted).toBe(true);
    expect(game.sleepDeprivationCollapseAtWorldMinute).toBe(1440 + 8 * 60);

    const collapse = game.tickRealtime(15_000, null, false);
    expect(game.worldTimeInfo()).toEqual({ day: 2, hour: 8, minute: 0 });
    expect(collapse.sleepDeprivationCollapseReached).toBe(true);
    vi.restoreAllMocks();
  });

  it("recovers from a collapse at home until the following 08:00", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.worldMinutes = 1440 + 15 * 60;
    game.sleepDebtWorldMinutes = 10 * 60;
    game.sleepDeprivationCollapseAtWorldMinute = game.worldMinutes;

    expect(game.recoverFromSleepDeprivation()).toEqual({ day: 3, hour: 9, minute: 0 });
    expect(game.isSleepDeprived()).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("debug gameplay configuration", () => {
  it("adds or removes 100,000 cash without allowing a negative balance", () => {
    const game = new Game();

    expect(game.adjustDebugCash(100_000)).toBe(108_000);
    expect(game.adjustDebugCash(-100_000)).toBe(8_000);
    expect(game.adjustDebugCash(-100_000)).toBe(0);
    expect(game.cash).toBe(0);
  });

  it("uses the configured restaurant payout and cycle duration", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    const before = game.chips;
    game.setDebugGameplayConfig({ restaurantIncomePerCycle: 125, restaurantCycleWorldMinutes: 30 });

    const tick = game.tickRealtime(2_000, null, false);

    expect(tick.income).toBe(250);
    expect(game.chips).toBe(before + 250);
    expect(game.restaurant.cycleElapsedWorldMinutes).toBe(0);
    vi.restoreAllMocks();
  });

  it("settles accumulated progress against a newly shortened cycle", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    const before = game.chips;
    game.restaurant.cycleElapsedWorldMinutes = 55;
    game.setDebugGameplayConfig({ restaurantIncomePerCycle: 100, restaurantCycleWorldMinutes: 20 });

    game.tickRealtime(2_000, null, false);

    expect(game.chips).toBe(before + 500);
    expect(game.restaurant.cycleElapsedWorldMinutes).toBe(15);
    vi.restoreAllMocks();
  });

  it("uses separate configured world-time rates inside and outside casinos", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.setDebugGameplayConfig({
      worldMinutesPerRealSecondOutsideCasino: 10,
      worldMinutesPerRealSecondInsideCasino: 2.5,
    });

    game.tickRealtime(2_000, null, false);
    expect(game.worldMinutes).toBe(18 * 60 + 10);
    game.tickRealtime(3_000, null, true);
    expect(game.worldMinutes).toBe(18 * 60 + 12.5);
    vi.restoreAllMocks();
  });

  it("uses configured daily sleep debt and fatigue threshold", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    game.setDebugGameplayConfig({
      sleepDebtPerMidnightWorldMinutes: 3 * 60,
      sleepDebtThresholdWorldMinutes: 3 * 60,
    });

    const tick = game.tickRealtime(7_000, null, false);

    expect(game.sleepDebtWorldMinutes).toBe(3 * 60);
    expect(game.isSleepDeprived()).toBe(true);
    expect(tick.sleepDeprivationStarted).toBe(true);
    vi.restoreAllMocks();
  });

  it("restores every debug option and returns income to the current level default", () => {
    const game = new Game();
    game.setDebugBaseConfidence(0.65);
    game.setDebugConfidenceForced(true);
    game.setDebugGameplayConfig({
      restaurantIncomePerCycle: 999,
      restaurantCycleWorldMinutes: 12,
      worldMinutesPerRealSecondOutsideCasino: 15,
      worldMinutesPerRealSecondInsideCasino: 4,
      sleepDebtPerMidnightWorldMinutes: 120,
      sleepDebtThresholdWorldMinutes: 180,
    });
    expect(game.upgradeRestaurant()).toBe(true);

    game.resetDebugOptions();

    expect(game.debugBaseConfidence).toBe(BASE_CONFIDENCE);
    expect(game.debugConfidenceForced).toBe(false);
    expect(game.debugGameplayConfig).toEqual({
      restaurantIncomePerCycle: 1,
      restaurantCycleWorldMinutes: RESTAURANT_CYCLE_WORLD_MINUTES,
      worldMinutesPerRealSecondOutsideCasino: WORLD_MINUTES_PER_REAL_SECOND_OUTSIDE_CASINO,
      worldMinutesPerRealSecondInsideCasino: WORLD_MINUTES_PER_REAL_SECOND_INSIDE_CASINO,
      sleepDebtPerMidnightWorldMinutes: SLEEP_DEBT_PER_MIDNIGHT_WORLD_MINUTES,
      sleepDebtThresholdWorldMinutes: SLEEP_DEBT_THRESHOLD_WORLD_MINUTES,
    });
  });
});

describe("tie betting", () => {
  it("pays a winning tie bet at 8 to 1 plus returned stake", () => {
    const game = new Game();
    const pending = game.play("harbor-1", { side: "tie", amount: 100 });
    pending.result.outcome = "tie";
    const settlement = game.settle();
    expect(settlement.delta).toBe(800);
    expect(game.cash).toBe(8_800);
  });
});

describe("staged chip betting", () => {
  it("deducts each chip immediately and does not charge again on confirmation", () => {
    const game = new Game();

    expect(game.reserveBetChip(100)).toBe(true);
    expect(game.reserveBetChip(200)).toBe(true);
    expect(game.cash).toBe(7_700);
    expect(game.reservedBetAmount).toBe(300);

    game.play("harbor-1", { side: "player", amount: 300 });
    expect(game.cash).toBe(7_700);
    expect(game.reservedBetAmount).toBe(0);
  });

  it("refunds all staged chips with one cancellation", () => {
    const game = new Game();
    game.reserveBetChip(100);
    game.reserveBetChip(500);

    expect(game.cancelReservedBet()).toBe(600);
    expect(game.cash).toBe(8_000);
    expect(game.reservedBetAmount).toBe(0);
  });

  it("rejects mismatched confirmation and watching with staged chips", () => {
    const game = new Game();
    game.reserveBetChip(100);

    expect(() => game.play("harbor-1", { side: "banker", amount: 200 })).toThrow("确认金额与暂存筹码不一致");
    expect(() => game.play("harbor-1", null)).toThrow("旁观前需取消暂存筹码");
    expect(game.cash).toBe(7_900);
    expect(game.reservedBetAmount).toBe(100);
  });
});

describe("inline watch animation", () => {
  it("deals and reveals the initial four before any supplemental cards", () => {
    const game = new Game();
    const result = game.play("harbor-1", null).result;
    result.playerCards = result.playerCards.slice(0, 2);
    result.bankerCards = result.bankerCards.slice(0, 2);
    result.playerCards.push({ rank: 3, suit: "club" });
    result.bankerCards.push({ rank: 4, suit: "heart" });

    expect(inlineWatchSteps(result)).toEqual([
      { kind: "deal", cardIndex: 0 }, { kind: "deal", cardIndex: 1 },
      { kind: "deal", cardIndex: 2 }, { kind: "deal", cardIndex: 3 },
      { kind: "reveal", cardIndex: 0 }, { kind: "reveal", cardIndex: 1 },
      { kind: "reveal", cardIndex: 2 }, { kind: "reveal", cardIndex: 3 },
      { kind: "deal", cardIndex: 4 }, { kind: "reveal", cardIndex: 4 },
      { kind: "deal", cardIndex: 5 }, { kind: "reveal", cardIndex: 5 },
    ]);
  });
});

describe("casino entry fees", () => {
  it("charges the configured fee each time a casino is entered", () => {
    const game = new Game();

    expect(game.enterCasino("harbor")).toBe(true);
    expect(game.cash).toBe(7_900);
    expect(game.enterCasino("grand")).toBe(true);
    expect(game.cash).toBe(6_900);
  });

  it("rejects entry without enough cash and does not change the balance", () => {
    const game = new Game();
    game.cash = 999;

    expect(game.enterCasino("grand")).toBe(false);
    expect(game.cash).toBe(999);
  });
});

describe("confidence settlement", () => {
  it("starts with zero base confidence and clears every road plan on a table", () => {
    const game = new Game();
    const table = game.table("harbor-1");

    expect(game.confidence).toBe(0);
    expect(game.debugBaseConfidence).toBe(0);

    game.markRoad(table.id, "big", 0, 0);
    game.markRoad(table.id, "small", 0, 0);
    game.markCurrentBeadRoad(table.id);
    game.appendRoadCreation(table.id, "banker");
    game.appendRoadCreation(table.id, "player");
    game.clearRoadPlanning(table.id);

    expect(game.roadMark(table.id, "bead")).toBeNull();
    expect(game.roadMark(table.id, "big")).toBeNull();
    expect(game.roadMark(table.id, "small")).toBeNull();
    expect(game.roadCreationSequence(table.id)).toEqual([]);
  });

  it("projects one created result into every road calculation and lets it form a marked road", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = Array.from({ length: 4 }, (_, index) => historyRound("banker", index));

    game.setRoadCreation(table.id, "banker");
    expect(game.roadCreation(table.id)).toBe("banker");
    expect(game.roadAnalysisHistory(table.id).map((round) => round.outcome)).toEqual([
      "banker", "banker", "banker", "banker", "banker",
    ]);

    game.markRoad(table.id, "big", 0, 0);
    expect(game.markedRoadPatterns(table.id).some((pattern) => pattern.id === "long-banker")).toBe(true);
    const pending = game.play(table.id, { side: "banker", amount: 100 });
    expect(pending.createdRoadPrediction).toBe("banker");
    expect(pending.confidenceBreakdown.markedPatternBonus).toBeCloseTo(0.05);
  });

  it("projects a continuous created-road sequence in order", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [historyRound("banker", 0)];

    game.appendRoadCreation(table.id, "player");
    game.appendRoadCreation(table.id, "banker");
    game.appendRoadCreation(table.id, "player");

    expect(game.roadCreationSequence(table.id)).toEqual(["player", "banker", "player"]);
    expect(game.roadAnalysisHistory(table.id).map((round) => round.outcome)).toEqual([
      "banker", "player", "banker", "player",
    ]);
  });

  it("treats a continuous chain wager as the projected road instead of the prior opposing road", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [historyRound("banker", 0)];
    game.setRoadCreationSequence(table.id, ["player", "player", "player", "player"]);

    const pending = game.play(table.id, { side: "player", amount: 100 });

    expect(pending.confidenceBreakdown.opposingPatterns.some((pattern) => pattern.id === "on-player-break")).toBe(false);
    expect(pending.confidenceBreakdown.markedPatterns.some((pattern) => pattern.id === "on-player-connect")).toBe(true);
  });

  it("uses the road before the final chain target to judge whether that target matches", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [historyRound("banker", 0), historyRound("player", 1), historyRound("banker", 2), historyRound("player", 3), historyRound("banker", 4), historyRound("player", 5)];
    game.setRoadCreationSequence(table.id, ["banker", "player"]);

    const pending = game.play(table.id, { side: "player", amount: 100 });

    expect(pending.confidenceBreakdown.opposingPatterns.some((pattern) => pattern.id === "single-jump")).toBe(false);
  });

  it("replaces an earlier created result and removes every result after it", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    game.appendRoadCreation(table.id, "banker");
    game.appendRoadCreation(table.id, "player");
    game.appendRoadCreation(table.id, "banker");

    expect(game.updateRoadCreation(table.id, 1, "banker")).toEqual(["banker", "banker"]);
    expect(game.roadCreationSequence(table.id)).toEqual(["banker", "banker"]);
  });

  it("cancels an earlier created result together with every result after it", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    game.appendRoadCreation(table.id, "banker");
    game.appendRoadCreation(table.id, "player");
    game.appendRoadCreation(table.id, "banker");

    expect(game.updateRoadCreation(table.id, 1, null)).toEqual(["banker"]);
    expect(game.roadCreationSequence(table.id)).toEqual(["banker"]);
  });

  it("clears a missed created road and immediately removes five confidence points", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [];
    game.setDebugBaseConfidence(0.4);
    game.setRoadCreation(table.id, "player");
    const pending = game.play(table.id, null);
    pending.result.outcome = "banker";

    const settlement = game.settle();

    expect(settlement.roadCreation).toEqual({
      predicted: "player",
      actual: "banker",
      matched: false,
      confidencePenalty: 0.05,
    });
    expect(game.roadCreation(table.id)).toBeNull();
    expect(game.confidence).toBeCloseTo(0.35);
  });

  it("consumes a matching created road without a confidence penalty", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [];
    game.setDebugBaseConfidence(0.4);
    game.setRoadCreation(table.id, "banker");
    const pending = game.play(table.id, null);
    pending.result.outcome = "banker";

    const settlement = game.settle();

    expect(settlement.roadCreation?.matched).toBe(true);
    expect(settlement.roadCreation?.confidencePenalty).toBe(0);
    expect(game.roadCreation(table.id)).toBeNull();
    expect(game.confidence).toBeCloseTo(0.4);
  });

  it("only consumes the first created result after a match", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [];
    game.appendRoadCreation(table.id, "banker");
    game.appendRoadCreation(table.id, "player");
    const pending = game.play(table.id, null);
    pending.result.outcome = "banker";

    const settlement = game.settle();

    expect(settlement.roadCreation?.matched).toBe(true);
    expect(game.roadCreationSequence(table.id)).toEqual(["player"]);
    expect(game.roadCreation(table.id)).toBe("player");
  });

  it("clears the full created sequence after the first result misses", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [];
    game.setDebugBaseConfidence(0.4);
    game.appendRoadCreation(table.id, "player");
    game.appendRoadCreation(table.id, "banker");
    const pending = game.play(table.id, null);
    pending.result.outcome = "banker";

    const settlement = game.settle();

    expect(settlement.roadCreation?.matched).toBe(false);
    expect(game.roadCreationSequence(table.id)).toEqual([]);
    expect(game.confidence).toBeCloseTo(0.35);
  });

  it("consumes a special-event next-round effect after it is applied", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    game.setNextRoundEffect({ kind: "lose" });

    const pending = game.play(table.id, { side: "banker", amount: 100 });

    expect(pending.result.outcome).toBe("player");
    expect(game.nextRoundEffect).toBeNull();
  });

  it("marks the whole bead plate regardless of whether the next-cell row forms a road", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = Array.from({ length: 24 }, (_, index) => historyRound(index % 6 === 0 ? "banker" : "player", index));

    expect(game.markCurrentBeadRoad(table.id).some((road) => road.id === "diamond-banker")).toBe(true);
    expect(game.roadMark(table.id, "bead")).toEqual({ roadBook: "bead", startColumn: 0, startRound: 0 });

    table.history = [historyRound("banker", 1), historyRound("player", 2), historyRound("banker", 3)];
    game.markRoad(table.id, "bead", 3, 18);
    expect(game.markCurrentBeadRoad(table.id)).toEqual([]);
    expect(game.roadMark(table.id, "bead")).toEqual({ roadBook: "bead", startColumn: 0, startRound: 0 });
  });

  it("advances the absolute bead offset when cached history is trimmed", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = Array.from({ length: 240 }, (_, index) => historyRound(index % 2 ? "player" : "banker", index));
    table.historyOffset = 12;

    game.play(table.id, null);
    game.settle();

    expect(table.history).toHaveLength(240);
    expect(table.historyOffset).toBe(13);
  });

  it("ignores lower-road marks in confidence settlement", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    const sequence = "BBBBPPPPPBBBBPBBPPPBBPBBBPBPPBBPPBBBBPPBBBBBPBBPBPBPBPBP";
    table.history = sequence.split("").map((value, index) => historyRound(value === "B" ? "banker" : "player", index));
    const exactStart = confidenceRoadStartColumn(table.history, "small")!;
    game.markRoad(table.id, "small", exactStart, 0);

    const pending = game.play(table.id, { side: "banker", amount: 100 });

    expect(pending.confidenceBreakdown.markedPatterns.some((pattern) => pattern.source === "small")).toBe(false);
    expect(pending.confidenceBreakdown.markedPatternBonus).toBe(0);
  });

  it("keeps lower-road marks out of the active rule set", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    const sequence = "BBBBPPPPPBBBBPBBPPPBBPBBBPBPPBBPPBBBBPPBBBBBPBBPBPBPBPBP";
    table.history = sequence.split("").map((value, index) => historyRound(value === "B" ? "banker" : "player", index));
    const exactStart = confidenceRoadStartColumn(table.history, "small")!;
    expect(exactStart).toBeGreaterThan(0);

    game.markRoad(table.id, "small", exactStart - 1, 0);
    expect(game.markedRoadPatterns(table.id).some((pattern) => pattern.source === "small")).toBe(false);

    game.markRoad(table.id, "small", exactStart, 0);
    expect(game.markedRoadPatterns(table.id).some((pattern) => pattern.source === "small")).toBe(false);
  });

  it("requires the exact big-road suffix column instead of accepting the first column", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    const runs = [["player", 5], ["banker", 1], ["player", 3], ["banker", 2], ["player", 4]] as const;
    table.history = runs.flatMap(([outcome, count]) => Array.from({ length: count }, (_, index) => historyRound(outcome, index)));
    const exactStart = confidenceRoadStartColumn(table.history, "big")!;
    expect(exactStart).toBeGreaterThan(0);

    game.markRoad(table.id, "big", 0, 0);
    expect(game.markedRoadPatterns(table.id).some((pattern) => pattern.source === "big")).toBe(false);

    game.markRoad(table.id, "big", exactStart, 0);
    expect(game.markedRoadPatterns(table.id).some((pattern) => pattern.id === "big-1324")).toBe(true);
  });

  it("adds confidence only when a marked road predicts the wagered side", () => {
    const game = new Game();
    game.table("harbor-1").history = Array.from({ length: 5 }, (_, index) => historyRound("banker", index));
    game.markRoad("harbor-1", "big", 0, 0);
    const pending = game.play("harbor-1", { side: "banker", amount: 100 });

    expect(pending.confidence).toBeCloseTo(0.05);
    expect(pending.confidenceBreakdown.markedPatternBonus).toBeCloseTo(0.05);
    expect(pending.confidenceBreakdown.lengthBonus).toBeCloseTo(0);
    expect(pending.confidencePrediction).toBe("banker");
    expect(game.divineAssistInfo().target).toBe("banker");
  });

  it("penalizes wagering against an active road even when it is not marked", () => {
    const game = new Game();
    game.table("harbor-1").history = Array.from({ length: 5 }, (_, index) => historyRound("banker", index));
    const pending = game.play("harbor-1", { side: "player", amount: 100 });

    expect(pending.confidence).toBeCloseTo(0);
    expect(pending.confidenceBreakdown.opposingPatternPenalty).toBeCloseTo(-0.05);
    expect(pending.confidencePrediction).toBeNull();
  });

  it("adds five points for every full ten percent of liquid wealth wagered", () => {
    const game = new Game();
    game.table("harbor-1").history = [];
    const pending = game.play("harbor-1", { side: "banker", amount: 800 });

    expect(pending.confidenceBreakdown.wagerBonus).toBeCloseTo(0.05);
    expect(pending.confidence).toBeCloseTo(0.05);
  });

  it("adds two points for each marked road length after length one", () => {
    const game = new Game();
    game.table("harbor-1").history = Array.from({ length: 6 }, (_, index) => historyRound("banker", index));
    game.markRoad("harbor-1", "big", 0, 0);
    const pending = game.play("harbor-1", { side: "banker", amount: 100 });

    expect(pending.confidenceBreakdown.markedPatterns.find((pattern) => pattern.id === "long-banker")?.length).toBe(2);
    expect(pending.confidenceBreakdown.lengthBonus).toBeCloseTo(0.02);
    expect(pending.confidence).toBeCloseTo(0.07);
  });

  it("adds round and previous profitable-day streak bonuses", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = [];
    const first = game.play(table.id, { side: "banker", amount: 100 });
    first.result.outcome = "banker";
    game.settle();
    game.worldMinutes = 1440;
    table.history = [];

    const next = game.play(table.id, { side: "banker", amount: 100 });
    expect(next.confidenceBreakdown.roundStreakBonus).toBeCloseTo(0.01);
    expect(next.confidenceBreakdown.dayStreakBonus).toBeCloseTo(0.05);
    expect(next.confidence).toBeCloseTo(0.06);
  });

  it("forces confidence to 100% and restores the previous value", () => {
    const game = new Game();
    game.setDebugConfidenceForced(true);
    expect(game.confidence).toBe(1);
    expect(game.debugConfidenceForced).toBe(true);
    game.setDebugConfidenceForced(false);
    expect(game.confidence).toBe(0);
  });

  it("uses the debug slider as base confidence while preserving the other modifiers", () => {
    const game = new Game();
    game.table("harbor-1").history = [];
    game.setDebugBaseConfidence(0.35);
    const pending = game.play("harbor-1", { side: "banker", amount: 800 });

    expect(pending.confidenceBreakdown.base).toBeCloseTo(0.35);
    expect(pending.confidenceBreakdown.wagerBonus).toBeCloseTo(0.05);
    expect(game.confidence).toBeCloseTo(0.4);
    expect(game.debugConfidenceForced).toBe(false);

    game.setDebugConfidenceForced(true);
    expect(game.confidence).toBe(1);
    game.setDebugConfidenceForced(false);
    expect(game.confidence).toBeCloseTo(0.4);
  });

  it("always triggers Divine Assist at 100% confidence without a matching road pattern", () => {
    const game = new Game();
    game.table("harbor-1").history = [historyRound("player", 1)];
    game.setDebugConfidenceForced(true);
    game.play("harbor-1", { side: "player", amount: 100 });

    expect(game.divineAssistInfo().target).toBe("player");
    expect(game.shouldTriggerDivineAssist()).toBe(true);
  });

  it("never triggers Divine Assist when confidence is zero", () => {
    const game = new Game();
    const pending = game.play("harbor-1", { side: "banker", amount: 100 });
    pending.result.outcome = "player";

    expect(game.confidence).toBe(0);
    expect(game.divineAssistProbability()).toBe(0);
    expect(game.shouldTriggerDivineAssist()).toBe(false);
  });

  it("does not change Divine Assist effect probabilities when confidence is forced to 100%", () => {
    const game = new Game();
    game.play("harbor-1", { side: "banker", amount: 100 });
    const effectBefore = game.divineAssistInfo();

    game.setDebugConfidenceForced(true);

    expect(game.divineAssistInfo()).toEqual(effectBefore);
    expect(game.pending?.confidence).toBe(1);
  });

  it("does not require a matching skill in addition to the confidence roll", () => {
    const game = new Game();
    game.table("harbor-1").history = [historyRound("banker", 1), historyRound("banker", 2), historyRound("banker", 3)];
    game.equipSkill(null);
    game.setDebugConfidenceForced(true);
    game.play("harbor-1", { side: "player", amount: 100 });

    expect(game.shouldTriggerDivineAssist()).toBe(true);
  });

  it("targets the bet rather than the road prediction", () => {
    const game = new Game();
    game.table("harbor-1").history = [historyRound("banker", 1), historyRound("banker", 2), historyRound("banker", 3)];
    game.play("harbor-1", { side: "player", amount: 100 });

    expect(game.divineAssistInfo().target).toBe("player");
  });

  it("can target a tie bet", () => {
    const game = new Game();
    game.play("harbor-1", { side: "tie", amount: 100 });

    expect(game.divineAssistInfo().target).toBe("tie");
  });

  it("never reports a Divine Assist hit when its resolved probability is zero", () => {
    const game = new Game();
    game.play("harbor-1", { side: "banker", amount: 100 });

    expect(game.applyDivineAssist("player", 0, 0)).toBe(false);
  });

  it("equips only one skill at a time", () => {
    const game = new Game();
    game.equipSkill("long-player");
    expect(game.equippedSkill).toBe("long-player");
    game.equipSkill("ping-pong");
    expect(game.equippedSkill).toBe("ping-pong");
  });

  it("spends cash to upgrade a skill", () => {
    const game = new Game();
    expect(game.skillUpgradeCost("long-banker")).toBe(2400);
    expect(game.upgradeSkill("long-banker")).toBe(true);
    expect(game.skills["long-banker"]).toBe(3);
    expect(game.cash).toBe(5600);
  });
});

describe("round surrender", () => {
  it("abandons an active round without refunding the consumed chips", () => {
    const game = new Game();
    expect(game.reserveChipBet(100)).toBe(true);
    game.play("harbor-1", { side: "banker", amount: 100 });
    expect(game.availableChips).toBe(9);

    game.abandonPendingRound();

    expect(game.pending).toBeNull();
    expect(game.pendingChain).toBeNull();
    expect(game.availableChips).toBe(9);
  });
});
