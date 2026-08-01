import { describe, expect, it, vi } from "vitest";
import { Game, LOBBY_ROUND_MS, RESTAURANT_CYCLE_WORLD_MINUTES, inlineWatchSteps } from "./game";
import type { RoundResult } from "./domain";

const historyRound = (outcome: RoundResult["outcome"], id: number): RoundResult => ({
  id, outcome, bankerCards: [{ rank: 7, suit: "spade" }, { rank: 2, suit: "heart" }],
  playerCards: [{ rank: 4, suit: "club" }, { rank: 3, suit: "diamond" }],
  bankerPoints: 9, playerPoints: 7, natural: true,
});

describe("real-time simulation", () => {
  it("pays restaurant income by elapsed time", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const game = new Game();
    const before = game.cash;
    game.tickRealtime(1_000 + 1_000, null, false);
    expect(game.cash).toBe(before + game.restaurantInfo().income);
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
  it("marks the whole bead plate regardless of whether the next-cell row forms a road", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    table.history = Array.from({ length: 24 }, (_, index) => historyRound(index % 6 === 0 ? "banker" : "player", index));

    expect(game.markCurrentBeadRoad(table.id).some((road) => road.id === "diamond-banker")).toBe(true);
    expect(game.roadMark(table.id, "bead")).not.toBeNull();

    table.history = [historyRound("banker", 1), historyRound("player", 2), historyRound("banker", 3)];
    expect(game.markCurrentBeadRoad(table.id)).toEqual([]);
    expect(game.roadMark(table.id, "bead")).not.toBeNull();
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

  it("includes a marked lower-road pattern in confidence settlement", () => {
    const game = new Game();
    const table = game.table("harbor-1");
    const sequence = "BBBBPPPPPBBBBPBBPPPBBPBBBPBPPBBPPBBBBPPBBBBBPBBPBPBPBPBP";
    table.history = sequence.split("").map((value, index) => historyRound(value === "B" ? "banker" : "player", index));
    game.markRoad(table.id, "small", 0, 0);

    const pending = game.play(table.id, { side: "banker", amount: 100 });

    expect(pending.confidenceBreakdown.markedPatterns.some((pattern) => pattern.source === "small")).toBe(true);
    expect(pending.confidenceBreakdown.markedPatternBonus).toBeGreaterThan(0);
  });

  it("adds confidence only when a marked road predicts the wagered side", () => {
    const game = new Game();
    game.table("harbor-1").history = Array.from({ length: 5 }, (_, index) => historyRound("banker", index));
    game.markRoad("harbor-1", "big", 0, 0);
    const pending = game.play("harbor-1", { side: "banker", amount: 100 });

    expect(pending.confidence).toBeCloseTo(0.75);
    expect(pending.confidenceBreakdown.markedPatternBonus).toBeCloseTo(0.05);
    expect(pending.confidenceBreakdown.lengthBonus).toBeCloseTo(0);
    expect(pending.confidencePrediction).toBe("banker");
    expect(game.divineAssistInfo().target).toBe("banker");
  });

  it("penalizes wagering against an active road even when it is not marked", () => {
    const game = new Game();
    game.table("harbor-1").history = Array.from({ length: 5 }, (_, index) => historyRound("banker", index));
    const pending = game.play("harbor-1", { side: "player", amount: 100 });

    expect(pending.confidence).toBeCloseTo(0.65);
    expect(pending.confidenceBreakdown.opposingPatternPenalty).toBeCloseTo(-0.05);
    expect(pending.confidencePrediction).toBeNull();
  });

  it("adds five points for every full ten percent of liquid wealth wagered", () => {
    const game = new Game();
    game.table("harbor-1").history = [];
    const pending = game.play("harbor-1", { side: "banker", amount: 800 });

    expect(pending.confidenceBreakdown.wagerBonus).toBeCloseTo(0.05);
    expect(pending.confidence).toBeCloseTo(0.75);
  });

  it("adds two points for each marked road length after length one", () => {
    const game = new Game();
    game.table("harbor-1").history = Array.from({ length: 6 }, (_, index) => historyRound("banker", index));
    game.markRoad("harbor-1", "big", 0, 0);
    const pending = game.play("harbor-1", { side: "banker", amount: 100 });

    expect(pending.confidenceBreakdown.markedPatterns.find((pattern) => pattern.id === "long-banker")?.length).toBe(2);
    expect(pending.confidenceBreakdown.lengthBonus).toBeCloseTo(0.02);
    expect(pending.confidence).toBeCloseTo(0.77);
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
    expect(next.confidence).toBeCloseTo(0.76);
  });

  it("forces confidence to 100% and restores the previous value", () => {
    const game = new Game();
    game.setDebugConfidenceForced(true);
    expect(game.confidence).toBe(1);
    expect(game.debugConfidenceForced).toBe(true);
    game.setDebugConfidenceForced(false);
    expect(game.confidence).toBe(0.7);
  });

  it("always triggers Divine Assist at 100% confidence without a matching road pattern", () => {
    const game = new Game();
    game.table("harbor-1").history = [historyRound("player", 1)];
    game.setDebugConfidenceForced(true);
    game.play("harbor-1", { side: "player", amount: 100 });

    expect(game.divineAssistInfo().target).toBe("player");
    expect(game.shouldTriggerDivineAssist()).toBe(true);
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
