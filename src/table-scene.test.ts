import { describe, expect, it } from "vitest";
import { DIVINE_MASH_CLICK_RATIO, DIVINE_MASH_INITIAL_RATIO, SQUEEZE_COMPLETE_PROGRESS, divineMashRetreatRatioPerMs, snapSqueezeDirection, tableCardPositions } from "./table-scene";

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

  it("places initial cards on mirrored player and banker table positions", () => {
    const player = tableCardPositions({ side: "player", handIndex: 0 }, null);
    const banker = tableCardPositions({ side: "banker", handIndex: 0 }, null);
    expect(player.table.x).toBe(-banker.table.x);
    expect(player.table.z).toBe(banker.table.z);
    expect(player.resting).toEqual(player.table);
    expect(banker.resting).toEqual(banker.table);
  });

  it("pushes only the wager-owned hand toward the player", () => {
    const owned = tableCardPositions({ side: "banker", handIndex: 1 }, "banker");
    const dealer = tableCardPositions({ side: "player", handIndex: 1 }, "banker");
    expect(owned.resting.z).toBeGreaterThan(owned.table.z);
    expect(owned.resting.x).toBeCloseTo(0.75);
    expect(dealer.resting).toEqual(dealer.table);
  });
});
