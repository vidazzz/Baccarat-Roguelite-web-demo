import { describe, expect, it } from "vitest";
import { bankerShouldDraw, confidenceRoadStartColumn, createRng, dealRound, divineCallForRound, forecastBaccaratReveal, handPoints, makeBeadPlate, makeBigRoad, makeDerivedRoads, pipLayout, playerShouldDraw, predictRoadColors, recognizeConfidenceRoads, recognizeDerivedConfidenceRoads, recognizePattern, retargetRoundCard, type RoundResult } from "./domain";

const round = (outcome: RoundResult["outcome"], id: number): RoundResult => ({ id, outcome, bankerCards: [], playerCards: [], bankerPoints: 0, playerPoints: 0, natural: false });

describe("baccarat domain", () => {
  it("scores face cards as zero", () => {
    expect(handPoints([{ rank: 13, suit: "spade" }, { rank: 7, suit: "heart" }, { rank: 5, suit: "club" }])).toBe(2);
  });

  it("always deals legal hand sizes and points", () => {
    const rng = createRng(42);
    for (let id = 0; id < 1000; id += 1) {
      const result = dealRound(rng, id);
      expect(result.bankerCards.length).toBeGreaterThanOrEqual(2);
      expect(result.bankerCards.length).toBeLessThanOrEqual(3);
      expect(result.playerCards.length).toBeGreaterThanOrEqual(2);
      expect(result.playerCards.length).toBeLessThanOrEqual(3);
      expect(result.bankerPoints).toBe(handPoints(result.bankerCards));
      expect(result.playerPoints).toBe(handPoints(result.playerCards));
    }
  });

  it("uses the real player third-card rule", () => {
    for (let points = 0; points <= 5; points += 1) expect(playerShouldDraw(points)).toBe(true);
    for (let points = 6; points <= 9; points += 1) expect(playerShouldDraw(points)).toBe(false);
  });

  it("uses the real banker third-card table", () => {
    expect(bankerShouldDraw(5, null)).toBe(true);
    expect(bankerShouldDraw(6, null)).toBe(false);
    expect(bankerShouldDraw(3, 7)).toBe(true);
    expect(bankerShouldDraw(3, 8)).toBe(false);
    expect(bankerShouldDraw(4, 2)).toBe(true);
    expect(bankerShouldDraw(4, 8)).toBe(false);
    expect(bankerShouldDraw(5, 4)).toBe(true);
    expect(bankerShouldDraw(5, 3)).toBe(false);
    expect(bankerShouldDraw(6, 6)).toBe(true);
    expect(bankerShouldDraw(6, 5)).toBe(false);
    expect(bankerShouldDraw(7, 7)).toBe(false);
  });

  it("forecasts an initial natural as an immediate outcome", () => {
    expect(forecastBaccaratReveal([4, 4], [2, null], "banker", 1, 3)).toEqual({ kind: "outcome", outcome: "player" });
  });

  it("forecasts player and banker draws from the currently revealed values", () => {
    expect(forecastBaccaratReveal([2, 3], [2, null], "banker", 1, 4)).toEqual({ kind: "draw", side: "player" });
    expect(forecastBaccaratReveal([4, 2], [2, null], "banker", 1, 3)).toEqual({ kind: "draw", side: "banker" });
    expect(forecastBaccaratReveal([2, 3, null], [1, 2], "player", 2, 1)).toEqual({ kind: "draw", side: "banker" });
  });

  it("forecasts the final outcome after a banker third card", () => {
    expect(forecastBaccaratReveal([2, 3, 1], [1, 2, null], "banker", 2, 4)).toEqual({ kind: "outcome", outcome: "banker" });
    expect(forecastBaccaratReveal([2, 3, 1], [1, 2, null], "banker", 2, 3)).toEqual({ kind: "outcome", outcome: "tie" });
  });

  it("retargets a hidden card without breaking the baccarat draw structure", () => {
    const result = dealRound(createRng(91), 1);
    const side = result.bankerCards.length === 3 ? "banker" : "player";
    const handIndex = (side === "banker" ? result.bankerCards : result.playerCards).length - 1;
    retargetRoundCard(result, side, handIndex, "banker", true, 0.4);
    const initialPlayer = handPoints(result.playerCards.slice(0, 2));
    const initialBanker = handPoints(result.bankerCards.slice(0, 2));
    const natural = initialPlayer >= 8 || initialBanker >= 8;
    expect(result.playerCards.length).toBe(natural || !playerShouldDraw(initialPlayer) ? 2 : 3);
  });

  it("calls for more points when a high player third card is needed", () => {
    const result: RoundResult = {
      id: 1,
      playerCards: [{ rank: 10, suit: "spade" }, { rank: 13, suit: "heart" }, { rank: 1, suit: "club" }],
      bankerCards: [{ rank: 7, suit: "diamond" }, { rank: 10, suit: "club" }],
      playerPoints: 1,
      bankerPoints: 7,
      outcome: "banker",
      natural: false,
    };
    expect(divineCallForRound(result, "player", 2, "player").word).toBe("吸！");
  });

  it("calls for fewer points when suppressing the banker's third card", () => {
    const result: RoundResult = {
      id: 2,
      playerCards: [{ rank: 4, suit: "spade" }, { rank: 2, suit: "heart" }],
      bankerCards: [{ rank: 10, suit: "diamond" }, { rank: 13, suit: "club" }, { rank: 7, suit: "heart" }],
      playerPoints: 6,
      bankerPoints: 7,
      outcome: "banker",
      natural: false,
    };
    expect(divineCallForRound(result, "banker", 2, "player").word).toBe("吹！");
  });

  it("recognizes long banker and alternating roads", () => {
    const skills = { "long-banker": 2, "long-player": 1, "ping-pong": 1, none: 0 };
    expect(recognizePattern([round("banker", 1), round("banker", 2), round("banker", 3)], skills).id).toBe("long-banker");
    expect(recognizePattern([round("banker", 1), round("player", 2), round("banker", 3), round("player", 4)], skills).id).toBe("ping-pong");
  });

  it("places streaks down columns and switches across columns", () => {
    const road = makeBigRoad([round("banker", 1), round("banker", 2), round("player", 3)]);
    expect(road.map(({ row, column }) => [row, column])).toEqual([[0, 0], [1, 0], [0, 1]]);
  });

  it("turns long big-road streaks to the right after row six", () => {
    const history = Array.from({ length: 8 }, (_, index) => round("banker", index));
    const road = makeBigRoad(history);
    expect(road.map(({ row, column }) => [row, column])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [5, 1], [5, 2]]);
  });

  it("keeps ties on the previous big-road mark and counts repeated ties", () => {
    const road = makeBigRoad([
      round("banker", 1),
      round("tie", 2),
      round("tie", 3),
      round("player", 4),
    ]);
    expect(road).toHaveLength(2);
    expect(road[0]).toMatchObject({ outcome: "banker", ties: 2 });
    expect(road[1]).toMatchObject({ outcome: "player", ties: 0 });
  });

  it("fills bead plate columns from top to bottom", () => {
    const plate = makeBeadPlate(Array.from({ length: 8 }, (_, index) => round(index % 2 ? "player" : "banker", index)));
    expect(plate[5]).toMatchObject({ row: 5, column: 0 });
    expect(plate[6]).toMatchObject({ row: 0, column: 1 });
  });

  it("keeps bead placement moving after old history is trimmed", () => {
    const plate = makeBeadPlate(Array.from({ length: 12 }, (_, index) => round("banker", index)), 49);
    expect(plate[0]).toMatchObject({ row: 1, column: 8 });
    expect(plate.at(-1)).toMatchObject({ row: 0, column: 10 });
  });

  it("uses the correct number of pips for ace through ten", () => {
    for (let rank = 1; rank <= 10; rank += 1) expect(pipLayout(rank)).toHaveLength(rank);
    expect(pipLayout(11)).toHaveLength(0);
  });

  it("builds all three derived roads from the big road", () => {
    const history = ["banker", "banker", "player", "player", "banker", "player", "banker", "banker", "player", "player"]
      .map((outcome, index) => round(outcome as RoundResult["outcome"], index));
    const roads = makeDerivedRoads(history);
    expect(roads.bigEye.length).toBeGreaterThan(0);
    expect(roads.small.length).toBeGreaterThan(0);
    expect(roads.cockroach.length).toBeGreaterThan(0);
  });

  it("predicts derived marks for banker and player questions", () => {
    const history = ["banker", "banker", "player", "player", "banker", "player", "banker"]
      .map((outcome, index) => round(outcome as RoundResult["outcome"], index));
    expect(Object.keys(predictRoadColors(history, "banker")).length).toBeGreaterThan(0);
    expect(Object.keys(predictRoadColors(history, "player")).length).toBeGreaterThan(0);
  });

  it("keeps the source round index on every derived-road mark", () => {
    const history = "BPPBBPBPBBBPPBBPBPPBBBPBBPPP".split("").map((value, index) => round(value === "B" ? "banker" : "player", index));
    const roads = makeDerivedRoads(history);
    for (const cells of [roads.bigEye, roads.small, roads.cockroach]) {
      expect(cells.every((cell, index) => index === 0 || cell.roundIndex > cells[index - 1]!.roundIndex)).toBe(true);
    }
  });

  it("recognizes lower-road patterns and resolves their color through ask-road", () => {
    const fixtures = [
      ["big-eye", "BPPBBPBPBBBPPBBPBPPBBBPBBPPPBBBPBBPPBBBBBPPBPPPBPBBBBBBP", "player"],
      ["small", "BBBBPPPPPBBBBPBBPPPBBPBBBPBPPBBPPBBBBPPBBBBBPBBPBPBPBPBP", "banker"],
      ["cockroach", "BPBBBPBBPBBPBPBPBBPPPPBBPPBPPPBPBBPPBPBPPBPPPPBPPPPBPBPB", "banker"],
    ] as const;
    for (const [roadBook, sequence, prediction] of fixtures) {
      const history = sequence.split("").map((value, index) => round(value === "B" ? "banker" : "player", index));
      const patterns = recognizeDerivedConfidenceRoads(history, roadBook);
      expect(patterns).toHaveLength(1);
      expect(patterns.every((pattern) => pattern.prediction === prediction && pattern.source === roadBook)).toBe(true);
    }
  });

  it("selects at most one effective pattern for each road book", () => {
    const bigHistory = Array.from({ length: 6 }, (_, index) => round("banker", index));
    const lowerHistory = "BBBBPPPPPBBBBPBBPPPBBPBBBPBPPBBPPBBBBPPBBBBBPBBPBPBPBPBP".split("").map((value, index) => round(value === "B" ? "banker" : "player", index));
    expect(recognizeConfidenceRoads(bigHistory, "big")).toHaveLength(1);
    expect(recognizeDerivedConfidenceRoads(lowerHistory, "small")).toHaveLength(1);
  });

  it("recognizes long roads and applies the configured length formula", () => {
    const roads = recognizeConfidenceRoads(Array.from({ length: 6 }, (_, index) => round("banker", index)));
    expect(roads.find((road) => road.id === "long-banker")).toMatchObject({ prediction: "banker", length: 2 });
  });

  it("recognizes single jumps from six rounds and grows every two rounds", () => {
    const history = Array.from({ length: 8 }, (_, index) => round(index % 2 ? "player" : "banker", index));
    expect(recognizeConfidenceRoads(history).find((road) => road.id === "single-jump")).toMatchObject({ prediction: "banker", length: 2 });
  });

  it("keeps the full active-road length when locating its exact mark column", () => {
    const history = ["banker", "banker", "player", "banker", "player", "banker", "player", "banker", "player", "banker"]
      .map((outcome, index) => round(outcome as RoundResult["outcome"], index));
    expect(recognizeConfidenceRoads(history, "big")[0]).toMatchObject({ id: "single-jump", length: 2 });
    expect(confidenceRoadStartColumn(history, "big")).toBe(1);
  });

  it("recognizes bead diamonds from four matching results left of the next cell", () => {
    const history = Array.from({ length: 24 }, (_, index) => round(index % 6 === 0 ? "banker" : "player", index));
    expect(recognizeConfidenceRoads(history, "bead").find((road) => road.id === "diamond-banker")).toMatchObject({ prediction: "banker", length: 1 });
  });

  it("does not use the latest round row when checking the next bead cell", () => {
    const history = Array.from({ length: 24 }, (_, index) => round(index % 6 === 5 ? "banker" : "player", index));
    expect(recognizeConfidenceRoads(history, "bead").some((road) => road.id === "diamond-banker")).toBe(false);
  });

  it("treats a tie cell as a break in a bead-row pattern", () => {
    const history = Array.from({ length: 30 }, (_, index) => round(index % 6 === 0 ? "banker" : "player", index));
    history[12] = round("tie", 12);
    expect(recognizeConfidenceRoads(history, "bead").some((road) => road.id === "diamond-banker")).toBe(false);
  });

  it("recognizes 1324 and two-room-one-hall big-road sequences", () => {
    const makeRuns = (runs: Array<[RoundResult["outcome"], number]>) => runs.flatMap(([outcome, count]) => Array.from({ length: count }, (_, index) => round(outcome, index)));
    const oneThreeTwoFour = recognizeConfidenceRoads(makeRuns([["banker", 1], ["player", 3], ["banker", 2], ["player", 4]]), "big");
    const twoOneTwoOne = recognizeConfidenceRoads(makeRuns([["banker", 2], ["player", 1], ["banker", 2], ["player", 1]]), "big");
    expect(oneThreeTwoFour.find((road) => road.id === "big-1324")?.prediction).toBe("banker");
    expect(twoOneTwoOne.find((road) => road.id === "big-2121")?.prediction).toBe("banker");
  });

  it("recognizes a big-road sequence from the latest matching suffix", () => {
    const makeRuns = (runs: Array<[RoundResult["outcome"], number]>) => runs.flatMap(([outcome, count]) => Array.from({ length: count }, (_, index) => round(outcome, index)));
    const roads = recognizeConfidenceRoads(makeRuns([["player", 5], ["banker", 1], ["player", 3], ["banker", 2], ["player", 4]]), "big");
    expect(roads.find((road) => road.id === "big-1324")?.prediction).toBe("banker");
  });
});
