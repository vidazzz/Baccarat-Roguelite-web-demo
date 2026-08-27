import { describe, expect, it } from "vitest";
import { cardRevealActor, composeChipAmount, DIVINE_MASH_CLICK_RATIO, DIVINE_MASH_INITIAL_RATIO, SQUEEZE_COMPLETE_PROGRESS, divineMashRetreatRatioPerMs, settlementChipPositions, snapSqueezeDirection, tableCardPositions, unrevealedDealtCardIndices } from "./table-scene";

describe("direct card selection", () => {
  it("keeps every unrevealed dealt card selectable regardless of its position", () => {
    expect(unrevealedDealtCardIndices(4, new Set([2]))).toEqual([0, 1, 3]);
    expect(unrevealedDealtCardIndices(6, new Set([0, 3, 5]))).toEqual([1, 2, 4]);
  });

  it("uses self reveal only for the wager-owned side", () => {
    expect(cardRevealActor("player", "player")).toBe("self");
    expect(cardRevealActor("banker", "player")).toBe("dealer");
    expect(cardRevealActor("player", null)).toBe("dealer");
    expect(cardRevealActor("banker", null)).toBe("dealer");
  });
});

describe("squeeze direction snapping", () => {
  it("snaps the player-facing long edge, lower-left corner and short edge", () => {
    expect(snapSqueezeDirection(-1, 0, "player")?.mode).toBe("long-edge");
    expect(snapSqueezeDirection(-1, -1, "player")?.mode).toBe("corner");
    expect(snapSqueezeDirection(0, -1, "player")?.mode).toBe("short-edge");
  });

  it("mirrors the three screen-relative directions for banker cards", () => {
    expect(snapSqueezeDirection(1, 0, "banker")?.mode).toBe("long-edge");
    expect(snapSqueezeDirection(1, 1, "banker")?.mode).toBe("corner");
    expect(snapSqueezeDirection(0, 1, "banker")?.mode).toBe("short-edge");
  });

  it("accepts forgiving edge angles but rejects the opposite side", () => {
    expect(snapSqueezeDirection(-1, 0.4, "player")?.mode).toBe("long-edge");
    expect(snapSqueezeDirection(-0.4, -1, "player")?.mode).toBe("short-edge");
    expect(snapSqueezeDirection(1, 1, "player")).toBeNull();
  });

  it("uses a 70% completion threshold", () => {
    expect(SQUEEZE_COMPLETE_PROGRESS).toBe(0.7);
  });

  it("uses the same normalized mash resistance in both divine stages", () => {
    expect(DIVINE_MASH_INITIAL_RATIO).toBe(0.28);
    expect(DIVINE_MASH_CLICK_RATIO).toBe(0.09);
    expect(0.3 * DIVINE_MASH_CLICK_RATIO / 0.3).toBeCloseTo(DIVINE_MASH_CLICK_RATIO);
    expect(1 * DIVINE_MASH_CLICK_RATIO / 1).toBeCloseTo(DIVINE_MASH_CLICK_RATIO);
    expect(divineMashRetreatRatioPerMs(0.8)).toBeGreaterThan(divineMashRetreatRatioPerMs(0.3));
  });

  it("keeps finger removal perpendicular to reveal progress in every mode", () => {
    const samples = [
      snapSqueezeDirection(-1, 0, "player"),
      snapSqueezeDirection(-1, -1, "player"),
      snapSqueezeDirection(0, -1, "player"),
      snapSqueezeDirection(1, 0, "banker"),
      snapSqueezeDirection(1, 1, "banker"),
      snapSqueezeDirection(0, 1, "banker"),
    ];

    samples.forEach((sample) => {
      expect(sample).not.toBeNull();
      const dot = sample!.normal.x * sample!.fingerDirection.x + sample!.normal.y * sample!.fingerDirection.y;
      expect(dot).toBeCloseTo(0, 10);
    });
  });

  it("places the wager-owned hand near the player and the opponent across the table", () => {
    const player = tableCardPositions({ side: "player", handIndex: 0 }, "player");
    const banker = tableCardPositions({ side: "banker", handIndex: 0 }, "player");
    expect(player.table.x).toBe(banker.table.x);
    expect(player.table.z).toBeGreaterThan(banker.table.z);
    expect(player.resting).toEqual(player.table);
    expect(banker.resting).toEqual(banker.table);
  });

  it("uses the banker hand as the near hand when the player wagers banker", () => {
    const owned = tableCardPositions({ side: "banker", handIndex: 1 }, "banker");
    const dealer = tableCardPositions({ side: "player", handIndex: 1 }, "banker");
    expect(owned.table.z).toBeGreaterThan(dealer.table.z);
    expect(owned.resting).toEqual(owned.table);
    expect(dealer.resting).toEqual(dealer.table);
  });

  it("moves settlement chips between the dealer and each wager position", () => {
    const player = settlementChipPositions("player");
    const banker = settlementChipPositions("banker");
    const tie = settlementChipPositions("tie");
    expect(player.dealer).toEqual(banker.dealer);
    expect(player.wager.x).toBeLessThan(0);
    expect(banker.wager.x).toBe(player.wager.x);
    expect(tie.wager.x).toBe(player.wager.x);
    expect(player.wager.z).toBeGreaterThan(player.dealer.z);
    expect(player.returned.z).toBeGreaterThan(player.wager.z);
  });

  it("decomposes payouts into exact casino chip values and preserves commission remainders", () => {
    const denominations = [100, 200, 500, 1_000, 2_000];
    expect(composeChipAmount(2_800, denominations)).toEqual([
      { value: 2_000, colorIndex: 4 },
      { value: 500, colorIndex: 2 },
      { value: 200, colorIndex: 1 },
      { value: 100, colorIndex: 0 },
    ]);
    expect(composeChipAmount(95, denominations)).toEqual([{ value: 95, colorIndex: 5 }]);
  });
});
