import "./style.css";
import * as THREE from "three";
import casinoAsset from "./casino.jpg";
import homeAsset from "./home.jpg";
import homeNightAsset from "./home_night.jpg";
import mapAsset from "./map.jpg";
import mapDaylightAsset from "./map_daylight.jpg";
import restaurantAsset from "./restaurant.jpg";
import { cardFaceAsset } from "./card-assets";
import { cardLabel, cardValue, confidenceRoadStartColumn, makeBeadPlate, makeBigRoad, makeDerivedRoads, type Card, type DerivedRoadColor, type Outcome, type RoadBook, type RoundResult, type Side } from "./domain";
import { casinos, CHEAT_SKILL_COST, cheatSkillDefinitions, DIVINE_CARD_TYPE_OPTIONS, Game, LOBBY_ROUND_MS, MAX_SKILL_LEVEL, inlineWatchSteps, skillDefinitions, type Casino, type CheatSkillId, type CoveredReorderCard, type DebugGameplayConfig, type DivineCardType, type GameTable, type PendingChain, type PendingRound, type RoadCreationResolution, type SettlementResult, type SkillId } from "./game";
import { composeChipAmount, DIVINE_MASH_CLICK_RATIO, DIVINE_MASH_INITIAL_RATIO, divineMashRetreatRatioPerMs, TableScene, unrevealedDealtCardIndices, type TableChip } from "./table-scene";

type View = "map" | "restaurant" | "skills" | "casino-select" | "lobby" | "table" | "dealing" | "game-over";
type Activity = "restaurant" | "casino" | "home";
type DealStage = "animating" | "drawing-card" | "awaiting-card" | "awaiting-cheat" | "dealer-revealing" | "settling-chips" | "settled";

const game = new Game();
const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "map";
let activeActivity: Activity = "restaurant";
let casinoId = casinos[0]!.id;
let tableId = "harbor-1";
let stagedBetSide: Outcome | null = null;
type TableEntryStep = "choice" | "chips" | "targets";
let tableEntryStep: TableEntryStep = "choice";
let roundWagerChips: TableChip[] = [];
let selectedChipCount = 1;
let chainRounds = 1;
let chainTargets: Outcome[] = ["banker"];
let chainTargetSelected: boolean[] = [false];
let tableScene: TableScene | null = null;
let chainScenes = new Map<number, TableScene>();
interface ChainLegUiState { dealtCardCount: number; revealedCardIndices: Set<number>; peekedCardIndices: Set<number>; dealStage: DealStage; divineCheckedStages: Set<number>; divineRevealFeedback: Map<number, { hit: boolean; target: Outcome; probability: number }>; divineActivations: number; }
let chainLegUiStates = new Map<number, ChainLegUiState>();
let activeChainLegIndex: number | null = null;
let armedCheatSkill: CheatSkillId | null = null;
let setEdgeTarget: CheatTarget | null = null;
let cardReorderSession: { cancel: () => void; confirm: () => void } | null = null;
let lastSettlement: SettlementResult | null = null;
let lastRound: PendingRound | null = null;
interface ChainSettlementLegView {
  index: number;
  target: Outcome;
  result: RoundResult;
  settled: boolean;
}
interface ChainSettlementView {
  stake: number;
  plannedRounds: number;
  effectiveRounds: number;
  ties: number;
  won: boolean;
  payout: number;
  legs: ChainSettlementLegView[];
}
let lastChainSettlement: ChainSettlementView | null = null;
let viewTimers: number[] = [];
let dealStage: DealStage = "animating";
let revealedCardIndices = new Set<number>();
let peekedCardIndices = new Set<number>();
let divineCheckedStages = new Set<number>();
let divineRevealFeedback = new Map<number, { hit: boolean; target: Outcome; probability: number }>();
let divineActivationsThisRound = 0;
let divineSpecialPending = false;
let dealtCardCount = 4;
let debugMenuOpen = false;
let tablePlayerInteractionActive = false;
let inlineWatchActive = false;
let inlineWatchStep = 0;
let inlineWatchSettled = false;
let roadMarkFeedback: { message: string; debug: string } | null = null;
void roadMarkFeedback;
let roadCreationFailure: RoadCreationResolution | null = null;
let restaurantClosingPromptOpen = false;
let sleepTransitionActive = false;
let wakePromptOpen = false;
let sleepCollapsePromptOpen = false;
let sleepDeprivationNoticeOpen = false;
let wakeAfterForcedRest = false;
let homeSkillManagementOpen = false;
let restChoiceOpen = false;
let confidenceDetailsOpen = false;

const money = (value: number) => `¥${Math.floor(value).toLocaleString("zh-CN")}`;
const chips = (value: number) => `${Math.max(0, Math.floor(value / 100))} 枚筹码`;
const outcomeName = (outcome: Outcome) => ({ banker: "庄", player: "闲", tie: "和" })[outcome];
const chipDenominations = (casino: Casino) => [1, 2, 5, 10, 20].map((multiple) => casino.minBet * multiple).filter((value) => value <= casino.maxBet);
const roadBooks: RoadBook[] = ["bead", "big"];
const markedRoadBookCount = (currentTableId: string) => roadBooks.filter((roadBook) => game.roadMark(currentTableId, roadBook)).length;

interface RoadPreviewCell {
  side: Side;
  row: number;
  column: number;
  color: DerivedRoadColor;
  creationIndex: number;
}

const appendHypotheticalRound = (table: GameTable, history: RoundResult[], side: Side): RoundResult[] => [...history, {
  id: (history.at(-1)?.id ?? table.round) + 1,
  outcome: side,
  bankerCards: [],
  playerCards: [],
  bankerPoints: 0,
  playerPoints: 0,
  natural: false,
}];

function roadPreviewCell(table: GameTable, roadBook: RoadBook, history: RoundResult[], side: Side, creationIndex: number): RoadPreviewCell | null {
  const projected = appendHypotheticalRound(table, history, side);
  if (roadBook === "bead") {
    const cell = makeBeadPlate(projected, table.historyOffset).at(-1)!;
    return { side, row: cell.row, column: cell.column, color: side === "banker" ? "red" : "blue", creationIndex };
  }
  if (roadBook === "big") {
    const cell = makeBigRoad(projected).at(-1)!;
    return { side, row: cell.row, column: cell.column, color: side === "banker" ? "red" : "blue", creationIndex };
  }
  const current = makeDerivedRoads(history);
  const next = makeDerivedRoads(projected);
  const key = roadBook === "big-eye" ? "bigEye" : roadBook;
  if (next[key].length <= current[key].length) return null;
  const cell = next[key].at(-1)!;
  return { side, row: cell.row, column: cell.column, color: cell.color, creationIndex };
}

function roadPreviewCells(table: GameTable, roadBook: RoadBook): RoadPreviewCell[] {
  const sequence = game.roadCreationSequence(table.id);
  const history = sequence.reduce((projected, side) => appendHypotheticalRound(table, projected, side), table.history);
  return (["banker", "player"] as const)
    .map((side) => roadPreviewCell(table, roadBook, history, side, sequence.length))
    .filter((cell): cell is RoadPreviewCell => cell !== null);
}

function roadCreatedCells(table: GameTable, roadBook: RoadBook): RoadPreviewCell[] {
  let history = table.history;
  const cells: RoadPreviewCell[] = [];
  for (const [creationIndex, side] of game.roadCreationSequence(table.id).entries()) {
    const cell = roadPreviewCell(table, roadBook, history, side, creationIndex);
    if (cell) cells.push(cell);
    history = appendHypotheticalRound(table, history, side);
  }
  return cells;
}

function roadCreationTargets(table: GameTable, roadBook: RoadBook, visibleFrom: number): string {
  const targets = new Map<string, RoadPreviewCell>();
  for (const cell of roadCreatedCells(table, roadBook)) targets.set(`${cell.creationIndex}:${cell.row}:${cell.column}`, cell);
  for (const cell of roadPreviewCells(table, roadBook)) {
    const key = `${cell.creationIndex}:${cell.row}:${cell.column}`;
    if (!targets.has(key)) targets.set(key, cell);
  }
  const creationCount = game.roadCreationSequence(table.id).length;
  return [...targets.values()].filter((cell) => cell.column >= visibleFrom).map((cell) => {
    const existing = cell.creationIndex < creationCount;
    const existingAction = roadBook === "bead" ? "修改" : "撤销";
    return `<button type="button" class="road-create-cell ${existing ? "created-road-edit" : ""}" data-road-create-book="${roadBook}" data-road-side="${cell.side}" data-road-color="${cell.color}" data-creation-index="${cell.creationIndex}" data-row="${cell.row}" data-column="${cell.column}" style="--row:${cell.row};--col:${cell.column - visibleFrom}" aria-label="${existing ? `${existingAction}第 ${cell.creationIndex + 1} 局创造路数` : "继续创造下一局路数"}"></button>`;
  }).join("");
}

function resetBetDraft(refund = true, clearRoad = true): void {
  if (refund) game.cancelReservedBet();
  stagedBetSide = null;
  chainRounds = 1;
  chainTargets = ["banker"];
  chainTargetSelected = [false];
  armedCheatSkill = null;
  setEdgeTarget = null;
  if (clearRoad) game.setRoadCreationSequence(tableId, []);
}

function saveActiveChainLegUi(): void {
  if (activeChainLegIndex === null) return;
  chainLegUiStates.set(activeChainLegIndex, {
    dealtCardCount,
    revealedCardIndices: new Set(revealedCardIndices),
    peekedCardIndices: new Set(peekedCardIndices),
    dealStage,
    divineCheckedStages: new Set(divineCheckedStages),
    divineRevealFeedback: new Map(divineRevealFeedback),
    divineActivations: divineActivationsThisRound,
  });
}

function loadChainLegUi(index: number): void {
  const state = chainLegUiStates.get(index);
  dealtCardCount = state?.dealtCardCount ?? 4;
  revealedCardIndices = new Set(state?.revealedCardIndices ?? []);
  peekedCardIndices = new Set(state?.peekedCardIndices ?? []);
  dealStage = state?.dealStage ?? "animating";
  divineCheckedStages.clear();
  divineRevealFeedback.clear();
  divineCheckedStages = new Set(state?.divineCheckedStages ?? []);
  divineRevealFeedback = new Map(state?.divineRevealFeedback ?? []);
  divineActivationsThisRound = state?.divineActivations ?? 0;
  tablePlayerInteractionActive = false;
}

function chainLegSceneState(index: number): { count: number; revealed: Set<number>; stage: DealStage } {
  const isCurrent = Boolean(game.pendingChain && game.pendingChain.currentLegIndex === index && game.pending);
  const state = chainLegUiStates.get(index);
  return {
    count: isCurrent ? dealtCardCount : state?.dealtCardCount ?? 4,
    revealed: isCurrent ? revealedCardIndices : new Set(state?.revealedCardIndices ?? []),
    stage: isCurrent ? dealStage : state?.dealStage ?? "animating",
  };
}

function bindChainSceneSelection(index: number): void {
  const scene = chainScenes.get(index);
  const leg = game.pendingChain?.legs[index];
  if (!scene || !leg || leg.settled) {
    scene?.setCardSelection([], () => undefined);
    return;
  }
  const state = chainLegSceneState(index);
  const selectable = state.stage === "awaiting-card"
    ? unrevealedDealtCardIndices(state.count, state.revealed)
    : [];
  scene.setCardSelection(selectable, (cardIndex) => selectCardForRevealForLeg(index, cardIndex));
}

function refreshChainSceneSelections(): void {
  if (!game.pendingChain) return;
  game.pendingChain.legs.forEach((_, index) => bindChainSceneSelection(index));
}

function selectChainLeg(index: number, cardIndex: number | null = null): void {
  if (!game.pendingChain) return;
  const leg = game.pendingChain.legs[index];
  if (!leg || leg.settled) return;
  saveActiveChainLegUi();
  if (!game.selectChainLeg(index)) return;
  activeChainLegIndex = index;
  lastRound = game.pending;
  lastSettlement = null;
  loadChainLegUi(index);
  tableScene = chainScenes.get(index) ?? tableScene;
  // currentLegIndex 只用于内部结算上下文，不再把其它牌局标记为不可操作。
  refreshChainSceneSelections();
  if (cardIndex !== null) window.setTimeout(() => selectCardForRevealForLeg(index, cardIndex), 0);
  updateChainLegReports();
}

function selectCardForRevealForLeg(legIndex: number, cardIndex: number): void {
  const leg = game.pendingChain?.legs[legIndex];
  if (!leg) return;
  if (armedCheatSkill) {
    const target = cheatTargetForCard(armedCheatSkill, legIndex, cardIndex);
    if (target) {
      const skill = armedCheatSkill;
      if (skill === "set-edge") {
        selectSetEdgeTarget(target);
        return;
      }
      if (skill !== "swap-covered" && skill !== "swap-face-up") {
        armedCheatSkill = null;
        updateCheatArmedState();
      }
      applyCheatSkillToTarget(skill, target);
    } else {
      game.notice = "这张牌不符合当前千术的使用条件";
      updateCheatArmedState();
    }
    return;
  }
  if (leg.settled) return;
  if (!game.pendingChain) {
    selectCardForReveal(cardIndex);
    return;
  }
  const state = chainLegSceneState(legIndex);
  if (state.stage !== "awaiting-card") return;
  if (game.pendingChain.currentLegIndex !== legIndex) selectChainLeg(legIndex);
  const scene = chainScenes.get(legIndex);
  if (scene) selectCardForReveal(cardIndex, scene, legIndex);
}

function chainLegReportText(index: number): string {
  const chain = game.pendingChain;
  if (!chain) return "";
  const leg = chain.legs[index];
  if (!leg) return "";
  if (leg.settled) return leg.result.outcome === "tie" ? "已结算 · 和局" : `已结算 · ${outcomeName(leg.result.outcome)}家胜`;
  if (game.pending && chain.currentLegIndex === index) {
    if (dealStage === "animating") return "发牌中 · 请稍候";
    if (dealStage === "drawing-card") return "补牌中 · 请稍候";
    if (dealStage === "awaiting-card") return "等待开牌";
    if (dealStage === "awaiting-cheat") return "本局未中 · 可选择出千或放弃";
    if (dealStage === "dealer-revealing") return "荷官开牌中";
    if (dealStage === "settling-chips") return "筹码结算中";
  }
  const state = chainLegUiStates.get(index);
  if (state?.dealStage === "awaiting-card") return "等待操作";
  if (state?.dealStage === "awaiting-cheat") return "本局未中 · 可选择出千或放弃";
  return "等待进入本局";
}

function awaitingCheatLegIndices(): number[] {
  if (!game.pendingChain) return dealStage === "awaiting-cheat" ? [0] : [];
  return game.pendingChain.legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg, index }) => !leg.settled && (
      (game.pendingChain?.currentLegIndex === index && dealStage === "awaiting-cheat")
      || chainLegUiStates.get(index)?.dealStage === "awaiting-cheat"
    ))
    .map(({ index }) => index);
}

function chainLegReportMarkup(index: number): string {
  const chain = game.pendingChain;
  const leg = chain?.legs[index];
  const pending = pendingChainLeg(index);
  if (!chain || !leg || !pending) return "";
  const active = chain.currentLegIndex === index && game.pending;
  const state = chainLegUiStates.get(index);
  const revealed = active ? revealedCardIndices : state?.revealedCardIndices ?? new Set<number>();
  const sequence = dealSequence(pending);
  const pointsFor = (side: Side) => sequence.filter((entry, cardIndex) => entry.side === side && revealed.has(cardIndex)).reduce((sum, entry) => sum + cardValue(entry.card), 0) % 10;
  const status = chainLegReportText(index);
  const bankerPoints = revealed.size ? pointsFor("banker") : null;
  const playerPoints = revealed.size ? pointsFor("player") : null;
  const comparable = bankerPoints !== null && playerPoints !== null;
  const leader = comparable && bankerPoints !== playerPoints ? bankerPoints! > playerPoints! ? "banker" : "player" : null;
  const summary = leg.settled
    ? leg.result.outcome === "tie" ? "本局和局" : `${outcomeName(leg.result.outcome)}家胜`
    : comparable ? leader ? `${outcomeName(leader)}家领先 ${Math.abs(bankerPoints! - playerPoints!)} 点` : "庄闲当前同点" : status;
  const scoreCell = (side: Side, points: number | null) => `<div class="chain-report-score-cell ${side} ${leg.target === side ? "owned" : ""}"><span>${outcomeName(side)}家${leg.target === side ? " · 你押" : ""}</span><strong>${points ?? "—"}<small>点</small></strong><em>${points === null ? "待开" : !comparable ? "已开" : leader === side ? "领先" : leader ? "落后" : "同点"}</em></div>`;
  return `<div class="chain-report-lead"><small>${status}</small></div><div class="chain-report-score-panel"><div class="chain-report-summary"><span>实时牌势</span><strong>${summary}</strong></div>${scoreCell("banker", bankerPoints)}${scoreCell("player", playerPoints)}</div>`;
}

function chainLegResultLabel(leg: { settled: boolean; target: Outcome; result: RoundResult }): string {
  if (!leg.settled) return `押${outcomeName(leg.target)}`;
  if (leg.result.outcome === "tie") return "和局 · 退注";
  return leg.result.outcome === leg.target ? `押中${outcomeName(leg.target)}` : "本局失败";
}

function updateChainLegReports(): void {
  app.querySelectorAll<HTMLElement>("[data-chain-leg-report]").forEach((element) => {
    element.innerHTML = chainLegReportMarkup(Number(element.dataset.chainLegReport));
  });
}

interface CheatTarget {
  legIndex: number;
  cardIndex: number;
  side: Side;
  handIndex: number;
  label: string;
}

interface ReorderSceneCard extends CoveredReorderCard {
  cardIndex: number;
  scene: TableScene;
}

function cheatTargetForCard(skillId: CheatSkillId, legIndex: number, cardIndex: number): CheatTarget | null {
  const chain = game.pendingChain;
  const pending = chain ? pendingChainLeg(legIndex) : game.pending;
  if (!pending) return null;
  const active = !chain || Boolean(game.pending && chain.currentLegIndex === legIndex);
  const count = active ? dealtCardCount : chainLegUiStates.get(legIndex)?.dealtCardCount ?? 4;
  const revealed = active ? revealedCardIndices : chainLegUiStates.get(legIndex)?.revealedCardIndices ?? new Set<number>();
  const peeked = active ? peekedCardIndices : chainLegUiStates.get(legIndex)?.peekedCardIndices ?? new Set<number>();
  const entry = dealSequence(pending)[cardIndex];
  if (!entry || cardIndex >= count) return null;
  const isCovered = !revealed.has(cardIndex);
  const coveredSkill = ["peek-covered", "swap-covered", "set-edge"].includes(skillId);
  if (coveredSkill !== isCovered) return null;
  if (skillId === "peek-covered" && peeked.has(cardIndex)) return null;
  if (skillId === "swap-covered" && playerOwnedSide(pending) !== entry.side) return null;
  return { legIndex, cardIndex, side: entry.side, handIndex: entry.handIndex, label: `第 ${legIndex + 1} 局 · ${entry.side === "player" ? "PLAYER" : "BANKER"} · 第 ${entry.handIndex + 1} 张 · ${isCovered ? "盖牌" : "明牌"}` };
}

function cheatTargetsOnTable(skillId: CheatSkillId): CheatTarget[] {
  const targets: CheatTarget[] = [];
  const legs = game.pendingChain ? game.pendingChain.legs.map((_, index) => index) : [0];
  legs.forEach((legIndex) => {
    const pending = game.pendingChain ? pendingChainLeg(legIndex) : game.pending;
    if (!pending) return;
    const active = !game.pendingChain || Boolean(game.pending && game.pendingChain.currentLegIndex === legIndex);
    const count = active ? dealtCardCount : chainLegUiStates.get(legIndex)?.dealtCardCount ?? 4;
    for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
      const target = cheatTargetForCard(skillId, legIndex, cardIndex);
      if (!target) continue;
      if (skillId === "swap-face-up" && playerOwnedSide(pending) !== target.side) continue;
      targets.push(target);
    }
  });
  return targets;
}

function hasLegalCheatOpportunity(): boolean {
  if (game.availableChips < CHEAT_SKILL_COST) return false;
  return game.availableCheatSkills.some((skillId) => !cheatSkillActivationBlockReason(skillId));
}

function refreshCheatTargetScene(target: CheatTarget, skillId: CheatSkillId): void {
  const pending = game.pendingChain ? pendingChainLeg(target.legIndex) : game.pending;
  const scene = game.pendingChain ? chainScenes.get(target.legIndex) : tableScene;
  if (!pending || !scene) return;
  const sequence = dealSequence(pending);
  sequence.forEach((entry, index) => scene.setCard(index, entry.card));
  if (skillId === "peek-covered") {
    const chainState = game.pendingChain ? chainLegUiStates.get(target.legIndex) : null;
    const active = !game.pendingChain || Boolean(game.pending && game.pendingChain.currentLegIndex === target.legIndex);
    const revealed = active ? revealedCardIndices : new Set(chainState?.revealedCardIndices ?? []);
    const peeked = active ? peekedCardIndices : new Set(chainState?.peekedCardIndices ?? []);
    const count = active ? dealtCardCount : chainState?.dealtCardCount ?? sequence.length;
    for (let index = 0; index < count; index += 1) {
      if (!revealed.has(index)) {
        peeked.add(index);
        scene.showPeeked(index);
      }
    }
    if (active) {
      peekedCardIndices = peeked;
      scene.setCardSelection(unrevealedDealtCardIndices(count, revealed), selectCardForReveal);
    } else {
      chainLegUiStates.set(target.legIndex, {
        dealtCardCount: count,
        revealedCardIndices: revealed,
        peekedCardIndices: peeked,
        dealStage: chainState?.dealStage ?? "awaiting-card",
        divineCheckedStages: new Set(chainState?.divineCheckedStages ?? []),
        divineRevealFeedback: new Map(chainState?.divineRevealFeedback ?? []),
        divineActivations: chainState?.divineActivations ?? 0,
      });
      scene.setCardSelection(unrevealedDealtCardIndices(count, revealed), (cardIndex) => selectCardForRevealForLeg(target.legIndex, cardIndex));
    }
  }
}

function refreshAllPeekedScenes(): void {
  const legs = game.pendingChain ? game.pendingChain.legs.map((_, index) => index) : [0];
  legs.forEach((legIndex) => {
    const pending = game.pendingChain ? pendingChainLeg(legIndex) : game.pending;
    if (!pending) return;
    const active = !game.pendingChain || Boolean(game.pending && game.pendingChain.currentLegIndex === legIndex);
    const state = game.pendingChain ? chainLegUiStates.get(legIndex) : null;
    const scene = game.pendingChain ? chainScenes.get(legIndex) : tableScene;
    if (!scene) return;
    const count = active ? dealtCardCount : state?.dealtCardCount ?? 4;
    const revealed = active ? revealedCardIndices : new Set(state?.revealedCardIndices ?? []);
    const peeked = active ? peekedCardIndices : new Set(state?.peekedCardIndices ?? []);
    for (let index = 0; index < count; index += 1) {
      if (!revealed.has(index)) {
        peeked.add(index);
        scene.showPeeked(index);
      }
    }
    if (active) {
      peekedCardIndices = peeked;
      if (dealStage === "awaiting-card") {
        scene.setCardSelection(unrevealedDealtCardIndices(count, revealed), selectCardForReveal);
      }
      return;
    }
    chainLegUiStates.set(legIndex, {
      dealtCardCount: count,
      revealedCardIndices: revealed,
      peekedCardIndices: peeked,
      dealStage: state?.dealStage ?? "awaiting-card",
      divineCheckedStages: new Set(state?.divineCheckedStages ?? []),
      divineRevealFeedback: new Map(state?.divineRevealFeedback ?? []),
      divineActivations: state?.divineActivations ?? 0,
    });
    if (state?.dealStage === "awaiting-card") {
      scene.setCardSelection(unrevealedDealtCardIndices(count, revealed), (cardIndex) => selectCardForRevealForLeg(legIndex, cardIndex));
    }
  });
}

function applyCheatSkillToTarget(skillId: CheatSkillId, target: CheatTarget): void {
  if (!ensureCheatSkillAffordable()) return;
  if (skillId === "swap-covered" || skillId === "swap-face-up") {
    openCardReorder(skillId);
    return;
  }
  const overlay = document.querySelector<HTMLElement>(".cheat-target-picker");
  overlay?.remove();
  const pending = game.pendingChain ? pendingChainLeg(target.legIndex) : game.pending;
  if (!pending || !game.useCheatSkill(skillId, target.side, target.handIndex, game.pendingChain ? target.legIndex : null)) {
    game.notice = "当前牌面无法使用这项千术";
    render();
    return;
  }
  game.notice = skillId === "peek-covered"
    ? `出千成功 · 所有已发出的盖牌均已透视 · 消耗 ${CHEAT_SKILL_COST} 枚筹码`
    : `出千成功 · 指定第 ${target.legIndex + 1} 局第 ${target.handIndex + 1} 张 · 消耗 ${CHEAT_SKILL_COST} 枚筹码`;
  finishCheatSkillUse(skillId, target, pending);
}

function reconcileSettledChainAfterCheat(legIndex: number, pending: PendingRound): boolean {
  const chain = game.pendingChain;
  if (!chain?.legs[legIndex]?.settled) return false;
  const snapshot = snapshotChainSettlement(chain);
  let settlement = game.reconcileChainAfterCheat(legIndex);
  if (settlement?.chainContinues && chain.legs.every((leg) => leg.settled) && !hasLegalCheatOpportunity()) {
    settlement = game.finalizeSettledChain() ?? settlement;
  }
  if (!settlement) return false;

  if (chain.currentLegIndex === legIndex || settlement.chainCompleted) lastRound = pending;
  lastSettlement = settlement;
  if (settlement.chainCompleted) {
    recordCompletedChain(snapshot, settlement);
    applyDealerRewardNotice(settlement);
    dealStage = "settled";
  } else if (chain.legs.every((leg) => leg.settled)) {
    dealStage = "settled";
  }
  render();
  showTableActionNotice(game.notice, "success");
  return true;
}

function finishCheatSkillUse(skillId: CheatSkillId, target: CheatTarget, pending: PendingRound): void {
  if (skillId === "peek-covered") refreshAllPeekedScenes();
  else refreshCheatTargetScene(target, skillId);
  playCheatChipSpendAnimation();
  const chipWallet = document.querySelector<HTMLElement>(".chip-wallet strong");
  if (chipWallet) chipWallet.textContent = `${game.availableChips} 枚`;
  if (reconcileSettledChainAfterCheat(target.legIndex, pending)) return;
  const targetStillLosing = pendingIsLoss(pending);
  const noCheatResourcesRemaining = game.availableChips <= 0 || game.availableCheatSkills.length === 0;
  const targetWasAwaitingCheat = awaitingCheatLegIndices().includes(target.legIndex);
  if (targetWasAwaitingCheat && (!targetStillLosing || noCheatResourcesRemaining)) {
    if (game.pendingChain && game.pendingChain.currentLegIndex !== target.legIndex) selectChainLeg(target.legIndex);
    if (game.pending) {
      dealStage = "awaiting-cheat";
      settleOnTable();
      return;
    }
  }
  restoreCardRevealSelection();
  updateChainLegReports();
}

function clearCheatTargetSelection(): void {
  if (game.pendingChain) {
    game.pendingChain.legs.forEach((_, legIndex) => chainScenes.get(legIndex)?.setCardSelection([], () => undefined));
    return;
  }
  tableScene?.setCardSelection([], () => undefined);
}

function selectSetEdgeTarget(target: CheatTarget): void {
  setEdgeTarget = target;
  clearCheatTargetSelection();
  game.notice = cheatTargetInstruction("set-edge");
  updateCheatArmedState();
}

function applySetEdgeChoice(type: DivineCardType): void {
  if (!ensureCheatSkillAffordable()) return;
  const target = setEdgeTarget;
  const pending = target && (game.pendingChain ? pendingChainLeg(target.legIndex) : game.pending);
  if (!target || !pending || !game.useSetEdge(target, type)) {
    setEdgeTarget = null;
    armedCheatSkill = null;
    game.notice = "当前牌面无法指定边数";
    updateCheatArmedState();
    restoreCardRevealSelection();
    showTableActionNotice(game.notice);
    return;
  }

  const typeLabel = DIVINE_CARD_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? type;
  setEdgeTarget = null;
  armedCheatSkill = null;
  updateCheatArmedState();
  game.notice = `指定边数成功 · 第 ${target.legIndex + 1} 局第 ${target.handIndex + 1} 张为${typeLabel} · 消耗 ${CHEAT_SKILL_COST} 枚筹码`;
  finishCheatSkillUse("set-edge", target, pending);
}

function openCardReorder(skillId: "swap-covered" | "swap-face-up"): void {
  if (!ensureCheatSkillCanActivate(skillId)) return;
  cardReorderSession?.cancel();
  const isFaceUpSwap = skillId === "swap-face-up";
  const cards: ReorderSceneCard[] = [];
  const legs = game.pendingChain ? game.pendingChain.legs.map((_, index) => index) : [0];
  legs.forEach((legIndex) => {
    const pending = game.pendingChain ? pendingChainLeg(legIndex) : game.pending;
    const scene = game.pendingChain ? chainScenes.get(legIndex) : tableScene;
    if (!pending || !scene) return;
    const ownedSide = playerOwnedSide(pending);
    if (!ownedSide) return;
    const active = !game.pendingChain || Boolean(game.pending && game.pendingChain.currentLegIndex === legIndex);
    const count = active ? dealtCardCount : chainLegUiStates.get(legIndex)?.dealtCardCount ?? 4;
    const revealed = active ? revealedCardIndices : chainLegUiStates.get(legIndex)?.revealedCardIndices ?? new Set<number>();
    dealSequence(pending).slice(0, count).forEach((entry, cardIndex) => {
      if (entry.side === ownedSide && revealed.has(cardIndex) === isFaceUpSwap) {
        cards.push({ legIndex, side: entry.side, handIndex: entry.handIndex, cardIndex, scene });
      }
    });
  });
  if (cards.length < 2 || (!isFaceUpSwap && new Set(cards.map((card) => card.legIndex)).size < 2)) {
    const cardKind = isFaceUpSwap ? "明牌" : "盖牌";
    game.notice = !isFaceUpSwap && cards.length >= 2
      ? "重排盖牌需要至少两个牌局各有一张己方盖牌"
      : cards.length ? `当前只有一张己方${cardKind}，无法交换` : `当前没有可交换的己方${cardKind}`;
    showTableActionNotice(game.notice);
    return;
  }
  const cardsByScene = new Map<TableScene, ReorderSceneCard[]>();
  cards.forEach((card) => {
    const sceneCards = cardsByScene.get(card.scene) ?? [];
    sceneCards.push(card);
    cardsByScene.set(card.scene, sceneCards);
  });
  const locations = new Map(cards.map((card) => [card, card]));
  const reorderSurface = document.createElement("div");
  reorderSurface.className = "covered-reorder-surface";
  document.body.append(reorderSurface);
  const reorderRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  reorderRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  reorderRenderer.setClearColor(0x000000, 0);
  reorderRenderer.domElement.className = "covered-reorder-3d-canvas";
  reorderSurface.append(reorderRenderer.domElement);
  const reorderScene = new THREE.Scene();
  const reorderCamera = new THREE.OrthographicCamera(0, window.innerWidth, 0, window.innerHeight, 0.1, 100);
  reorderCamera.position.z = 10;
  const reorderModels = new Map<ReorderSceneCard, THREE.Group>();
  let dragModel: THREE.Group | null = null;
  let dragPosition = new THREE.Vector2();
  const exchangeAnimations = new Map<THREE.Group, {
    model: THREE.Group;
    from: THREE.Vector2;
    to: THREE.Vector2;
    fromWidth: number;
    toWidth: number;
    startedAt: number;
  }>();
  let reorderAnimationFrame = 0;
  let closed = false;
  const setReorderModelPosition = (model: THREE.Group, x: number, y: number, width: number, rotation = -0.045) => {
    const scale = Math.max(54, width) / 1.15;
    model.position.set(x, y, 0);
    // 页面坐标的 Y 轴向下，翻转全局模型以保持牌背与牌桌内的朝向一致。
    model.scale.set(scale, -scale, scale);
    model.rotation.set(0, 0, rotation);
  };
  const createReorderModel = (card: ReorderSceneCard): THREE.Group | null => {
    const model = card.scene.coveredReorderCardModel(card.cardIndex);
    if (!model) return null;
    reorderModels.set(card, model);
    reorderScene.add(model);
    return model;
  };
  const cardBounds = (card: ReorderSceneCard) => card.scene.coveredReorderCardScreenBounds(card.cardIndex);
  const positionModelAtLocation = (card: ReorderSceneCard, model: THREE.Group, now: number) => {
    const location = locations.get(card);
    const bounds = location ? cardBounds(location) : null;
    if (!bounds) return;
    const width = (bounds.right - bounds.left) * (card === foreignHover ? 1.14 : 1);
    const x = (bounds.left + bounds.right) / 2;
    const y = (bounds.top + bounds.bottom) / 2 + Math.sin(now / 230 + card.cardIndex * 1.7) * 4;
    setReorderModelPosition(model, x, y, width);
  };
  const renderReorderModels = () => {
    if (closed) return;
    reorderAnimationFrame = 0;
    const now = performance.now();
    reorderModels.forEach((model, card) => {
      if (model === dragModel || exchangeAnimations.has(model)) return;
      positionModelAtLocation(card, model, now);
    });
    if (dragModel) {
      dragModel.position.x = dragPosition.x;
      dragModel.position.y = dragPosition.y;
      dragModel.rotation.z = -0.055 + Math.sin(now / 95) * 0.016;
    }
    exchangeAnimations.forEach((animation, model) => {
      const progress = Math.min((now - animation.startedAt) / 440, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      const x = THREE.MathUtils.lerp(animation.from.x, animation.to.x, eased);
      const y = THREE.MathUtils.lerp(animation.from.y, animation.to.y, eased);
      const width = THREE.MathUtils.lerp(animation.fromWidth, animation.toWidth, eased);
      setReorderModelPosition(model, x, y, width, THREE.MathUtils.lerp(-0.1, 0.1, progress));
      model.position.z = 0.1 + Math.sin(progress * Math.PI) * 0.9;
      if (progress >= 1) {
        model.position.z = 0;
        exchangeAnimations.delete(model);
      }
    });
    reorderRenderer.render(reorderScene, reorderCamera);
    reorderAnimationFrame = requestAnimationFrame(renderReorderModels);
  };
  const resizeReorderRenderer = () => {
    reorderRenderer.setSize(window.innerWidth, window.innerHeight, false);
    reorderCamera.left = 0;
    reorderCamera.right = window.innerWidth;
    reorderCamera.top = 0;
    reorderCamera.bottom = window.innerHeight;
    reorderCamera.updateProjectionMatrix();
  };
  resizeReorderRenderer();
  const startGlobalDrag = (card: ReorderSceneCard, clientX: number, clientY: number) => {
    dragModel = reorderModels.get(card) ?? null;
    if (dragModel) exchangeAnimations.delete(dragModel);
    if (dragModel) setReorderModelPosition(dragModel, clientX, clientY, 86);
    dragPosition.set(clientX, clientY);
  };
  const moveGlobalDrag = (clientX: number, clientY: number) => {
    dragPosition.set(clientX, clientY);
  };
  const endGlobalDrag = () => {
    dragModel = null;
  };
  const animateReorderExchange = (
    from: ReorderSceneCard,
    fromLocation: ReorderSceneCard,
    to: ReorderSceneCard,
    toLocation: ReorderSceneCard,
  ) => {
    const fromBounds = cardBounds(fromLocation);
    const toBounds = cardBounds(toLocation);
    if (!fromBounds || !toBounds) return;
    const fromModel = reorderModels.get(from);
    const toModel = reorderModels.get(to);
    const fromCenter = new THREE.Vector2((fromBounds.left + fromBounds.right) / 2, (fromBounds.top + fromBounds.bottom) / 2);
    const toCenter = new THREE.Vector2((toBounds.left + toBounds.right) / 2, (toBounds.top + toBounds.bottom) / 2);
    const fromWidth = fromBounds.right - fromBounds.left;
    const toWidth = toBounds.right - toBounds.left;
    if (fromModel) {
      const origin = dragModel === fromModel ? dragPosition.clone() : fromCenter;
      exchangeAnimations.set(fromModel, { model: fromModel, from: origin, to: toCenter, fromWidth, toWidth, startedAt: performance.now() });
    }
    if (toModel) {
      exchangeAnimations.set(toModel, { model: toModel, from: toCenter, to: fromCenter, fromWidth: toWidth, toWidth: fromWidth, startedAt: performance.now() });
    }
  };
  const clearReorderVisuals = () => {
    closed = true;
    if (reorderAnimationFrame) cancelAnimationFrame(reorderAnimationFrame);
    reorderModels.forEach((model) => reorderScene.remove(model));
    reorderModels.clear();
    reorderRenderer.dispose();
    reorderSurface.remove();
    window.removeEventListener("resize", resizeReorderRenderer);
  };
  window.addEventListener("resize", resizeReorderRenderer);
  const cardAtSlot = (scene: TableScene, cardIndex: number): ReorderSceneCard | null => cards.find((card) => {
    const location = locations.get(card);
    return location?.scene === scene && location.cardIndex === cardIndex;
  }) ?? null;
  const foreignCardAt = (sourceScene: TableScene, clientX: number, clientY: number): ReorderSceneCard | null => {
    for (const [scene] of cardsByScene) {
      if (scene === sourceScene) continue;
      const cardIndex = scene.coveredReorderCardAtClientPoint(clientX, clientY);
      const card = cardIndex === null ? null : cardAtSlot(scene, cardIndex);
      if (card) return card;
    }
    return null;
  };
  let foreignHover: ReorderSceneCard | null = null;
  const setForeignHover = (card: ReorderSceneCard | null) => {
    if (foreignHover === card) return;
    foreignHover = card;
  };
  let faceUpSwapPair: [ReorderSceneCard, ReorderSceneCard] | null = null;
  const swapLocations = (from: ReorderSceneCard, to: ReorderSceneCard) => {
    if (from === to) return;
    if (isFaceUpSwap && faceUpSwapPair) return;
    const fromLocation = locations.get(from);
    const toLocation = locations.get(to);
    if (!fromLocation || !toLocation) return;
    locations.set(from, toLocation);
    locations.set(to, fromLocation);
    animateReorderExchange(from, fromLocation, to, toLocation);
    if (isFaceUpSwap) {
      faceUpSwapPair = [from, to];
      startedScenes.forEach((scene) => scene.setCoveredReorderInteractionEnabled(false));
    }
  };
  const startedScenes: TableScene[] = [];
  for (const [scene, sceneCards] of cardsByScene) {
    const started = scene.beginCoveredReorder(
      sceneCards.map((card) => card.cardIndex),
      (fromIndex, toIndex) => {
        const from = cardAtSlot(scene, fromIndex);
        const to = cardAtSlot(scene, toIndex);
        if (from && to) swapLocations(from, to);
      },
      {
        externalRenderer: true,
        allowLocalSwap: isFaceUpSwap,
        cardState: isFaceUpSwap ? "revealed" : "covered",
        onDragStart: (fromIndex, clientX, clientY) => {
          const from = cardAtSlot(scene, fromIndex);
          if (from) startGlobalDrag(from, clientX, clientY);
        },
        onDrag: (fromIndex, clientX, clientY) => {
          if (fromIndex < 0) {
            setForeignHover(null);
            endGlobalDrag();
            return;
          }
          setForeignHover(foreignCardAt(scene, clientX, clientY));
          moveGlobalDrag(clientX, clientY);
        },
        onDrop: (fromIndex, clientX, clientY) => {
          const from = cardAtSlot(scene, fromIndex);
          const to = foreignCardAt(scene, clientX, clientY);
          setForeignHover(null);
          if (!from || !to) return false;
          swapLocations(from, to);
          return true;
        },
      },
    );
    if (!started) {
      startedScenes.forEach((startedScene) => startedScene.endCoveredReorder());
      clearReorderVisuals();
      return;
    }
    startedScenes.push(scene);
  }
  cards.forEach(createReorderModel);
  renderReorderModels();
  const finishReorder = () => {
    if (closed) return false;
    startedScenes.forEach((scene) => scene.endCoveredReorder());
    clearReorderVisuals();
    cardReorderSession = null;
    armedCheatSkill = null;
    updateCheatArmedState();
    return true;
  };
  cardReorderSession = {
    cancel: () => {
      if (!finishReorder()) return;
      game.notice = isFaceUpSwap ? "已取消调换明牌" : "已取消重排盖牌";
      restoreCardRevealSelection();
      showTableActionNotice(game.notice, "neutral");
    },
    confirm: () => {
      if (!ensureCheatSkillAffordable()) return;
      if (isFaceUpSwap && !faceUpSwapPair) {
        game.notice = "请先拖动一张己方明牌到另一张明牌上";
        showTableActionNotice(game.notice);
        return;
      }
      if (!finishReorder()) return;
      const sources = cards.map((destination) => cards.find((card) => locations.get(card) === destination)!);
      const success = isFaceUpSwap
        ? game.useFaceUpSwap(faceUpSwapPair![0], faceUpSwapPair![1])
        : game.useCoveredReorder(cards, sources);
      if (!success) {
        game.notice = `当前牌面无法使用${isFaceUpSwap ? "调换明牌" : "重排盖牌"}`;
        render();
        showTableActionNotice(game.notice);
        return;
      }
      game.notice = isFaceUpSwap
        ? `调换明牌成功 · 已交换两张己方明牌 · 消耗 ${CHEAT_SKILL_COST} 枚筹码`
        : `重排盖牌成功 · 已重新安排 ${cards.length} 张己方盖牌 · 消耗 ${CHEAT_SKILL_COST} 枚筹码`;
      cardsByScene.forEach((sceneCards, scene) => {
        const pending = game.pendingChain ? pendingChainLeg(sceneCards[0]!.legIndex) : game.pending;
        if (!pending) return;
        dealSequence(pending).forEach((entry, index) => scene.setCard(index, entry.card));
      });
      playCheatChipSpendAnimation();
      const chipWallet = document.querySelector<HTMLElement>(".chip-wallet strong");
      if (chipWallet) chipWallet.textContent = `${game.availableChips} 枚`;
      const settledTarget = (isFaceUpSwap ? faceUpSwapPair! : cards)
        .find((card) => game.pendingChain?.legs[card.legIndex]?.settled);
      const settledPending = settledTarget ? pendingChainLeg(settledTarget.legIndex) : null;
      if (settledTarget && settledPending && reconcileSettledChainAfterCheat(settledTarget.legIndex, settledPending)) return;
      restoreCardRevealSelection();
      updateChainLegReports();
      showTableActionNotice(game.notice, "success");
    },
  };
  armedCheatSkill = skillId;
  updateCheatArmedState();
  bindCoveredReorderActions();
}

function cheatSkillActivationBlockReason(skillId: CheatSkillId): string | null {
  const definition = cheatSkillDefinitions.find((item) => item.id === skillId);
  const name = definition?.name ?? "这项千术";
  const targets = cheatTargetsOnTable(skillId);

  if (skillId === "swap-covered") {
    if (!targets.length) return `场上没有己方盖牌，${name}无法发动`;
    if (new Set(targets.map((target) => target.legIndex)).size < 2) {
      return `${name}需要至少两个牌局各有一张己方盖牌`;
    }
    return null;
  }

  if (skillId === "swap-face-up") {
    if (!targets.length) return `场上没有己方明牌，${name}无法发动`;
    if (targets.length < 2) return `当前只有一张己方明牌，无法${name}`;
    return null;
  }

  if (targets.length) return null;
  if (skillId === "peek-covered") return `场上已经没有盖牌，${name}无法发动`;
  if (skillId === "set-edge") return `场上没有盖牌，${name}无法发动`;
  return `场上没有明牌，${name}无法发动`;
}

function ensureCheatSkillCanActivate(skillId: CheatSkillId): boolean {
  if (!ensureCheatSkillAffordable()) return false;
  const reason = cheatSkillActivationBlockReason(skillId);
  if (!reason) return true;
  game.notice = reason;
  showTableActionNotice(reason);
  return false;
}

function usePeekCoveredImmediately(): void {
  if (!ensureCheatSkillCanActivate("peek-covered")) return;
  const legs = game.pendingChain ? game.pendingChain.legs.map((_, index) => index) : [0];
  for (const legIndex of legs) {
    const pending = game.pendingChain ? pendingChainLeg(legIndex) : game.pending;
    if (!pending) continue;
    const active = !game.pendingChain || Boolean(game.pending && game.pendingChain.currentLegIndex === legIndex);
    const count = active ? dealtCardCount : chainLegUiStates.get(legIndex)?.dealtCardCount ?? 4;
    for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
      const target = cheatTargetForCard("peek-covered", legIndex, cardIndex);
      if (target) {
        applyCheatSkillToTarget("peek-covered", target);
        return;
      }
    }
  }
}

function showTableActionNotice(message: string, tone: "error" | "neutral" | "success" = "error"): void {
  document.querySelector(".table-action-notice")?.remove();
  const notice = document.createElement("div");
  notice.className = `table-action-notice ${tone}`;
  notice.setAttribute("role", "status");
  notice.textContent = message;
  document.body.appendChild(notice);
  requestAnimationFrame(() => notice.classList.add("visible"));
  window.setTimeout(() => {
    notice.classList.remove("visible");
    window.setTimeout(() => notice.remove(), 180);
  }, 1800);
}

function ensureCheatSkillAffordable(): boolean {
  if (game.availableChips >= CHEAT_SKILL_COST) return true;
  game.notice = `筹码不足，发动千术需要 ${CHEAT_SKILL_COST} 枚筹码`;
  showTableActionNotice(game.notice);
  return false;
}

function openCheatTargetPicker(skillId: CheatSkillId): void {
  if (!ensureCheatSkillCanActivate(skillId)) return;
  if (skillId === "set-edge") setEdgeTarget = null;
  armedCheatSkill = skillId;
  game.notice = cheatTargetInstruction(skillId);
  updateCheatArmedState();
  const legs = game.pendingChain ? game.pendingChain.legs.map((_, index) => index) : [0];
  legs.forEach((legIndex) => {
    const pending = game.pendingChain ? pendingChainLeg(legIndex) : game.pending;
    if (!pending) return;
    const active = !game.pendingChain || Boolean(game.pending && game.pendingChain.currentLegIndex === legIndex);
    const count = active ? dealtCardCount : chainLegUiStates.get(legIndex)?.dealtCardCount ?? 4;
    const selectable = dealSequence(pending).slice(0, count).map((_, cardIndex) => cardIndex).filter((cardIndex) => Boolean(cheatTargetForCard(skillId, legIndex, cardIndex)));
    const scene = game.pendingChain ? chainScenes.get(legIndex) : tableScene;
    scene?.setCardSelection(selectable, (cardIndex) => game.pendingChain ? selectCardForRevealForLeg(legIndex, cardIndex) : selectCardForReveal(cardIndex, scene), true);
  });
}

function cheatTargetInstruction(skillId: CheatSkillId): string {
  const definition = cheatSkillDefinitions.find((item) => item.id === skillId);
  if (skillId === "swap-covered") return `${definition?.name ?? "重排盖牌"}进行中 · 费用 ${CHEAT_SKILL_COST} 枚筹码 · 可跨牌局调换全部己方盖牌`;
  if (skillId === "swap-face-up") return `${definition?.name ?? "调换明牌"}进行中 · 费用 ${CHEAT_SKILL_COST} 枚筹码 · 拖动一张己方明牌到另一张上，只能交换一组`;
  if (skillId === "set-edge") {
    return setEdgeTarget
      ? `指定边数进行中 · 已选择盖牌 · 费用 ${CHEAT_SKILL_COST} 枚筹码 · 请选择边数`
      : `指定边数已选择 · 费用 ${CHEAT_SKILL_COST} 枚筹码 · 请点击任意牌局的一张盖牌`;
  }
  const target = definition?.timing === "face-up" ? "明牌牌张" : "盖牌牌张";
  return `${definition?.name ?? "千术"}已选择 · 费用 ${CHEAT_SKILL_COST} 枚筹码 · 请点击任意牌局的${target}`;
}

function updateCheatArmedState(): void {
  const isCardReorder = armedCheatSkill === "swap-covered" || armedCheatSkill === "swap-face-up";
  const isChoosingSetEdgeType = armedCheatSkill === "set-edge" && Boolean(setEdgeTarget);
  const reorderName = armedCheatSkill === "swap-face-up" ? "调换明牌" : "重排盖牌";
  document.body.classList.toggle("cheat-target-armed", Boolean(armedCheatSkill));
  document.querySelectorAll<HTMLElement>("[data-cheat-armed-label]").forEach((element) => {
    element.textContent = armedCheatSkill ? cheatTargetInstruction(armedCheatSkill) : "出千 · 选择千术后点击目标牌";
  });
  document.querySelectorAll<HTMLElement>("[data-cheat-cancel]").forEach((element) => {
    element.classList.toggle("hidden", !armedCheatSkill || isCardReorder);
    element.hidden = !armedCheatSkill || isCardReorder;
    element.textContent = "取消出千";
  });
  document.querySelectorAll<HTMLElement>("[data-covered-reorder-cancel]").forEach((element) => {
    element.classList.toggle("hidden", !isCardReorder);
    element.hidden = !isCardReorder;
    element.textContent = `取消${reorderName}`;
  });
  document.querySelectorAll<HTMLElement>("[data-covered-reorder-confirm]").forEach((element) => {
    element.classList.toggle("hidden", !isCardReorder);
    element.hidden = !isCardReorder;
    element.textContent = `确认${reorderName}`;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-cheat-skill]").forEach((element) => {
    element.hidden = Boolean(armedCheatSkill);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-set-edge-type]").forEach((element) => {
    element.hidden = !isChoosingSetEdgeType;
  });
}

function playCheatChipSpendAnimation(): void {
  const wallet = document.querySelector<HTMLElement>(".chip-wallet");
  if (!wallet) return;
  const panel = [...document.querySelectorAll<HTMLElement>(".cheat-controls")]
    .find((element) => element.getClientRects().length > 0);
  const walletBounds = wallet.getBoundingClientRect();
  const panelBounds = panel?.getBoundingClientRect();
  const startX = walletBounds.left + walletBounds.width / 2;
  const startY = walletBounds.top + walletBounds.height / 2;
  const targetX = panelBounds ? panelBounds.left + panelBounds.width / 2 : startX;
  const targetY = panelBounds ? panelBounds.top + panelBounds.height / 2 : startY;
  const chip = document.createElement("span");
  chip.className = "cheat-chip-spend";
  chip.setAttribute("aria-hidden", "true");
  chip.textContent = "1";
  chip.style.left = `${startX}px`;
  chip.style.top = `${startY}px`;
  chip.style.setProperty("--chip-dx", `${targetX - startX}px`);
  chip.style.setProperty("--chip-dy", `${targetY - startY}px`);
  chip.style.setProperty("--chip-dx-mid", `${(targetX - startX) * 0.72}px`);
  chip.style.setProperty("--chip-dy-mid", `${(targetY - startY) * 0.72}px`);
  document.body.appendChild(chip);
  wallet.classList.remove("chip-wallet-spending");
  void wallet.offsetWidth;
  wallet.classList.add("chip-wallet-spending");
  panel?.classList.remove("cheat-controls-receiving");
  requestAnimationFrame(() => chip.classList.add("active"));
  if (panel) {
    window.setTimeout(() => panel.classList.add("cheat-controls-receiving"), 560);
  }
  window.setTimeout(() => {
    chip.remove();
    wallet.classList.remove("chip-wallet-spending");
    panel?.classList.remove("cheat-controls-receiving");
  }, 700);
}

function restoreCardRevealSelection(): void {
  if (game.pendingChain) {
    game.pendingChain.legs.forEach((leg, index) => {
      if (leg.settled) return;
      const active = game.pendingChain?.currentLegIndex === index;
      const state = chainLegUiStates.get(index);
      const count = active ? dealtCardCount : state?.dealtCardCount ?? 4;
      const revealed = active ? revealedCardIndices : state?.revealedCardIndices ?? new Set<number>();
      const stage = active ? dealStage : state?.dealStage ?? "awaiting-card";
      chainScenes.get(index)?.setCardSelection(
        stage === "awaiting-card" ? unrevealedDealtCardIndices(count, revealed) : [],
        (cardIndex) => selectCardForRevealForLeg(index, cardIndex),
      );
    });
    return;
  }
  if (tableScene && game.pending && dealStage === "awaiting-card") {
    tableScene.setCardSelection(unrevealedDealtCardIndices(dealtCardCount, revealedCardIndices), selectCardForReveal);
  }
}

function cancelCheatSelection(): void {
  if (cardReorderSession) {
    cardReorderSession.cancel();
    return;
  }
  armedCheatSkill = null;
  setEdgeTarget = null;
  game.notice = "已取消出千选择";
  updateCheatArmedState();
  restoreCardRevealSelection();
}
const worldTimeLabel = () => {
  const { day, hour, minute } = game.worldTimeInfo();
  return `第 ${day} 日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};
const lastSleepDurationLabel = () => {
  const totalMinutes = Math.max(0, Math.round(game.lastSleepDurationWorldMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (hours > 0) return `${hours} 小时`;
  return `${minutes} 分钟`;
};
const worldIsDaylight = () => {
  const { hour } = game.worldTimeInfo();
  return hour >= 6 && hour < 18;
};
const worldTimePaused = () => activeActivity === "home"
  || (activeActivity === "restaurant" && !game.restaurant.open && !game.restaurant.pawned)
  || restaurantClosingPromptOpen
  || sleepTransitionActive
  || wakePromptOpen
  || restChoiceOpen
  || sleepDeprivationNoticeOpen
  || sleepCollapsePromptOpen
  || view === "table"
  || (view === "dealing" && (dealStage === "awaiting-card" || dealStage === "settled" || tablePlayerInteractionActive))
  || (view === "dealing" && (dealStage === "awaiting-cheat" || awaitingCheatLegIndices().length > 0))
  || (debugMenuOpen && view === "dealing");

function confidenceDelta(value: number): string {
  const percent = Math.round(value * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function confidenceSourceRow(label: string, value: number, detail: string): string {
  const state = value > 1e-9 ? "gain" : value < -1e-9 ? "loss" : "neutral";
  return `<div class="confidence-source-row"><div><strong>${label}</strong><small>${detail}</small></div><b class="${state}">${confidenceDelta(value)}</b></div>`;
}

function confidenceDetailsMarkup(): string {
  const pending = game.pending ?? lastRound;
  const hasBet = Boolean(pending?.bet);
  const showingCurrentRound = pending === game.pending;
  const breakdown = pending?.confidenceBreakdown;
  const roadCreationPenalty = !game.debugConfidenceForced && !showingCurrentRound && lastSettlement?.roadCreation?.matched === false
    ? -lastSettlement.roadCreation.confidencePenalty
    : 0;
  const title = `${Math.round(game.confidence * 100)}%`;
  const description = game.debugConfidenceForced
    ? "调试锁定已启用，当前信心固定为 100%；下方保留原始计算来源。"
    : hasBet
      ? showingCurrentRound ? "本局已封盘，以下为当前信心的计算来源。" : "本局已结算，以下为最近一局的信心计算来源。"
      : "当前未封盘，下注相关修正会在确认下注后计算。";
  const rows = breakdown && pending?.bet ? [
    confidenceSourceRow("基础信心", breakdown.base, "每局计算的起始值"),
    confidenceSourceRow("下注占比", breakdown.wagerBonus, `本局下注 ${chips(pending.bet.amount)}，按下注占比计算`),
    confidenceSourceRow("标记路数", breakdown.markedPatternBonus, breakdown.markedPatterns.length
      ? `命中：${breakdown.markedPatterns.map((pattern) => pattern.name).join("、")}`
      : "未命中与本局目标一致的标记路数"),
    confidenceSourceRow("路数长度", breakdown.lengthBonus, breakdown.markedPatterns.length
      ? `命中路数的额外长度：${breakdown.markedPatterns.map((pattern) => `${pattern.name} ${pattern.length} 连`).join("、")}`
      : "无命中标记路数，不产生长度加成"),
    confidenceSourceRow("逆势路数", breakdown.opposingPatternPenalty, breakdown.opposingPatterns.length
      ? `相反预测：${breakdown.opposingPatterns.map((pattern) => pattern.name).join("、")}`
      : "无相反预测的有效路数"),
    confidenceSourceRow("局连胜", breakdown.roundStreakBonus, breakdown.roundStreakBonus > 0
      ? `此前连续获胜 ${Math.round(breakdown.roundStreakBonus / 0.01)} 局`
      : "此前没有连续获胜记录"),
    confidenceSourceRow("天连胜", breakdown.dayStreakBonus, breakdown.dayStreakBonus > 0
      ? `此前连续盈利 ${Math.round(breakdown.dayStreakBonus / 0.05)} 天`
      : "此前没有连续盈利日记录"),
    ...(!showingCurrentRound ? [confidenceSourceRow("创造路数结算", roadCreationPenalty, roadCreationPenalty < 0 ? "预测落空，结算后扣除信心" : "本局没有创造路数扣减")] : []),
  ].join("") : confidenceSourceRow("基础信心", game.debugBaseConfidence, "当前未确认下注，暂无其他修正项");
  const calculatedTotal = Math.max(0, Math.min(1, (breakdown?.total ?? game.debugBaseConfidence) + roadCreationPenalty));
  return `<aside class="confidence-details" id="confidence-details" role="dialog" aria-labelledby="confidence-details-title"><header><div><span>信心来源</span><h2 id="confidence-details-title">${title}</h2></div><button type="button" data-confidence-details-close aria-label="关闭信心来源">×</button></header><p>${description}</p><div class="confidence-source-list">${rows}</div><footer><span>${game.debugConfidenceForced ? "原始总计" : "总计"}</span><strong>${Math.round(calculatedTotal * 100)}%</strong></footer></aside>`;
}

function bindConfidenceDetails(): void {
  const closeButton = app.querySelector<HTMLButtonElement>("[data-confidence-details-close]");
  if (!closeButton || closeButton.dataset.confidenceDetailsBound === "true") return;
  closeButton.dataset.confidenceDetailsBound = "true";
  closeButton.addEventListener("click", () => {
    confidenceDetailsOpen = false;
    syncConfidenceDetails();
  });
}

function syncConfidenceDetails(): void {
  const existing = app.querySelector<HTMLElement>("#confidence-details");
  const toggle = app.querySelector<HTMLButtonElement>("[data-action=\"toggle-confidence-details\"]");
  toggle?.setAttribute("aria-expanded", String(confidenceDetailsOpen));
  if (!confidenceDetailsOpen) {
    existing?.remove();
    return;
  }
  if (existing) existing.outerHTML = confidenceDetailsMarkup();
  else app.insertAdjacentHTML("beforeend", confidenceDetailsMarkup());
  bindConfidenceDetails();
}

function shell(content: string): string {
  const atTable = view === "table" || view === "dealing";
  const backAction = atTable ? "lobby" : view === "lobby" ? "casinos" : "map";
  const backLabel = atTable ? "返回大厅" : view === "lobby" ? "返回赌场" : "回到地图";
  const backDisabled = (view === "table" && inlineWatchActive && !inlineWatchSettled)
    || (view === "dealing" && dealStage === "settling-chips");
  return `
    <header class="topbar">
      <button class="brand back-navigation ${view === "map" ? "brand-map-hidden" : ""}" data-action="${backAction}" aria-label="${backLabel}" ${backDisabled ? "disabled" : ""}><i aria-hidden="true">←</i><span>${backLabel}</span></button>
      <div class="world-clock ${worldTimePaused() ? "paused" : ""} ${game.isSleepDeprived() ? "sleep-deprived" : ""}"><span>世界时间</span><strong data-world-clock>${worldTimeLabel()}</strong><em class="sleep-status" data-sleep-status ${game.isSleepDeprived() ? "" : "hidden"}>睡眠不足</em></div>
      <button type="button" class="confidence" data-action="toggle-confidence-details" aria-expanded="${confidenceDetailsOpen}" aria-controls="confidence-details" title="查看信心来源"><span>信心</span><strong>${Math.round(game.confidence * 100)}%</strong></button>
      <div class="wallet"><span>可用现金</span><strong>${money(game.cash)}</strong></div>
      <div class="wallet chip-wallet"><span>可用筹码</span><strong>${game.availableChips} 枚</strong></div>
    </header>
    <main>${content}</main>
    ${restaurantClosingPromptOpen ? restaurantClosingPrompt() : ""}
    ${wakePromptOpen ? wakePrompt() : ""}
    ${restChoiceOpen ? restChoicePrompt() : ""}
    ${sleepDeprivationNoticeOpen ? sleepDeprivationNotice() : ""}
    ${sleepCollapsePromptOpen ? sleepCollapsePrompt() : ""}
    ${confidenceDetailsOpen ? confidenceDetailsMarkup() : ""}
  `;
}

function restaurantClosingPrompt(): string {
  return `<div class="schedule-modal restaurant-closing-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-closing-title">
    <section>
      <span>20:00 · 营业时间结束</span>
      <h2 id="restaurant-closing-title">外港小馆打烊了</h2>
      <p>今天的正常营业已经结束。现在收工回家，或继续营业到明天打烊。</p>
      <div><button class="primary" data-action="close-restaurant">收工回家</button><button class="secondary" data-action="continue-restaurant">继续营业</button></div>
    </section>
  </div>`;
}

function wakePrompt(): string {
  const sleepDeprived = game.isSleepDeprived();
  const restResult = wakeAfterForcedRest ? "身体已经恢复。" : sleepDeprived ? "你还是没有睡够。" : "这一觉睡足了。";
  return `<div class="schedule-modal wake-modal ${sleepDeprived ? "sleep-deprived" : ""}" role="dialog" aria-modal="true" aria-labelledby="wake-title">
    <section>
      <span>${wakeAfterForcedRest ? "强制休息结束" : sleepDeprived ? "休息结束 · 睡眠不足" : "休息结束"}</span>
      <h2 id="wake-title">${worldTimeLabel()}</h2>
      <p>本次休息了 ${lastSleepDurationLabel()}。${restResult}</p>
      <div><button class="primary" data-action="open-restaurant-after-rest">开店</button><button class="secondary" data-action="cancel-wake">留在家里</button></div>
    </section>
  </div>`;
}

function sleepCollapsePrompt(): string {
  return `<div class="schedule-modal sleep-collapse-modal" role="alertdialog" aria-modal="true" aria-labelledby="sleep-collapse-title">
    <section>
      <span>08:00 · 睡眠不足</span>
      <h2 id="sleep-collapse-title">眼前突然一黑</h2>
      <p>新的一天开始时你仍未休息，长期缺觉让你失去了意识。确认后将立即回家，一直睡到自然醒。</p>
      <div><button class="primary" data-action="confirm-sleep-collapse">回家休息</button></div>
    </section>
  </div>`;
}

function sleepDeprivationNotice(): string {
  return `<div class="schedule-modal sleep-deprivation-modal" role="alertdialog" aria-modal="true" aria-labelledby="sleep-deprivation-title">
    <section>
      <span>00:00 · 夜深了</span>
      <h2 id="sleep-deprivation-title">你已经太久没睡够了</h2>
      <p>身体已经接近极限。若今天 08:00 仍未休息，你会因体力不支而晕倒。</p>
      <div><button class="primary" data-action="confirm-sleep-deprivation">确认</button></div>
    </section>
  </div>`;
}

function restChoicePrompt(): string {
  const naturalWakeAllowed = game.canRestUntilNaturalWake();
  const debt = game.sleepDebtWorldMinutes;
  const sleepiness = debt < 60 ? "不太困" : debt < 4 * 60 ? "有点困" : debt < 8 * 60 ? "很困" : debt < 10 * 60 ? "困得厉害" : "快撑不住了";
  return `<div class="schedule-modal rest-choice-modal" data-rest-choice-backdrop role="dialog" aria-modal="true" aria-label="休息方式">
    <section>
      <p class="rest-sleepiness">现在：${sleepiness}</p>
      <div><button class="primary" data-action="rest-natural" ${naturalWakeAllowed ? "" : "disabled"}>睡到自然醒</button><button class="secondary" data-action="rest-next-opening">睡到明早 08:00</button></div>
    </section>
  </div>`;
}

function roadMarkOverlay(table: GameTable, roadBook: RoadBook, visibleFrom: number, columns: number): string {
  const mark = game.roadMark(table.id, roadBook);
  if (!mark || mark.startColumn >= visibleFrom + columns) return "";
  const start = Math.max(0, mark.startColumn - visibleFrom);
  return `<span class="road-mark-range" style="--mark-start:${start}"></span>`;
}

function road(table: GameTable, compact = false, interactive = false, columnOverride?: number): string {
  const cells = makeBigRoad(table.history);
  const previews = roadPreviewCells(table, "big");
  const ghosts = roadCreatedCells(table, "big");
  const maxColumn = Math.max(...cells.map((cell) => cell.column), ...previews.map((cell) => cell.column), ...ghosts.map((cell) => cell.column), 0);
  const columns = columnOverride ?? (compact ? 12 : 28);
  const visibleFrom = Math.max(0, maxColumn - columns + 1);
  return `<div class="road ${compact ? "compact" : ""} ${interactive ? "creatable-road" : ""}" style="--columns:${columns}" aria-label="${table.name} 大路" data-road-window data-visible-from="${visibleFrom}" data-columns="${columns}">${roadMarkOverlay(table, "big", visibleFrom, columns)}${cells
    .filter((cell) => cell.column >= visibleFrom)
    .map((cell) => `<span class="road-dot ${cell.outcome} ${cell.ties ? "has-tie" : ""}" style="--row:${cell.row};--col:${cell.column - visibleFrom}">${cell.ties ? `<i>${cell.ties > 1 ? cell.ties : ""}</i>` : ""}</span>`)
    .join("")}${ghosts.filter((cell) => cell.column >= visibleFrom).map((cell) => `<span class="road-dot created-road-ghost ${cell.side}" style="--row:${cell.row};--col:${cell.column - visibleFrom}"></span>`).join("")}${interactive ? roadCreationTargets(table, "big", visibleFrom) : ""}</div>`;
}

function roadStats(table: GameTable): string {
  const banker = table.history.filter((round) => round.outcome === "banker").length;
  const player = table.history.filter((round) => round.outcome === "player").length;
  const tie = table.history.filter((round) => round.outcome === "tie").length;
  const bankerPair = table.history.filter((round) => round.bankerCards[0]?.rank === round.bankerCards[1]?.rank).length;
  const playerPair = table.history.filter((round) => round.playerCards[0]?.rank === round.playerCards[1]?.rank).length;
  return `<div class="road-stats"><div class="banker-stat"><span>庄</span><b>${banker}</b></div><div class="player-stat"><span>闲</span><b>${player}</b></div><div class="tie-stat"><span>和</span><b>${tie}</b></div><div class="pair-stat banker-stat"><span>庄对</span><b>${bankerPair}</b></div><div class="pair-stat player-stat"><span>闲对</span><b>${playerPair}</b></div><div class="round-stat"><span>局</span><b>${table.history.length}</b></div></div>`;
}

function beadRoadPanel(table: GameTable, interactive = false, columns = 9): string {
  return `<section class="bead-road-panel"><div class="road-panel-heading ${interactive ? "road-mark-title" : ""}" ${interactive ? `data-road-mark-title="bead" title="点击标题栏标记整张珠盘路"` : ""}><i class="bead-symbol banker"></i>珠盘路</div>${beadPlate(table, interactive, columns)}</section>`;
}

function roadSheet(table: GameTable, compact = false, interactive = false, layout: "full" | "expanded" = "full"): string {
  const bead = beadRoadPanel(table, interactive);
  const bigRoadPanel = (columns?: number) => `<section class="big-road-panel"><div class="road-panel-heading ${interactive ? "road-mark-title" : ""}" ${interactive ? `data-road-mark-title="big" title="点击标题栏对应列标记路数"` : ""}><i class="big-road-symbol banker"></i>大路</div>${road(table, compact, interactive, columns)}</section>`;
  const desktopBig = bigRoadPanel(layout === "expanded" ? 30 : undefined);
  const mobileBig = bigRoadPanel(layout === "expanded" ? 18 : undefined);
  const info = `<aside class="road-info-panel"><div class="road-stats-title">牌局结果</div>${roadStats(table)}</aside>`;
  const expandedClass = layout === "expanded" ? "expanded" : "";
  const desktopBead = layout === "expanded" ? beadRoadPanel(table, interactive, 10) : bead;
  const mobileBead = layout === "expanded" ? beadRoadPanel(table, interactive, 18) : bead;
  const desktopRoadContent = layout === "expanded"
    ? `${info}${desktopBead}${desktopBig}`
    : `${desktopBead}${desktopBig}${info}`;
  const mobileRoadContent = layout === "expanded"
    ? `${info}${mobileBead}${mobileBig}`
    : `${mobileBead}${mobileBig}${info}`;
  return `<div class="road-sheet road-sheet-desktop ${compact ? "compact" : ""} ${expandedClass}"><div class="road-board">${desktopRoadContent}</div></div><div class="road-sheet road-sheet-mobile ${compact ? "compact" : ""} ${expandedClass}"><div class="mobile-road-stack">${mobileRoadContent}</div></div>`;
}

function beadPlate(table: GameTable, interactive = false, columns = 9): string {
  const cells = makeBeadPlate(table.history, table.historyOffset);
  const previews = roadPreviewCells(table, "bead");
  const ghosts = roadCreatedCells(table, "bead");
  const maxColumn = Math.max(...cells.map((cell) => cell.column), ...previews.map((cell) => cell.column), ...ghosts.map((cell) => cell.column), 0);
  const visibleFrom = Math.max(0, maxColumn - columns + 1);
  return `<div class="bead-plate ${interactive ? "creatable-road" : ""}" style="--columns:${columns}" aria-label="${table.name} 珠盘路" data-road-window data-visible-from="${visibleFrom}" data-columns="${columns}">${roadMarkOverlay(table, "bead", visibleFrom, columns)}${cells.filter((cell) => cell.column >= visibleFrom).map((cell) => `<span class="bead ${cell.outcome}" style="--row:${cell.row};--col:${cell.column - visibleFrom}">${outcomeName(cell.outcome)}</span>`).join("")}${ghosts.filter((cell) => cell.column >= visibleFrom).map((cell) => `<span class="bead created-road-ghost ${cell.side}" style="--row:${cell.row};--col:${cell.column - visibleFrom}">${outcomeName(cell.side)}</span>`).join("")}${interactive ? roadCreationTargets(table, "bead", visibleFrom) : ""}</div>`;
}

function mapView(): string {
  const restaurant = game.restaurantInfo();
  const daylight = worldIsDaylight();
  const activityName = ({ restaurant: "外港小馆", casino: "赌场", home: "自宅" } as const)[activeActivity];
  const locationClass = (activity: Activity) => activeActivity === activity ? "is-current" : "";
  const locationStatus = (activity: Activity, defaultLabel: string) => activeActivity === activity ? "<i class=\"map-current-tag\">当前所在</i>" : `<i>${defaultLabel}</i>`;
  return shell(`
    <section class="map-page">
      <div class="map-world ${daylight ? "daylight" : "night"}" data-map-world>
        <img class="map-art map-art-daylight" src="${mapDaylightAsset}" alt="" aria-hidden="true">
        <img class="map-art map-art-night" src="${mapAsset}" alt="" aria-hidden="true">
        <div class="map-atmosphere" aria-hidden="true"></div>
        <div class="map-title"><span>城市总览</span><strong>选择目的地</strong><small data-world-time-summary>${worldTimeLabel()}</small><em><b></b>当前位于 · ${activityName}</em></div>
        <button class="map-location map-location-casino ${locationClass("casino")}" data-action="casinos" aria-label="${activeActivity === "casino" ? "返回赌场" : "进入赌场"}">
          <span class="map-location-pulse" aria-hidden="true"></span><span class="map-location-icon">♠</span><strong>赌场</strong><small>海湾娱乐城 · 金殿贵宾厅</small>${locationStatus("casino", "进入")}
        </button>
        <button class="map-location map-location-restaurant ${locationClass("restaurant")}" data-action="restaurant" aria-label="${activeActivity === "restaurant" ? "返回餐厅" : "进入餐厅"}">
          <span class="map-location-pulse" aria-hidden="true"></span><span class="map-location-icon">店</span><strong>外港小馆</strong><small>${game.restaurant.pawned ? "已典当 · 停止营业" : `${game.restaurant.open ? "营业中" : "已打烊"} · ${game.restaurant.level} 级 · ${Math.round(restaurant.chipChance * 100)}% 概率得 ${restaurant.chipsOnSuccess} 枚筹码`}</small>${locationStatus("restaurant", game.restaurant.open ? "经营" : "打烊")}
        </button>
        <button class="map-location map-location-home ${locationClass("home")}" data-action="skills" aria-label="${activeActivity === "home" ? "返回自宅" : "进入自宅"}">
          <span class="map-location-pulse" aria-hidden="true"></span><span class="map-location-icon">宅</span><strong>自宅</strong><small>技能管理 · 赌术构筑</small>${locationStatus("home", "进入")}
        </button>
        <div class="map-footer"><span>地图上的选择才会切换当前活动</span><b>餐厅营业时间 08:00 - 20:00</b></div>
      </div>
      ${roadCreationResolutionView()}
    </section>
  `);
}

function skillsView(): string {
  const equipped = skillDefinitions.find((skill) => skill.id === game.equippedSkill);
  const dailyCheatSummary = game.availableCheatSkills.map((id) => {
    const definition = cheatSkillDefinitions.find((item) => item.id === id)!;
    return `<article class="skill-card equipped"><header><div><span>今日可用千术</span><h2>${definition.name}</h2></div><strong>临时</strong></header><p>${definition.description}</p><dl><div><dt>使用时机</dt><dd>${definition.timing === "covered" ? "盖牌阶段" : "明牌阶段"}</dd></div><div><dt>消耗</dt><dd>1 枚筹码</dd></div></dl></article>`;
  }).join("");
  const daylight = worldIsDaylight();
  const skillManagement = homeSkillManagementOpen ? `<div class="home-skill-overlay" role="dialog" aria-modal="true" aria-labelledby="home-skill-title">
    <section class="residence-skill-workspace">
      <header class="home-skill-header"><div><span>书桌 · 今日千术</span><h2 id="home-skill-title">临时千术</h2><small>每天开始时重新抽取，今日结束后清除</small></div><button class="home-skill-close" data-action="close-skill-management" aria-label="关闭技能管理">×</button></header>
      <section class="skill-grid daily-cheat-grid">${dailyCheatSummary}</section>
      <section class="equipped-skill-slot ${equipped ? "filled" : "empty"}">
        <div><span>唯一技能栏位 · 1 SLOT</span><h2>${equipped ? equipped.name : "尚未装备技能"}</h2><p>${equipped ? `${equipped.description} 当前 Lv.${game.skills[equipped.id]}，等级保留但不参与本轮信心公式。` : "未装备技能也可以通过标记路书获得信心。"}</p></div>
        ${equipped ? `<button class="secondary" data-action="unequip-skill">卸下技能</button>` : ""}
      </section>
      <div class="skill-grid legacy-skill-grid">${skillDefinitions.map((skill) => {
    const level = game.skills[skill.id];
    const equippedNow = game.equippedSkill === skill.id;
    const upgradeCost = game.skillUpgradeCost(skill.id);
    return `<article class="skill-card ${equippedNow ? "equipped" : ""}">
      <header><div><span>${skill.roadName}专精</span><h2>${skill.name}</h2></div><strong>Lv.${level}</strong></header>
      <p>${skill.description}</p>
      <dl><div><dt>当前作用</dt><dd>不直接修改信心</dd></div><div><dt>神助效果</dt><dd>不受技能等级影响</dd></div><div><dt>下一级</dt><dd>${level >= MAX_SKILL_LEVEL ? "已满级" : "保留成长"}</dd></div></dl>
      <footer><button class="secondary" data-action="equip-skill" data-skill="${skill.id}" ${equippedNow ? "disabled" : ""}>${equippedNow ? "已装备" : "装配"}</button><button class="primary" data-action="upgrade-skill" data-skill="${skill.id}" ${upgradeCost === null || game.cash < upgradeCost ? "disabled" : ""}>${upgradeCost === null ? "已达最高等级" : `升级 · ${money(upgradeCost)}`}</button></footer>
    </article>`;
  }).join("")}</div>
    </section>
  </div>` : "";
  return shell(`
    <section class="residence-scene-page">
      <div class="residence-scene ${daylight ? "daylight" : "night"}">
        <img class="residence-scene-art residence-scene-art-daylight" src="${homeAsset}" alt="" aria-hidden="true">
        <img class="residence-scene-art residence-scene-art-night" src="${homeNightAsset}" alt="" aria-hidden="true">
        <div class="residence-scene-shade" aria-hidden="true"></div>
        <div class="residence-scene-header"><p class="eyebrow">自宅 · 我的房间</p><h1>今晚留在家里</h1><small>选择房间里的家具进行行动</small></div>
        <button class="home-scene-hotspot home-hotspot-bed available" data-action="open-rest-options"><i aria-hidden="true"></i><span><b>休息</b><small>选择休息方式</small></span></button>
        <button class="home-scene-hotspot home-hotspot-desk" data-action="open-skill-management"><i aria-hidden="true"></i><span><b>技能管理</b><small>装配与升级赌术</small></span></button>
        ${skillManagement}
      </div>
    </section>
  `);
}

function restaurantView(): string {
  const info = game.restaurantInfo();
  const max = info.nextCost === null;
  const cycleWorldMinutes = game.debugGameplayConfig.restaurantCycleWorldMinutes;
  const progress = game.restaurant.cycleElapsedWorldMinutes / cycleWorldMinutes;
  const worldMinutesRemaining = Math.ceil(cycleWorldMinutes - game.restaurant.cycleElapsedWorldMinutes);
  const cycleLabel = cycleWorldMinutes === 60 ? "游戏小时" : `${cycleWorldMinutes} 游戏分钟`;
  return shell(`
    <section class="restaurant-scene-page">
      <div class="restaurant-scene">
        <img class="restaurant-scene-art" src="${restaurantAsset}" alt="外港小馆内部场景">
        <div class="restaurant-scene-shade" aria-hidden="true"></div>
        <div class="restaurant-scene-header"><div><p class="eyebrow">筹码产出 · 外港小馆</p><h1>${game.restaurant.pawned ? "已典当" : game.restaurant.open ? `${game.restaurant.level} 级经营中` : "今日已打烊"}</h1></div></div>
        <section class="restaurant-control-panel ${game.restaurant.pawned ? "is-pawned" : ""} ${game.restaurant.open ? "is-open" : "is-closed"}">
          <header><div><span>餐厅经营 · 08:00 - 20:00</span><h2>${game.restaurant.pawned ? "停止营业" : game.restaurant.open ? "营业中" : "已打烊"}</h2></div><strong>${game.restaurant.pawned || !game.restaurant.open ? "—" : `${Math.round(info.chipChance * 100)}%`}<small>${game.restaurant.pawned ? "无收益" : game.restaurant.open ? `概率获得 ${info.chipsOnSuccess} 枚筹码 / ${cycleLabel}` : "等待继续营业"}</small></strong></header>
          <div class="restaurant-scene-stats"><div><span>当前等级</span><b>Lv.${game.restaurant.level}</b></div><div><span>周期产出</span><b>${game.restaurant.pawned || !game.restaurant.open ? "停止" : `${Math.round(info.chipChance * 100)}% · ${info.chipsOnSuccess} 枚筹码`}</b></div><div><span>抵押额度</span><b>${game.restaurant.pawned ? "已用尽" : money(info.pawnCapacityCash)}</b></div></div>
          <div class="restaurant-progress ${game.restaurant.open ? "" : "is-stopped"}" data-restaurant-progress><div><span>下一次结算</span><em>${game.restaurant.pawned ? "已停止" : game.restaurant.open ? `${worldMinutesRemaining} 游戏分钟后` : "餐厅已打烊"}</em></div><i><b style="width:${game.restaurant.open ? progress * 100 : 0}%"></b></i></div>
          <div class="restaurant-actions">${!game.restaurant.open && !game.restaurant.pawned ? `<button class="primary" data-action="continue-restaurant">继续营业 · 至下次打烊</button>` : ""}<button class="primary" data-action="upgrade" ${game.restaurant.pawned || max || game.cash < (info.nextCost ?? 0) ? "disabled" : ""}>${max ? "已达最高等级" : `升级 · ${money(info.nextCost!)}`}</button><button class="danger" data-action="pawn" ${game.restaurant.pawned || info.pawnCapacityCash < 100 ? "disabled" : ""}>抵押 · 获得 ${info.pawnLotChips} 枚筹码</button>${info.pawnDebtCash > 0 ? `<button class="secondary" data-action="redeem-pawn" ${game.cash < Math.ceil(info.pawnDebtCash * 2.5) ? "disabled" : ""}>赎回 · ${money(Math.ceil(info.pawnDebtCash * 2.5))}</button>` : ""}</div>
        </section>
      </div>
    </section>
  `);
}

function casinoSelectView(): string {
  return shell(`
    <section class="casino-scene-page">
      <div class="casino-scene">
        <img class="casino-scene-art" src="${casinoAsset}" alt="赌场大厅场景">
        <div class="casino-scene-shade" aria-hidden="true"></div>
        <div class="casino-scene-header"><div><p class="eyebrow">今晚去哪一场</p><h1>选择赌场</h1><small>选择等级，支付门票进入牌桌大厅</small></div></div>
        ${casinos.map((casino, index) => { const feeChips = Math.ceil(casino.entryFee / 100); const canEnter = game.availableChips >= feeChips; return `<button class="casino-scene-choice ${casino.tone} casino-scene-choice-${index + 1}" data-casino="${casino.id}" ${canEnter ? "" : "disabled"}><span class="casino-scene-number">0${index + 1}</span><div><span>${casino.subtitle}</span><strong>${casino.name}</strong></div><dl><div><dt>门票</dt><dd>${feeChips} 枚筹码</dd></div><div><dt>牌桌</dt><dd>${casino.tableCount} 张</dd></div><div><dt>注码</dt><dd>${chips(casino.minBet)} - ${chips(casino.maxBet)}</dd></div></dl><b>${canEnter ? "支付筹码进入" : `筹码不足 · 需要 ${feeChips} 枚`}</b></button>`; }).join("")}
        <div class="casino-scene-footer">门票在进入赌场时支付 · 赌场内时间流速为每秒一分钟</div>
      </div>
    </section>
  `);
}

function lobbyView(): string {
  const casino = casinos.find((item) => item.id === casinoId)!;
  const tables = [...game.tables.values()].filter((table) => table.id.startsWith(casino.id));
  return shell(`
    <section class="page lobby-page ${casino.tone}">
      <div class="lobby-heading"><div><p class="eyebrow">${casino.subtitle}</p><h1>${casino.name}</h1></div></div>
      <div class="tables-grid">${tables.map((table) => `<button class="table-card" data-table="${table.id}">${lobbyTableContent(table, casino)}</button>`).join("")}</div>
    </section>
  `);
}

function lobbyTableContent(table: GameTable, casino: Casino): string {
  const pattern = game.previewProbability(table.id).pattern;
  return `
    <div class="table-top"><strong>${table.name}</strong><span class="live" data-table-clock="${table.id}"><i></i>${Math.ceil((LOBBY_ROUND_MS - table.realtimeElapsedMs) / 1000)}s 开牌</span></div>
    ${dealerProfileMarkup(table)}
    ${roadSheet(table, false, false, "expanded")}
    <div class="table-meta"><span class="pattern ${pattern.id !== "none" ? "active" : ""}">${pattern.name}</span><span>${chips(casino.minBet)} - ${chips(casino.maxBet)}</span><span>连战最多 ${casino.maxChainRounds} 局</span></div>
  `;
}

function dealerProfileMarkup(table: GameTable, compact = false): string {
  const rewardSkill = table.dealerRewardSkillId ? cheatSkillDefinitions.find((definition) => definition.id === table.dealerRewardSkillId)?.name : "临时千术";
  const reward = table.dealerRewardClaimed ? "已兑付" : table.dealerRewardKind === "chips" ? `${table.dealerRewardChips} 枚筹码` : rewardSkill ?? "临时千术";
  return `<div class="dealer-profile ${compact ? "compact" : ""}"><span class="dealer-avatar" aria-hidden="true">荷</span><div><small>荷官</small><strong>${table.dealerName}</strong></div><div><small>持有现金</small><strong>${money(table.dealerCash)}</strong></div><div><small>抵押物</small><strong>${reward}</strong></div></div>`;
}

function inlinePokerFace(card: Card): string {
  return `<img class="poker-face-art" src="${cardFaceAsset(card.rank)}" alt="${cardLabel(card)}">`;
}

function inlineWatchState(pending: PendingRound) {
  const completed = inlineWatchSteps(pending.result).slice(0, inlineWatchStep);
  const dealt = new Set(completed.filter((step) => step.kind === "deal").map((step) => step.cardIndex));
  const revealed = new Set(completed.filter((step) => step.kind === "reveal").map((step) => step.cardIndex));
  return { dealt, revealed, current: completed.at(-1) ?? null };
}

function inlineWatchHand(pending: PendingRound, side: Side): string {
  const sequence = dealSequence(pending);
  const state = inlineWatchState(pending);
  const cards = sequence.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.side === side);
  return `<div class="inline-watch-hand ${side}"><span>${side === "player" ? "PLAYER" : "BANKER"}</span><div class="inline-watch-cards">${cards.map(({ entry, index }) => {
    if (!state.dealt.has(index)) return entry.handIndex < 2 ? `<i class="watch-card-slot"></i>` : "";
    const currentDeal = state.current?.kind === "deal" && state.current.cardIndex === index;
    const currentReveal = state.current?.kind === "reveal" && state.current.cardIndex === index;
    return `<i class="watch-card ${state.revealed.has(index) ? "revealed" : ""} ${currentDeal ? "dealing" : ""} ${currentReveal ? "flipping" : ""}" style="--hand-index:${entry.handIndex}"><span class="watch-card-inner"><span class="card-back-mini"></span><span class="card-face-mini">${inlinePokerFace(entry.card)}</span></span></i>`;
  }).join("")}</div></div>`;
}

function inlineWatchStatus(pending: PendingRound): string {
  if (inlineWatchSettled) return pending.result.outcome === "tie" ? "和局" : `${outcomeName(pending.result.outcome)}家胜`;
  const next = inlineWatchSteps(pending.result)[inlineWatchStep];
  if (!next) return "核对牌面";
  const entry = dealSequence(pending)[next.cardIndex]!;
  return next.kind === "deal" ? `发${outcomeName(entry.side)}家第 ${entry.handIndex + 1} 张` : `翻开${outcomeName(entry.side)}家第 ${entry.handIndex + 1} 张`;
}

function chipCountSliderMarkup(
  className: string,
  label: string,
  min: number,
  max: number,
  value: number,
  ariaLabel: string,
  disabled = false,
): string {
  const fixed = max <= min;
  const control = fixed
    ? `<div class="chip-slider-fixed" role="status"><span>当前可用</span><strong>${min} 枚</strong></div>`
    : `<input type="range" min="${min}" max="${max}" step="1" value="${value}" data-chip-count aria-label="${ariaLabel}" ${disabled ? "disabled" : ""}>`;
  return `<div class="${className}"><label><span>${label}</span><strong data-chip-count-value>${value} 枚</strong></label>${control}<div><small>${min} 枚</small><small>${max} 枚</small></div></div>`;
}

function tableView(): string {
  const casino = casinos.find((item) => item.id === casinoId)!;
  const table = game.table(tableId);
  const watchPending = inlineWatchActive ? game.pending ?? lastRound : null;
  const watchResult = inlineWatchSettled ? watchPending?.result ?? null : null;
  const stagedAmount = game.reservedBetAmount;
  const minChipCount = Math.ceil(casino.minBet / 100);
  const maxChipCount = Math.min(Math.floor(casino.maxBet / 100), game.availableChips);
  const sliderMax = Math.max(minChipCount, maxChipCount);
  selectedChipCount = Math.max(minChipCount, Math.min(sliderMax, selectedChipCount));
  const draftAmount = selectedChipCount * 100;
  const entryRoad = `<aside class="road-panel table-entry-road"><div class="panel-title"><h2>牌路</h2></div>${roadSheet(table, false, false, "expanded")}</aside>`;
  if (!inlineWatchActive && tableEntryStep === "choice") {
    const betUnavailable = game.availableChips < minChipCount;
    return shell(`
      <section class="table-page table-entry-page">
        <div class="table-header table-header-status"><span class="round-count">第 ${table.round + 1} 局 · 连战最多 ${casino.maxChainRounds} 局</span></div>
        <div class="table-entry-layout">${entryRoad}<section class="table-entry-actions"><span>先看牌路，再决定如何进入本局</span><div><button class="secondary table-entry-button" data-action="watch"><strong>观战</strong><small>观看本局发牌与开牌</small></button><button class="primary table-entry-button ${betUnavailable ? "bet-unavailable" : ""}" data-action="start-bet"><strong>下注</strong><small>${betUnavailable ? `筹码不足 · 需要 ${minChipCount} 枚` : "选择筹码并设置连战"}</small></button></div></section></div>
      </section>
    `);
  }
  if (!inlineWatchActive && tableEntryStep === "chips") {
    const minChipCount = Math.ceil(casino.minBet / 100);
    const maxChipCount = Math.max(minChipCount, Math.min(Math.floor(casino.maxBet / 100), game.availableChips));
    selectedChipCount = Math.max(minChipCount, Math.min(maxChipCount, selectedChipCount));
    return shell(`
      <section class="table-page table-entry-page">
        <div class="table-header table-header-status"><span class="round-count">下注准备 · 最多连战 ${casino.maxChainRounds} 局</span></div>
        <div class="table-entry-layout">${entryRoad}<section class="table-entry-step"><header><span>第 1 步 / 2</span><h2>确定本场筹码</h2><p>所有连战局使用相同的筹码数量。</p></header>${chipCountSliderMarkup("entry-chip-slider", "本场下注筹码", minChipCount, maxChipCount, selectedChipCount, "选择本场下注筹码")}<div class="entry-step-actions"><button class="secondary" data-action="cancel-entry">取消</button><button class="primary" data-action="open-targets">下一步</button></div></section></div>
      </section>
    `);
  }
  if (!inlineWatchActive && tableEntryStep === "targets") {
    const maxRounds = casino.maxChainRounds;
    const selectedCount = chainTargetSelected.filter(Boolean).length;
    const targetCell = (side: Side, index: number) => {
      const selected = chainTargetSelected[index] && chainTargets[index] === side;
      const enabled = index <= selectedCount;
      return `<button class="entry-bet-cell ${side} ${selected ? "selected" : ""}" data-bet-zone="${side}" data-bet-zone-index="${index}" aria-label="第 ${index + 1} 局${selected ? `已押${outcomeName(side)}` : `选择${outcomeName(side)}`}" ${enabled ? "" : "disabled"}><span>${selected ? "押" : ""}</span></button>`;
    };
    const targetTable = `<div class="entry-target-table" style="--target-count:${maxRounds}"><div class="entry-target-corner">下注目标</div>${Array.from({ length: maxRounds }, (_, index) => `<div class="entry-target-heading">第 ${index + 1} 局</div>`).join("")}<div class="entry-target-row-label banker">庄</div>${Array.from({ length: maxRounds }, (_, index) => targetCell("banker", index)).join("")}<div class="entry-target-row-label player">闲</div>${Array.from({ length: maxRounds }, (_, index) => targetCell("player", index)).join("")}</div>`;
    const selectedChainTargets = chainTargets.filter((target, index): target is Side => chainTargetSelected[index] && (target === "banker" || target === "player"));
    const canConfirm = selectedChainTargets.length > 0 && game.availableChips >= selectedChipCount;
    const payoutMultiplier = selectedChainTargets.length > 1 ? `2^${selectedChainTargets.length}` : "2";
    const payoutAmount = selectedChipCount * 100 * (selectedChainTargets.length > 1 ? 2 ** selectedChainTargets.length : 2);
    const payoutFormula = selectedChainTargets.length
      ? `<strong data-bet-payout data-round-count="${selectedChainTargets.length}">${money(selectedChipCount * 100)} × ${payoutMultiplier} = ${money(payoutAmount)}</strong>`
      : `<span class="entry-payout-empty">选择下注目标后显示</span>`;
    return shell(`
      <section class="table-page table-entry-page">
        <div class="table-header table-header-status"><span class="round-count">下注设置 · ${selectedCount}/${maxRounds} 局</span></div>
        <div class="table-entry-layout">${entryRoad}<section class="table-entry-step table-target-step"><header><span>第 2 步 / 2</span><h2>选择每局下注目标</h2><p>可调整本场筹码数量；每局使用相同筹码，重复点击可撤回。</p></header>${chipCountSliderMarkup("entry-chip-slider", "本场下注筹码", minChipCount, sliderMax, selectedChipCount, "调整本场下注筹码")}<div class="entry-target-controls"><div class="entry-payout-summary"><span>预计回报</span>${payoutFormula}</div></div>${targetTable}<div class="entry-step-actions"><button class="secondary" data-action="cancel-entry">取消</button><button class="primary" data-action="confirm-bet" data-bet-confirm ${canConfirm ? "" : "disabled"}>确定下注</button></div></section></div>
      </section>
    `);
  }
  const confidenceMessage = !stagedBetSide
    ? "路数预判待定 · 信心待封盘结算"
    : `已押${outcomeName(stagedBetSide)} · 确认下注后才揭示信心变化`;
  const zone = (side: Outcome, english: string, odds: string, legIndex = 0) => {
    const active = chainRounds > 1 ? chainTargetSelected[legIndex] && chainTargets[legIndex] === side : stagedBetSide === side;
    return `<button class="table-bet-zone ${side} ${active ? "has-wager" : ""}" data-bet-zone="${side}" data-bet-zone-index="${legIndex}" aria-label="第 ${legIndex + 1} 局选择${outcomeName(side)}" ${inlineWatchActive ? "disabled" : ""}>
      <span><b>${outcomeName(side)}</b><em>${english}</em><i>${side === "banker" ? "1:1" : odds}</i></span>
      ${active ? `<span class="zone-wager"><i></i><i></i><i></i><strong>${selectedChipCount} 枚</strong></span>` : ""}
    </button>`;
  };
  const chainBetRows = chainRounds > 1
    ? `<div class="chain-bet-rows">${chainTargets.map((_, index) => `<div class="chain-bet-row"><strong>第 ${index + 1} 局</strong><div class="bet-zones">${zone("player", "PLAYER", "1:1", index)}${zone("tie", "TIE", "1:8", index)}${zone("banker", "BANKER", "1:1", index)}</div></div>`).join("")}</div>`
    : "";
  const selectedChainTargets = chainTargets.filter((_, index) => chainTargetSelected[index]);
  const hasBetTarget = selectedChainTargets.length > 0;
  const canConfirm = draftAmount >= casino.minBet && draftAmount <= casino.maxBet && game.availableChips >= selectedChipCount && hasBetTarget;
  return shell(`
    <section class="table-page">
      <div class="table-header table-header-status"><span class="round-count">第 ${inlineWatchSettled ? table.round : table.round + 1} 局 · 连战最多 ${casino.maxChainRounds} 局</span></div>
      ${dealerProfileMarkup(table, true)}
      <div class="table-layout">
        <section class="betting-panel ${inlineWatchActive ? "inline-watching" : ""}">
          <div class="table-felt ${inlineWatchActive ? "watch-active" : ""} ${chainRounds > 1 ? "chain-betting" : ""}">
            <div class="table-session-meta"><span>${inlineWatchActive ? `旁观牌局 · ${inlineWatchStatus(watchPending!)}` : `限注 ${chips(casino.minBet)} - ${chips(casino.maxBet)}`}</span></div>
            <div class="dealer-apron ${inlineWatchActive ? "inline-watch-apron" : ""}">${inlineWatchActive ? `${inlineWatchHand(watchPending!, "player")}<strong>${inlineWatchStatus(watchPending!)}</strong>${inlineWatchHand(watchPending!, "banker")}` : `<div class="table-hand-placement player"><span>PLAYER</span><i></i><i></i></div><span class="dealer-apron-gap" aria-hidden="true"></span><div class="table-hand-placement banker"><span>BANKER</span><i></i><i></i></div>`}</div>
            ${chainRounds > 1 ? chainBetRows : `<div class="bet-zones">${zone("player", "PLAYER", "1:1")}${zone("tie", "TIE", "1:8")}${zone("banker", "BANKER", "1:1")}</div>`}
            ${watchResult ? `<div class="inline-watch-result ${watchResult.outcome}" data-action="dismiss-settlement" role="button" tabindex="0" aria-label="关闭旁观结算"><i>${watchResult.outcome === "tie" ? "和" : outcomeName(watchResult.outcome)}</i><span>旁观结算</span><h2>${watchResult.outcome === "tie" ? "本局和局" : `${outcomeName(watchResult.outcome)}家胜`}</h2><p>庄 ${watchResult.bankerPoints} 点 · 闲 ${watchResult.playerPoints} 点</p><small>点击任意位置返回牌桌</small></div>` : ""}
          </div>
          <div class="bet-controls">
            <div class="chip-console">
              ${inlineWatchActive ? "" : chipCountSliderMarkup("chip-tray chip-count-slider", "下注筹码", minChipCount, sliderMax, selectedChipCount, "选择下注筹码数量", stagedAmount > 0)}
              ${inlineWatchActive ? "" : (stagedBetSide || chainTargetSelected.some(Boolean)) ? `<div class="bet-command-bar">
                <button class="secondary" data-action="cancel-bet"><span>↶</span>取消</button>
                <button class="primary" data-action="confirm-bet" data-bet-confirm ${canConfirm ? "" : "disabled"}><span>✓</span>确认</button>
              </div>` : `<div class="bet-command-bar single-action"><button class="secondary chip-watch-action" data-action="watch">旁观本局</button></div>`}
            </div>
            <div class="confidence-readout"><span>当前信心 ${Math.round(game.confidence * 100)}%</span><strong>${confidenceMessage}</strong></div>
          </div>
        </section>
        <aside class="road-panel"><div class="panel-title"><h2>牌路</h2></div>${roadSheet(table, false, false, "expanded")}</aside>
      </div>
      ${roadCreationResolutionView()}
    </section>
  `);
}

function roadCreationResolutionView(): string {
  if (!roadCreationFailure || roadCreationFailure.matched) return "";
  return `<div class="road-creation-failure" data-action="dismiss-road-creation-failure" role="button" tabindex="0" aria-label="关闭创造路数失败提示"><section><span>创造路数 · 预测失败</span><strong>路，不是这样走的！</strong><div><b>预想 ${outcomeName(roadCreationFailure.predicted)}</b><i>实际 ${outcomeName(roadCreationFailure.actual)}</i></div><em>信心 −${Math.round(roadCreationFailure.confidencePenalty * 100)}%</em><p>所有创造路数虚影已强制撤销</p><small>点击任意位置继续</small></section></div>`;
}

interface DealtCard {
  card: Card;
  side: Side;
  handIndex: number;
}

function dealSequence(pending: PendingRound): DealtCard[] {
  const { playerCards, bankerCards } = pending.result;
  const sequence: DealtCard[] = [
    { card: playerCards[0]!, side: "player", handIndex: 0 },
    { card: bankerCards[0]!, side: "banker", handIndex: 0 },
    { card: playerCards[1]!, side: "player", handIndex: 1 },
    { card: bankerCards[1]!, side: "banker", handIndex: 1 },
  ];
  if (playerCards[2]) sequence.push({ card: playerCards[2], side: "player", handIndex: 2 });
  if (bankerCards[2]) sequence.push({ card: bankerCards[2], side: "banker", handIndex: 2 });
  return sequence;
}

function pendingChainLeg(index: number): PendingRound | null {
  const chain = game.pendingChain;
  const current = game.pending ?? lastRound;
  if (!chain || !current) return null;
  const leg = chain.legs[index];
  if (!leg) return null;
  if (index === chain.currentLegIndex) return current;
  return {
    ...current,
    result: leg.result,
    bet: { side: leg.target, amount: chain.stake },
    confidence: 0,
    confidencePrediction: null,
    betCurrency: "chip",
  };
}

function playerOwnedSide(pending: PendingRound): Side | null {
  return pending.bet && pending.bet.side !== "tie" ? pending.bet.side : null;
}

function automaticRevealOrder(pending: PendingRound): number[] {
  const sequence = dealSequence(pending);
  return sequence.slice(0, dealtCardCount).map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.side === b.entry.side ? a.entry.handIndex - b.entry.handIndex : a.entry.side === "player" ? -1 : 1))
    .map(({ index }) => index);
}

function revealedHandInfo(pending: PendingRound, side: Side): { points: number | null; count: number; values: (number | null)[] } {
  const values: (number | null)[] = [null, null, null];
  dealSequence(pending).slice(0, dealtCardCount).forEach((entry, index) => {
    if (entry.side === side && revealedCardIndices.has(index)) values[entry.handIndex] = cardValue(entry.card);
  });
  const known = values.filter((value): value is number => value !== null);
  return { points: known.length ? known.reduce((sum, value) => sum + value, 0) % 10 : null, count: known.length, values };
}

function liveBaccaratScore(pending: PendingRound): string {
  const banker = revealedHandInfo(pending, "banker");
  const player = revealedHandInfo(pending, "player");
  const comparable = banker.points !== null && player.points !== null;
  const leader: Side | null = !comparable || banker.points === player.points ? null : banker.points! > player.points! ? "banker" : "player";
  const relation = (side: Side, points: number | null) => {
    if (points === null) return { label: "待开", className: "waiting" };
    if (!comparable || leader === null) return { label: comparable ? "同点" : "已开", className: comparable ? "tied" : "open" };
    return leader === side ? { label: "领先", className: "leading" } : { label: "落后", className: "trailing" };
  };
  const bankerRelation = relation("banker", banker.points);
  const playerRelation = relation("player", player.points);
  const difference = comparable ? Math.abs(banker.points! - player.points!) : null;
  const summary = !comparable ? "等待双方牌面" : leader ? `${outcomeName(leader)}家领先 ${difference} 点` : "庄闲当前同点";
  const item = (side: Side, info: typeof banker, state: ReturnType<typeof relation>) => `
    <div class="live-score ${side} ${state.className} ${pending.bet?.side === side ? "owned" : ""}">
      <span>${outcomeName(side)}家${pending.bet?.side === side ? " · 你押" : ""}</span>
      <strong>${info.points ?? "—"}<small>点</small></strong>
      <em>${state.label}</em>
    </div>`;
  return `<div class="live-baccarat-score"><div class="live-score-summary"><span>实时牌势</span><strong>${summary}</strong></div>${item("banker", banker, bankerRelation)}${item("player", player, playerRelation)}</div>`;
}

function confidenceBreakdownView(pending: PendingRound): string {
  if (!pending.bet) return "";
  const breakdown = pending.confidenceBreakdown;
  const rows = [
    ["下注占比", breakdown.wagerBonus],
    [breakdown.markedPatterns.length ? `标记路数 · ${breakdown.markedPatterns.map((pattern) => pattern.name).join(" / ")}` : "标记路数", breakdown.markedPatternBonus],
    ["路数长度", breakdown.lengthBonus],
    [breakdown.opposingPatterns.length ? `逆势 · ${breakdown.opposingPatterns.map((pattern) => pattern.name).join(" / ")}` : "逆势", breakdown.opposingPatternPenalty],
    ["局连胜", breakdown.roundStreakBonus],
    ["天连胜", breakdown.dayStreakBonus],
  ] as const;
  const activeRows = rows.filter(([, value]) => Math.abs(value) > 1e-9);
  return `<div class="confidence-breakdown"><b>基础 ${Math.round(breakdown.base * 100)}%</b>${activeRows.length
    ? activeRows.map(([label, value]) => `<span class="${value > 0 ? "gain" : "loss"}">${label} ${value > 0 ? "+" : ""}${Math.round(value * 100)}%</span>`).join("")
    : `<span>无额外修正</span>`}</div>`;
}

function cheatSkillActionsMarkup(locked = false): string {
  const skillsHidden = armedCheatSkill ? "hidden" : "";
  const isCardReorder = armedCheatSkill === "swap-covered" || armedCheatSkill === "swap-face-up";
  const reorderHidden = isCardReorder ? "" : "hidden";
  const cheatCancelHidden = armedCheatSkill && !isCardReorder ? "" : "hidden";
  const setEdgeTypeHidden = armedCheatSkill === "set-edge" && setEdgeTarget ? "" : "hidden";
  const reorderName = armedCheatSkill === "swap-face-up" ? "调换明牌" : "重排盖牌";
  const setEdgeTypeChoices = DIVINE_CARD_TYPE_OPTIONS.map((choice) => `<button type="button" class="set-edge-type-option" data-set-edge-type="${choice.type}" ${locked ? "disabled" : ""} ${setEdgeTypeHidden}><b>${choice.label}</b><small>${choice.detail}</small></button>`).join("");
  return `${game.availableCheatSkills.map((id) => { const definition = cheatSkillDefinitions.find((item) => item.id === id); const blockReason = cheatSkillActivationBlockReason(id); const availabilityHint = blockReason ? ` · ${blockReason}` : ""; return `<button type="button" data-cheat-skill="${id}" ${locked ? "disabled" : ""} ${skillsHidden} title="${definition?.description ?? "选择后直接点击目标牌"} · 费用 ${CHEAT_SKILL_COST} 枚筹码${availabilityHint}">${definition?.name ?? id} · ${CHEAT_SKILL_COST} 枚筹码</button>`; }).join("")}${setEdgeTypeChoices}<button type="button" class="cheat-confirm-action ${reorderHidden}" data-covered-reorder-confirm>确认${reorderName}</button><button type="button" class="cheat-cancel-action ${reorderHidden}" data-covered-reorder-cancel>取消${reorderName}</button><button type="button" class="cheat-cancel-action ${cheatCancelHidden}" data-action="cancel-cheat" data-cheat-cancel>取消出千</button>`;
}

function bindCoveredReorderActions(root: ParentNode = app): void {
  root.querySelectorAll<HTMLElement>("[data-covered-reorder-confirm], [data-covered-reorder-cancel]").forEach((element) => {
    if (element.dataset.coveredReorderBound === "true") return;
    element.dataset.coveredReorderBound = "true";
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (element.hasAttribute("data-covered-reorder-confirm")) cardReorderSession?.confirm();
      else cardReorderSession?.cancel();
    });
  });
}

function bindCheatSkillActions(root: ParentNode = app): void {
  bindCoveredReorderActions(root);
  root.querySelectorAll<HTMLElement>("[data-cheat-cancel]").forEach((element) => {
    if (element.dataset.cheatCancelBound === "true") return;
    element.dataset.cheatCancelBound = "true";
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelCheatSelection();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-set-edge-type]").forEach((element) => {
    if (element.dataset.setEdgeBound === "true") return;
    element.dataset.setEdgeBound = "true";
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const type = element.dataset.setEdgeType as DivineCardType;
      if (DIVINE_CARD_TYPE_OPTIONS.some((option) => option.type === type)) applySetEdgeChoice(type);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-cheat-skill]").forEach((element) => {
    if (element.dataset.cheatBound === "true") return;
    element.dataset.cheatBound = "true";
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const skillId = element.dataset.cheatSkill as CheatSkillId;
      if (skillId === "peek-covered") usePeekCoveredImmediately();
      else if (skillId === "swap-covered" || skillId === "swap-face-up") openCardReorder(skillId);
      else openCheatTargetPicker(skillId);
    });
  });
}

function syncAvailableCheatSkillUi(): void {
  cardReorderSession?.cancel();
  armedCheatSkill = null;
  setEdgeTarget = null;
  document.body.classList.remove("cheat-target-armed");
  restoreCardRevealSelection();
  app.querySelectorAll<HTMLElement>(".cheat-controls").forEach((control) => {
    const locked = control.classList.contains("disabled");
    const label = control.querySelector<HTMLElement>("[data-cheat-armed-label]");
    if (label) label.textContent = "出千";
    const actions = control.querySelector<HTMLElement>(".cheat-skill-actions");
    if (actions) actions.innerHTML = cheatSkillActionsMarkup(locked);
  });
  bindCheatSkillActions();
}

function snapshotChainSettlement(chain: PendingChain): Omit<ChainSettlementView, "effectiveRounds" | "ties" | "won" | "payout"> {
  return {
    stake: chain.stake,
    plannedRounds: chain.plannedRounds,
    legs: chain.legs.map((leg) => ({
      index: leg.index,
      target: leg.target,
      result: leg.result,
      settled: leg.settled,
    })),
  };
}

function recordCompletedChain(snapshot: ReturnType<typeof snapshotChainSettlement>, settlement: SettlementResult): void {
  const ties = snapshot.legs.filter((leg) => leg.result.outcome === "tie").length;
  lastChainSettlement = {
    ...snapshot,
    ties,
    effectiveRounds: snapshot.plannedRounds - ties,
    won: settlement.delta > 0,
    payout: Math.max(0, settlement.delta),
  };
  chainLegUiStates.clear();
  activeChainLegIndex = null;
}

function applyDealerRewardNotice(settlement: SettlementResult): void {
  if (!settlement.dealerReward) return;
  const reward = settlement.dealerReward;
  game.notice = reward.kind === "chips"
    ? `荷官抵押奖励 · 获得 ${reward.amount} 枚筹码`
    : `荷官抵押奖励 · 获得${cheatSkillDefinitions.find((definition) => definition.id === reward.skillId)?.name ?? "临时千术"}`;
}

function chainSettlementView(settlement: ChainSettlementView): string {
  const legMarkup = settlement.legs.map((leg) => {
    const result = leg.result;
    const hit = result.outcome === "tie" || result.outcome === leg.target;
    const status = leg.settled ? result.outcome === "tie" ? "和局 · 不计赔率" : hit ? "押中" : "未中" : "未执行";
    const outcomeClass = !leg.settled ? "pending" : result.outcome === "tie" ? "tie" : hit ? "hit" : "miss";
    const hand = (side: Side, label: string, cards: Card[]) => `<div><span>${label} · ${side === "banker" ? result.bankerPoints : result.playerPoints} 点</span><strong>${cards.map(cardLabel).join(" · ")}</strong></div>`;
    return `<article class="chain-settlement-leg ${outcomeClass}"><header><strong>第 ${leg.index + 1} 局</strong><span>押${outcomeName(leg.target)} · ${status}</span></header><div class="chain-settlement-hands">${hand("player", "闲家", result.playerCards)}${hand("banker", "庄家", result.bankerCards)}</div><b>${outcomeName(result.outcome)}${result.outcome === "tie" ? "和局" : "家胜"}</b></article>`;
  }).join("");
  const verdict = settlement.won ? "连战成功" : "连战失败";
  const seal = settlement.won ? "胜" : "负";
  const amount = settlement.won ? `现金收益 +${money(settlement.payout)}` : `损失 ${chips(settlement.stake)}`;
  return `<div class="table-settlement chain-settlement ${settlement.won ? "hit" : "miss"}" data-action="dismiss-settlement" role="button" tabindex="0" aria-label="关闭连战结算"><section class="settlement-verdict"><i>${seal}</i><span>本场连战 · ${settlement.plannedRounds} 局</span><b>${verdict}</b><strong>${amount}</strong><small>有效 ${settlement.effectiveRounds} 局 · 和局 ${settlement.ties} 局</small></section><div class="chain-settlement-legs">${legMarkup}</div><small class="settlement-dismiss-hint">点击任意位置返回牌桌</small></div>`;
}

function dealingView(): string {
  const pending = game.pending ?? lastRound!;
  const table = game.table(tableId);
  const sequence = dealSequence(pending);
  const result = dealStage === "settled" ? pending.result : null;
  const delta = lastSettlement?.delta ?? 0;
  const betFeedback = !pending.bet ? "旁观完成" : result?.outcome === pending.bet.side ? `押中${outcomeName(pending.bet.side)}` : result?.outcome === "tie" ? "和局退注" : `押${outcomeName(pending.bet.side)}未中`;
  const settlementKind = !pending.bet ? "watch" : result?.outcome === pending.bet.side ? "hit" : result?.outcome === "tie" ? "push" : "miss";
  const settlementSeal = settlementKind === "hit" ? "中" : settlementKind === "miss" ? "负" : settlementKind === "push" ? "和" : "看";
  const settlementAmount = settlementKind === "hit" ? `现金收益 +${money(delta)}` : settlementKind === "miss" ? `损失 ${chips(pending.bet?.amount ?? 0)}` : settlementKind === "push" ? "筹码已退回" : "本局未下注";
  const chipSettlementKind = !pending.bet ? null : pending.result.outcome === pending.bet.side ? "win" : pending.result.outcome === "tie" ? "push" : "lose";
  const chipTransferLabel = chipSettlementKind === "win" ? `荷官赔付 · +${money(Math.max(0, delta))}` : chipSettlementKind === "lose" ? `荷官收注 · ${chips(pending.bet?.amount ?? 0)}` : chipSettlementKind === "push" ? "和局退注 · 筹码返还" : "";
  const awaitingCheatLegs = awaitingCheatLegIndices();
  const chainCanContinueCheating = Boolean(game.pendingChain && hasLegalCheatOpportunity());
  const cheatLocked = (dealStage === "settled" || dealStage === "settling-chips") && !chainCanContinueCheating;
  const cheatControls = pending.bet && game.availableCheatSkills.length
    ? `<div class="cheat-controls ${cheatLocked ? "disabled" : ""}"><div class="cheat-controls-heading"><strong>选择千术后点击目标牌 · 费用 ${CHEAT_SKILL_COST} 枚筹码</strong><small data-cheat-armed-label>${cheatLocked ? "本局已结算 · 千术不可用" : armedCheatSkill ? cheatTargetInstruction(armedCheatSkill) : "出千"}</small></div><div class="cheat-skill-actions">${cheatSkillActionsMarkup(cheatLocked)}</div></div>`
    : "";
  const giveUpControl = awaitingCheatLegs.length || Boolean(game.pendingChain?.legs.every((leg) => leg.settled) && chainCanContinueCheating)
    ? `<div class="give-up-actions"><button type="button" class="give-up-action" data-action="give-up">放弃本场</button></div>`
    : "";
  const chainBoards = game.pendingChain
    ? `<div class="chain-table-grid" style="--chain-count:${game.pendingChain.legs.length}">${game.pendingChain.legs.map((leg, index) => {
      const exactHit = leg.result.outcome === leg.target;
      const settledIcon = !leg.settled ? "" : exactHit ? "胜" : leg.result.outcome === "tie" ? "和" : "负";
      const danger = awaitingCheatLegs.includes(index) || Boolean(leg.settled && !exactHit && chainCanContinueCheating);
      const badgeClass = exactHit ? "win" : leg.result.outcome === "tie" ? "tie" : "miss";
      const badgeLabel = exactHit ? "押中" : leg.result.outcome === "tie" ? "和局 · 退注" : "未中";
      return `<article class="chain-table-board ${leg.settled ? "done" : "queued"}" aria-label="连战第 ${index + 1} 局${leg.settled ? ` · ${chainLegResultLabel(leg)}` : ""}"><header><button type="button" class="chain-leg-select" data-chain-leg-select="${index}" ${leg.settled ? "disabled" : ""}>第 ${index + 1} 局</button><span class="chain-leg-result ${leg.settled ? "settled" : ""}">${chainLegResultLabel(leg)}</span></header>${danger ? `<div class="chain-danger-badge" aria-label="本局可继续出千"><strong>危</strong><span>可出千</span></div>` : ""}${settledIcon ? `<div class="chain-settlement-badge ${badgeClass}" aria-label="${badgeLabel}"><strong>${settledIcon}</strong><span>${badgeLabel}</span></div>` : ""}<div class="chain-stage-host" data-chain-stage="${index}" id="chain-stage-${index}" aria-label="连战第 ${index + 1} 局牌桌"></div><div class="chain-leg-report" data-chain-leg-report="${index}">${chainLegReportMarkup(index)}</div></article>`;
    }).join("")}</div>`
    : `<div id="table-3d-stage" aria-label="3D百家乐牌桌"></div>`;
  const statusTitle = dealStage === "settled" ? result!.outcome === "tie" ? "和局" : `${outcomeName(result!.outcome)}家胜` : dealStage === "settling-chips" ? chipTransferLabel : dealStage === "awaiting-cheat" ? "本局未中 · 还可出千" : dealStage === "animating" ? "荷官发牌" : dealStage === "drawing-card" ? `${outcomeName(sequence[dealtCardCount - 1]!.side)}家补牌` : dealStage === "dealer-revealing" ? "荷官开牌" : dealStage === "awaiting-card" ? "等待开牌" : "等待操作";
  const globalDealStatus = game.pendingChain
    ? `<div class="deal-status chain-global-status"><div class="chain-global-confidence"><span>全局信心 ${Math.round(game.confidence * 100)}%</span><b class="global-wager">本场 ${chips(pending.bet?.amount ?? 0)}</b>${confidenceBreakdownView(pending)}</div>${cheatControls}${giveUpControl}</div>`
    : `<div class="deal-status single-global-status"><div class="deal-status-title">${dealStage === "settled" ? `<p class="eyebrow">${betFeedback}</p>` : ""}<h1>${statusTitle}</h1>${pending.bet ? `<small class="global-wager">本场 ${chips(pending.bet.amount)}</small>` : ""}</div>${dealStage === "settled" ? "" : liveBaccaratScore(pending)}<span>${dealStage === "settled" ? `庄 ${result!.bankerPoints} 点 · 闲 ${result!.playerPoints} 点` : pending.bet ? "" : "本局全部由荷官开牌 · 信心不变"}</span>${dealStage !== "settled" ? confidenceBreakdownView(pending) : ""}${cheatControls}${giveUpControl}</div>`;
  return shell(`
    <section class="table-page table-dealing immersive-dealing ${dealStage}">
      <div class="table-header table-header-status"><span class="round-count">第 ${dealStage === "settled" || dealStage === "settling-chips" ? table.round : table.round + 1} 局</span></div>
      <div class="table-layout">
        <section class="betting-panel live-deal-panel">
          ${globalDealStatus}
          <div class="immersive-table-stage ${game.pendingChain ? "has-chain-boards" : ""}">
            ${chainBoards}
            ${dealStage === "settling-chips" ? `<div class="chip-transfer-callout ${chipSettlementKind}"><span>${chipSettlementKind === "win" ? "PAYOUT" : chipSettlementKind === "lose" ? "COLLECT" : "PUSH"}</span><strong>${chipTransferLabel}</strong></div>` : ""}
            ${dealStage === "settled" && lastChainSettlement ? chainSettlementView(lastChainSettlement) : dealStage === "settled" && !lastSettlement?.chainContinues ? `<div class="table-settlement ${settlementKind}" data-action="dismiss-settlement" role="button" tabindex="0" aria-label="关闭结算"><section class="settlement-verdict"><i>${settlementSeal}</i><span>本局 ${outcomeName(result!.outcome)}${result!.outcome === "tie" ? "局" : "家胜"}</span><b>${betFeedback}</b><strong>${settlementAmount}</strong>${pending.bet ? `<small>押${outcomeName(pending.bet.side)} · ${chips(pending.bet.amount)}</small>` : ""}${lastSettlement?.income ? `<em>餐厅同期到账 +${money(lastSettlement.income)}</em>` : ""}</section><div class="settlement-hands"><div><span>庄家 · ${result!.bankerPoints} 点</span><strong>${result!.bankerCards.map(cardLabel).join(" · ")}</strong></div><div><span>闲家 · ${result!.playerPoints} 点</span><strong>${result!.playerCards.map(cardLabel).join(" · ")}</strong></div></div><small class="settlement-dismiss-hint">点击任意位置返回牌桌</small></div>` : ""}
          </div>
        </section>
      </div>
    </section>
  `);
}

function gameOverView(): string {
  return shell(`
    <section class="game-over-page">
      <p class="eyebrow">现金、筹码与抵押额度均已耗尽</p>
      <div class="game-over-mark">终局</div>
      <h1>赌桌不再赊账</h1>
      <p>餐厅已经没有可用抵押额度，手上的现金和筹码也归零。本次试炼到此结束。</p>
      <button class="primary" data-action="restart">重新开始</button>
    </section>
  `);
}

function syncConfidenceDisplay(): void {
  document.querySelectorAll<HTMLElement>(".confidence strong").forEach((element) => {
    element.textContent = `${Math.round(game.confidence * 100)}%`;
  });
  document.querySelectorAll<HTMLElement>("[data-debug-confidence-value]").forEach((element) => {
    element.textContent = `${Math.round(game.confidence * 100)}%`;
  });
  document.querySelectorAll<HTMLInputElement>("[data-debug-base-confidence]").forEach((element) => {
    const value = String(Math.round(game.debugBaseConfidence * 100));
    element.value = value;
    element.style.setProperty("--debug-confidence", `${value}%`);
  });
  document.querySelectorAll<HTMLInputElement>("[data-debug-confidence-lock]").forEach((element) => {
    element.checked = game.debugConfidenceForced;
  });
  syncConfidenceDetails();
}

function renderDebugMenu(): void {
  document.querySelector(".debug-overlay")?.remove();
  if (!debugMenuOpen) return;
  const overlay = document.createElement("div");
  overlay.className = "debug-overlay";
  const confidencePercent = Math.round(game.confidence * 100);
  const basePercent = Math.round(game.debugBaseConfidence * 100);
  const config = game.debugGameplayConfig;
  const debugNumberField = (label: string, description: string, key: keyof DebugGameplayConfig, value: number, min: number, step: number, unit: string, scale = 1): string => `
    <label class="debug-number-field">
      <span><strong>${label}</strong><small>${description}</small></span>
      <span class="debug-number-input"><input type="number" min="${min}" step="${step}" value="${value}" data-debug-setting="${key}" data-debug-scale="${scale}"><i>${unit}</i></span>
    </label>`;
  const debugCheatNames = game.availableCheatSkills.map((id) => cheatSkillDefinitions.find((definition) => definition.id === id)?.name ?? id).join(" · ");
  const cashControl = `<section class="debug-cash-control"><div><span>当前资金</span><strong>${money(game.cash)}</strong></div><div><span>当前筹码</span><strong>${game.availableChips} 枚</strong></div><div><button type="button" data-debug-cash-adjust="-100000" ${game.cash <= 0 ? "disabled" : ""}>扣钱 -100,000</button><button type="button" data-debug-cash-adjust="100000">加钱 +100,000</button><button type="button" data-debug-chip-adjust="-10" ${game.availableChips <= 0 ? "disabled" : ""}>减 10 筹码</button><button type="button" data-debug-chip-adjust="10">加 10 筹码</button></div></section><section class="debug-cheat-control"><div><span>当前今日千术</span><strong data-debug-cheat-list>${debugCheatNames}</strong><small data-debug-cheat-feedback>点击此处重新抽取两种千术</small></div><button type="button" data-debug-cheat-reset>重置千术</button></section>`;
  overlay.innerHTML = `<section class="debug-menu" role="dialog" aria-modal="true" aria-label="测试调试菜单"><header><div><span>TEST TOOLS</span><h2>测试调试</h2></div><div class="debug-menu-actions"><button type="button" data-debug-close aria-label="关闭调试菜单">×</button></div></header><div class="debug-menu-body"><div class="debug-row debug-confidence-control"><div><strong>基础信心</strong><small>当前版本仅用于调试神助概率显示。</small></div><output data-debug-base-confidence-value>${basePercent}%</output><div class="debug-slider-row"><input type="range" min="0" max="100" value="${basePercent}" style="--debug-confidence:${basePercent}%" data-debug-base-confidence aria-label="调整基础信心"><div><span>0%</span><span>50%</span><span>100%</span></div></div><label class="debug-switch"><input type="checkbox" data-debug-confidence-lock ${game.debugConfidenceForced ? "checked" : ""}><i></i><span>锁定 100% 信心</span></label></div><section class="debug-settings"><h3>经营与时间</h3>${debugNumberField("周期筹码产出", "调试时每周期固定产出并跳过概率判定", "restaurantIncomePerCycle", config.restaurantIncomePerCycle, 0, 100, "枚")}${debugNumberField("餐厅结算周期", "按游戏世界时间累计", "restaurantCycleWorldMinutes", config.restaurantCycleWorldMinutes, 1, 1, "游戏分钟")}${debugNumberField("赌场外时间流速", "每 1 个现实秒推进的游戏时间", "worldMinutesPerRealSecondOutsideCasino", config.worldMinutesPerRealSecondOutsideCasino, 0, 1, "游戏分钟/秒")}${debugNumberField("赌场内时间流速", "每 1 个现实秒推进的游戏时间", "worldMinutesPerRealSecondInsideCasino", config.worldMinutesPerRealSecondInsideCasino, 0, 0.1, "游戏分钟/秒")}</section><section class="debug-settings"><h3>睡眠与疲劳</h3>${debugNumberField("每日睡眠债务", "每天 00:00 新增", "sleepDebtPerMidnightWorldMinutes", config.sleepDebtPerMidnightWorldMinutes / 60, 0, 0.5, "小时", 60)}${debugNumberField("疲劳触发阈值", "累计达到该数值后进入睡眠不足", "sleepDebtThresholdWorldMinutes", config.sleepDebtThresholdWorldMinutes / 60, 1 / 60, 0.5, "小时", 60)}</section></div><footer><div><span>${game.debugConfidenceForced ? "锁定覆盖已启用" : "当前总信心"}</span><strong data-debug-confidence-value>${confidencePercent}%</strong></div><button class="debug-reset-all" type="button" data-debug-reset-all>恢复全部默认</button><small>按 ESC 关闭</small></footer></section>`;
  overlay.querySelector<HTMLElement>(".debug-menu-body")!.insertAdjacentHTML("afterbegin", cashControl);
  document.body.append(overlay);
  overlay.querySelector<HTMLElement>("[data-debug-close]")!.addEventListener("click", () => {
    debugMenuOpen = false;
    renderDebugMenu();
  });
  overlay.querySelector<HTMLInputElement>("[data-debug-base-confidence]")!.addEventListener("input", (event) => {
    game.setDebugBaseConfidence(Number((event.currentTarget as HTMLInputElement).value) / 100);
    syncConfidenceDisplay();
  });
  overlay.querySelector<HTMLInputElement>("[data-debug-confidence-lock]")!.addEventListener("change", (event) => {
    game.setDebugConfidenceForced((event.currentTarget as HTMLInputElement).checked);
    syncConfidenceDisplay();
    overlay.querySelector("footer span")!.textContent = game.debugConfidenceForced ? "锁定覆盖已启用" : "当前总信心";
  });
  overlay.querySelectorAll<HTMLButtonElement>("[data-debug-cash-adjust]").forEach((button) => {
    button.addEventListener("click", () => {
      game.adjustDebugCash(Number(button.dataset.debugCashAdjust));
      if (view !== "dealing") render();
      else {
        const wallet = document.querySelector<HTMLElement>(".wallet strong");
        if (wallet) wallet.textContent = money(game.cash);
        const chipWallet = document.querySelector<HTMLElement>(".chip-wallet strong");
        if (chipWallet) chipWallet.textContent = `${game.availableChips} 枚`;
      }
      renderDebugMenu();
    });
  });
  overlay.querySelectorAll<HTMLButtonElement>("[data-debug-chip-adjust]").forEach((button) => {
    button.addEventListener("click", () => {
      game.adjustDebugChips(Number(button.dataset.debugChipAdjust));
      if (view !== "dealing") render();
      else {
        const chipWallet = document.querySelector<HTMLElement>(".chip-wallet strong");
        if (chipWallet) chipWallet.textContent = `${game.availableChips} 枚`;
      }
      renderDebugMenu();
    });
  });
  overlay.querySelector<HTMLButtonElement>("[data-debug-cheat-reset]")!.addEventListener("click", () => {
    const skills = game.rollDailyCheatSkills();
    const names = skills.map((id) => cheatSkillDefinitions.find((definition) => definition.id === id)?.name ?? id).join(" · ");
    game.notice = `已重置今日千术 · ${names}`;
    overlay.querySelector<HTMLElement>("[data-debug-cheat-list]")!.textContent = names;
    overlay.querySelector<HTMLElement>("[data-debug-cheat-feedback]")!.textContent = "已重新抽取";
    if (view === "dealing") syncAvailableCheatSkillUi();
    else render();
  });
  overlay.querySelectorAll<HTMLInputElement>("[data-debug-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        renderDebugMenu();
        return;
      }
      const key = input.dataset.debugSetting as keyof DebugGameplayConfig;
      const scale = Number(input.dataset.debugScale ?? 1);
      game.setDebugGameplayConfig({ [key]: value * scale });
      if (view === "restaurant" || view === "map") render();
      renderDebugMenu();
    });
  });
  overlay.querySelector<HTMLElement>("[data-debug-reset-all]")!.addEventListener("click", () => {
    game.resetDebugOptions();
    if (view === "restaurant" || view === "map") render();
    renderDebugMenu();
    syncConfidenceDisplay();
  });
}

function resetInlineWatch(): void {
  inlineWatchActive = false;
  inlineWatchStep = 0;
  inlineWatchSettled = false;
  lastRound = null;
  lastSettlement = null;
}

function setupInlineWatch(): void {
  const pending = game.pending ?? lastRound;
  if (!inlineWatchActive || inlineWatchSettled || !pending) return;
  const steps = inlineWatchSteps(pending.result);
  if (inlineWatchStep < steps.length) {
    const next = steps[inlineWatchStep]!;
    const delay = inlineWatchStep === 0 ? 180 : next.kind === "deal" ? 520 : 640;
    viewTimers.push(window.setTimeout(() => {
      inlineWatchStep += 1;
      render();
    }, delay));
    return;
  }
  viewTimers.push(window.setTimeout(() => {
    const settling = game.pending;
    if (!settling) return;
    lastRound = settling;
    lastSettlement = game.settle();
    roadCreationFailure = lastSettlement.roadCreation?.matched === false ? lastSettlement.roadCreation : null;
    if (lastSettlement.roadCreation) roadMarkFeedback = null;
    inlineWatchSettled = true;
    render();
  }, 700));
}

function render(): void {
  viewTimers.forEach((timer) => window.clearTimeout(timer));
  viewTimers = [];
  tableScene?.dispose();
  chainScenes.forEach((scene) => { if (scene !== tableScene) scene.dispose(); });
  chainScenes.clear();
  tableScene = null;
  const content = view === "map" ? mapView() : view === "restaurant" ? restaurantView() : view === "skills" ? skillsView() : view === "casino-select" ? casinoSelectView() : view === "lobby" ? lobbyView() : view === "table" ? tableView() : view === "dealing" ? dealingView() : gameOverView();
  app.innerHTML = content;
  bind();
  if (view === "dealing") setupDealing();
  if (view === "table" && inlineWatchActive) setupInlineWatch();
}

type RestMode = "natural" | "next-opening" | "forced";

function startRestTransition(mode: RestMode = "natural"): void {
  const forced = mode === "forced";
  if (mode === "natural" && !game.canRestUntilNaturalWake()) {
    restChoiceOpen = false;
    render();
    return;
  }
  if (sleepTransitionActive || (!forced && (!game.canRestAtHome() || activeActivity !== "home"))) return;
  sleepTransitionActive = true;
  wakeAfterForcedRest = forced;
  const overlay = document.createElement("div");
  overlay.className = "sleep-transition";
  overlay.setAttribute("aria-hidden", "true");
  document.body.append(overlay);
  window.setTimeout(() => {
    if (mode === "forced") game.recoverFromSleepDeprivation();
    else if (mode === "natural") game.restUntilNaturalWake();
    else game.restUntilNextOpening();
    wakePromptOpen = true;
  }, 520);
  window.setTimeout(() => {
    sleepTransitionActive = false;
    overlay.remove();
    render();
  }, 1100);
}

function settleOnTable(): void {
  const pending = game.pending!;
  const chainBeforeSettlement = game.pendingChain;
  lastRound = pending;
  lastSettlement = game.settle();
  if (lastSettlement.chainContinues && chainBeforeSettlement) saveActiveChainLegUi();
  if (lastSettlement.chainContinues
    && chainBeforeSettlement?.legs.every((leg) => leg.settled)
    && !hasLegalCheatOpportunity()) {
    lastSettlement = game.finalizeSettledChain() ?? lastSettlement;
  }
  const chainSnapshot = chainBeforeSettlement ? snapshotChainSettlement(chainBeforeSettlement) : null;
  if (lastSettlement.chainContinues) {
    lastChainSettlement = null;
    activeChainLegIndex = null;
    revealedCardIndices.clear();
    divineCheckedStages.clear();
    divineRevealFeedback.clear();
    dealtCardCount = 4;
    dealStage = "settled";
    view = "dealing";
    render();
    return;
  }
  if (lastSettlement.chainCompleted) {
    if (chainSnapshot) recordCompletedChain(chainSnapshot, lastSettlement);
    else lastChainSettlement = null;
  }
  applyDealerRewardNotice(lastSettlement);
  roadCreationFailure = lastSettlement.roadCreation?.matched === false ? lastSettlement.roadCreation : null;
  if (lastSettlement.roadCreation) roadMarkFeedback = null;
  divineSpecialPending = divineActivationsThisRound >= 3 && lastSettlement.delta > 0;
  dealStage = pending.bet ? "settling-chips" : "settled";
  view = "dealing";
  render();
}

function setupDealing(): void {
  const pending = game.pending ?? lastRound!;
  const casino = casinos.find((item) => item.id === casinoId)!;
  const denominations = chipDenominations(casino);
  const recordedWagerTotal = roundWagerChips.reduce((sum, chip) => sum + chip.value, 0);
  const wagerChipsFor = (legPending: PendingRound): TableChip[] => legPending.bet && recordedWagerTotal === legPending.bet.amount
    ? roundWagerChips
    : composeChipAmount(legPending.bet?.amount ?? 0, denominations);

  if (game.pendingChain) {
    const activeIndex = game.pending ? game.pendingChain.currentLegIndex : -1;
    game.pendingChain.legs.forEach((_, index) => {
      const host = document.querySelector<HTMLElement>(`[data-chain-stage="${index}"]`);
      const legPending = pendingChainLeg(index);
      if (!host || !legPending) return;
      const scene = new TableScene(host);
      chainScenes.set(index, scene);
      const sequence = dealSequence(legPending);
      if (index !== activeIndex) {
        const legState = chainLegUiStates.get(index);
        const completed = game.pendingChain!.legs[index]!.settled;
        const shownCount = completed ? sequence.length : legState?.dealtCardCount ?? 4;
        const revealed = completed ? new Set(sequence.map((_, cardIndex) => cardIndex)) : new Set(legState?.revealedCardIndices ?? []);
        const animateInitialDeal = !legState && !completed;
        scene.deal(sequence.slice(0, shownCount), revealed, () => {
          if (animateInitialDeal) {
            chainLegUiStates.set(index, {
              dealtCardCount: shownCount,
              revealedCardIndices: new Set(revealed),
              peekedCardIndices: new Set(),
              dealStage: "awaiting-card",
              divineCheckedStages: new Set(),
              divineRevealFeedback: new Map(),
              divineActivations: 0,
            });
            updateChainLegReports();
          }
        }, animateInitialDeal ? 0 : null, playerOwnedSide(legPending), new Set(legState?.peekedCardIndices ?? []));
        if (legPending.bet) scene.showWagerChips(legPending.bet.side, wagerChipsFor(legPending));
        if (!completed) {
          scene.setCardSelection(unrevealedDealtCardIndices(shownCount, revealed), (cardIndex) => selectCardForRevealForLeg(index, cardIndex));
        }
      } else {
        tableScene = scene;
      }
    });
  } else {
    const host = document.querySelector<HTMLElement>("#table-3d-stage");
    if (!host) return;
    tableScene = new TableScene(host);
  }
  if (!tableScene) return;
  const sequence = dealSequence(pending);
  const dealingCardCount = dealtCardCount;
  const dealingRevealedCards = new Set(revealedCardIndices);
  const animateFromIndex = dealStage === "animating" ? 0 : dealStage === "drawing-card" ? dealtCardCount - 1 : null;
  const dealingLegIndex = game.pendingChain?.currentLegIndex ?? null;
  tableScene.deal(sequence.slice(0, dealtCardCount), revealedCardIndices, () => {
    if (game.pendingChain && dealingLegIndex !== null) {
      chainLegUiStates.set(dealingLegIndex, {
        dealtCardCount: dealingCardCount,
        revealedCardIndices: new Set(dealingRevealedCards),
        peekedCardIndices: new Set(peekedCardIndices),
        dealStage: "awaiting-card",
        divineCheckedStages: new Set(divineCheckedStages),
        divineRevealFeedback: new Map(divineRevealFeedback),
        divineActivations: divineActivationsThisRound,
      });
      if (activeChainLegIndex !== dealingLegIndex) return;
    }
    if (pending.bet) {
      dealStage = "awaiting-card";
      render();
    } else {
      dealStage = "dealer-revealing";
      render();
    }
  }, animateFromIndex, playerOwnedSide(pending), peekedCardIndices);
  if (dealStage === "awaiting-card" && pending.bet) {
    const selectable = unrevealedDealtCardIndices(dealtCardCount, revealedCardIndices);
    tableScene.setCardSelection(selectable, dealingLegIndex === null ? selectCardForReveal : (selectedIndex) => selectCardForRevealForLeg(dealingLegIndex, selectedIndex));
  }
  const wagerChips = wagerChipsFor(pending);
  if (pending.bet && dealStage !== "settling-chips") {
    tableScene.showWagerChips(pending.bet.side, wagerChips);
  }
  if (dealStage === "settling-chips" && pending.bet && lastSettlement) {
    const kind = pending.result.outcome === pending.bet.side ? "win" : pending.result.outcome === "tie" ? "push" : "lose";
    const payoutChips = kind === "win" ? composeChipAmount(Math.max(0, lastSettlement.delta), denominations) : [];
    tableScene.animateChipSettlement(kind, pending.bet.side, wagerChips, payoutChips, () => {
      dealStage = "settled";
      render();
    });
  }
  if (dealStage === "dealer-revealing") viewTimers.push(window.setTimeout(revealNextAutomatically, 280));
  if (dealStage === "settled" && divineSpecialPending && !roadCreationFailure) viewTimers.push(window.setTimeout(showDivineSpecialEvent, 320));
}

function selectCardForReveal(index: number, scene: TableScene | null = tableScene, legIndex: number | null = activeChainLegIndex): void {
  if (armedCheatSkill) {
    const target = cheatTargetForCard(armedCheatSkill, legIndex ?? 0, index);
    if (target) {
      const skill = armedCheatSkill;
      if (skill === "set-edge") {
        selectSetEdgeTarget(target);
        return;
      }
      if (skill !== "swap-covered" && skill !== "swap-face-up") {
        armedCheatSkill = null;
        updateCheatArmedState();
      }
      applyCheatSkillToTarget(skill, target);
    }
    return;
  }
  const pending = game.pending;
  if (!pending?.bet || dealStage !== "awaiting-card" || index >= dealtCardCount || revealedCardIndices.has(index) || !scene) return;
  if (!dealSequence(pending)[index]) return;
  const assist = armDivineAssist(index);
  if (assist) {
    scene.focus(index, () => beginDealerDivineReveal(index, assist.target, scene, legIndex));
    return;
  }
  scene.revealFocusedByDealer(index, () => finishReveal(index, scene, legIndex), { keepFocus: true });
}

function activateChainContext(legIndex: number | null): void {
  if (legIndex === null || !game.pendingChain || game.pendingChain.currentLegIndex === legIndex) return;
  selectChainLeg(legIndex);
}

function finishReveal(index: number, scene: TableScene | null = tableScene, legIndex: number | null = activeChainLegIndex): void {
  if (!scene) return;
  activateChainContext(legIndex);
  revealedCardIndices.add(index);
  peekedCardIndices.delete(index);
  advanceAfterCurrentCards(legIndex, scene);
}

function finishRevealWhileFocused(index: number, scene: TableScene | null = tableScene, legIndex: number | null = activeChainLegIndex): void {
  if (!scene) return;
  activateChainContext(legIndex);
  revealedCardIndices.add(index);
  peekedCardIndices.delete(index);
  const feedback = divineRevealFeedback.get(index);
  const advanceForContext = () => {
    activateChainContext(legIndex);
    advanceAfterCurrentCards(legIndex, scene);
  };
  const returnToTable = () => scene.returnToTable(advanceForContext);
  if (!feedback) {
    returnToTable();
    return;
  }
  divineRevealFeedback.delete(index);
  showDivineRevealFeedback(feedback, returnToTable);
}

function showDivineRevealFeedback(
  feedback: { hit: boolean; target: Outcome; probability: number },
  proceed: () => void,
): void {
  tablePlayerInteractionActive = true;
  const overlay = document.createElement("div");
  overlay.className = `divine-reveal-feedback ${feedback.hit ? "hit" : "miss"}`;
  overlay.innerHTML = `<section><span>神助判定 · ${Math.round(feedback.probability * 100)}%</span><i>${feedback.hit ? "中" : "空"}</i><h2>${feedback.hit ? "神助命中" : "神助落空"}</h2><strong>${feedback.hit ? `踩中概率 · 当前暗牌已向押${outcomeName(feedback.target)}结果改写` : `未踩中概率 · 当前暗牌未能锁定押${outcomeName(feedback.target)}结果`}</strong><small>1 秒后继续 · 点击任意位置关闭</small></section>`;
  document.body.append(overlay);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    overlay.classList.add("closing");
    window.setTimeout(() => {
      overlay.remove();
      tablePlayerInteractionActive = false;
      proceed();
    }, 120);
  };
  const timer = window.setTimeout(close, 1000);
  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
}

function isStageFinalCard(index: number): boolean {
  return Array.from({ length: dealtCardCount }, (_, candidate) => candidate)
    .filter((candidate) => !revealedCardIndices.has(candidate)).length === 1
    && !revealedCardIndices.has(index);
}

interface ArmedDivineAssist { target: Outcome; }

function armDivineAssist(index: number): ArmedDivineAssist | null {
  const pending = game.pending;
  if (!pending || !pending.bet || !isStageFinalCard(index) || divineCheckedStages.has(dealtCardCount)) {
    return null;
  }
  divineCheckedStages.add(dealtCardCount);
  const info = game.divineAssistInfo();
  if (!info.target || !game.shouldTriggerDivineAssist()) {
    return null;
  }
  divineActivationsThisRound += 1;
  return { target: info.target };
}

function startDivineGame(index: number, target: Outcome, scene: TableScene | null = tableScene, legIndex: number | null = activeChainLegIndex): void {
  activateChainContext(legIndex);
  tablePlayerInteractionActive = true;
  const beginActivation = () => {
    const activation = document.createElement("div");
    activation.className = "divine-activation";
    activation.innerHTML = `<div class="divine-activation-lines"></div><strong>这张牌！我感觉到了！！</strong>`;
    document.body.append(activation);
    document.body.classList.add("divine-activation-active");
    if ("vibrate" in navigator) navigator.vibrate([50, 24, 72, 28, 96]);
    window.setTimeout(() => {
      activation.remove();
      document.body.classList.remove("divine-activation-active");
      // 牌型选择需要参考整桌信息，先结束单牌特写再打开选择面板。
      const openCardTypeChoice = () => chooseDivineCardType(index, target, scene, legIndex);
      if (scene) scene.returnToTable(openCardTypeChoice);
      else openCardTypeChoice();
    }, 1000);
  };

  // 先让已推进到位的目标牌保持在特写中，再以全屏喊牌遮住画面。
  window.setTimeout(beginActivation, 260);
}

function chooseDivineCardType(index: number, target: Outcome, scene: TableScene | null, legIndex: number | null): void {
  const overlay = document.createElement("div");
  overlay.className = "divine-choice-overlay divine-table-choice";
  overlay.innerHTML = `<section><span>神助一阶段 · 锁定牌型</span><h2>这张牌，要什么？</h2><p>选定牌型后，以连点挤牌把它挤出来。</p><div>${DIVINE_CARD_TYPE_OPTIONS.map((choice) => `<button data-divine-type="${choice.type}"><b>${choice.label}</b><small>${choice.detail}</small></button>`).join("")}</div></section>`;
  document.body.append(overlay);
  overlay.querySelectorAll<HTMLButtonElement>("[data-divine-type]").forEach((button) => button.addEventListener("click", () => {
    const type = button.dataset.divineType as DivineCardType;
    overlay.remove();
    activateChainContext(legIndex);
    runDivineMash(index, type, "short", (hit) => {
      if (hit && game.pending!.result.outcome === target) {
        divineRevealFeedback.set(index, { hit: true, target, probability: .72 });
        scene?.setCard(index, dealSequence(game.pending!)[index]!.card);
        tablePlayerInteractionActive = false;
        scene?.quickSqueeze();
        return;
      }
      chooseDivineCall(index, target, scene, legIndex);
    }, scene, legIndex);
  }));
}

function chooseDivineCall(index: number, target: Outcome, scene: TableScene | null, legIndex: number | null): void {
  const overlay = document.createElement("div");
  overlay.className = "divine-choice-overlay divine-table-choice";
  overlay.innerHTML = `<section><span>神助二阶段 · 定下点数</span><h2>吸，还是吹？</h2><p>再挤一次，把胜局锁住。</p><div><button data-divine-call="draw"><b>吸</b><small>向上补点</small></button><button data-divine-call="blow"><b>吹</b><small>压低点数</small></button></div></section>`;
  document.body.append(overlay);
  overlay.querySelectorAll<HTMLButtonElement>("[data-divine-call]").forEach((button) => button.addEventListener("click", () => {
    overlay.remove();
    activateChainContext(legIndex);
    runDivineMash(index, button.dataset.divineCall as "draw" | "blow", "long", (hit) => {
      divineRevealFeedback.set(index, { hit, target, probability: .78 });
      scene?.setCard(index, dealSequence(game.pending!)[index]!.card);
      tablePlayerInteractionActive = false;
      scene?.quickSqueeze();
    }, scene, legIndex);
  }));
}

interface DivineShoutRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function randomDivineShoutPosition(fontSize: number, scene: TableScene | null = tableScene): { x: number; y: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const horizontalMargin = Math.max(width * 0.1, Math.min(fontSize * 1.35, width * 0.3));
  const verticalMargin = Math.max(height * 0.18, fontSize * 0.7);
  const safe = { left: horizontalMargin, top: verticalMargin, right: width - horizontalMargin, bottom: height - verticalMargin };
  const card = scene?.activeCardScreenBounds() ?? { left: width * 0.38, top: height * 0.25, right: width * 0.62, bottom: height * 0.75 };
  const gapX = fontSize * 1.45;
  const gapY = fontSize * 0.75;
  const candidates: DivineShoutRegion[] = [
    { ...safe, right: Math.min(safe.right, card.left - gapX) },
    { ...safe, left: Math.max(safe.left, card.right + gapX) },
    { ...safe, bottom: Math.min(safe.bottom, card.top - gapY) },
    { ...safe, top: Math.max(safe.top, card.bottom + gapY) },
  ].filter((region) => region.right - region.left >= 12 && region.bottom - region.top >= 12);
  const totalArea = candidates.reduce((sum, region) => sum + (region.right - region.left) * (region.bottom - region.top), 0);
  if (!totalArea) {
    return { x: width * (Math.random() < 0.5 ? 0.25 : 0.75), y: height * (0.34 + Math.random() * 0.4) };
  }
  let roll = Math.random() * totalArea;
  const region = candidates.find((candidate) => {
    roll -= (candidate.right - candidate.left) * (candidate.bottom - candidate.top);
    return roll <= 0;
  }) ?? candidates.at(-1)!;
  return {
    x: region.left + Math.random() * (region.right - region.left),
    y: region.top + Math.random() * (region.bottom - region.top),
  };
}

function runDivineMash(index: number, choice: DivineCardType | "draw" | "blow", edge: "short" | "long", done: (hit: boolean) => void, scene: TableScene | null = tableScene, legIndex: number | null = activeChainLegIndex): void {
  const prompt = document.createElement("div");
  prompt.className = "divine-mash-prompt";
  prompt.innerHTML = `<strong>狂按！</strong><span>点击任何位置开始挤牌</span>`;
  document.body.append(prompt);
  prompt.addEventListener("click", () => {
    prompt.remove();
    const overlay = document.createElement("div");
    overlay.className = "divine-mash-overlay";
    const word = choice === "draw" ? "吸！" : choice === "blow" ? "吹！" : ({ face: "公！", "no-edge": "没边！", "two-edge": "两边！", "three-edge": "三边！", "four-edge": "四边！" } as const)[choice];
    overlay.innerHTML = `<div class="divine-mash-head"><span>神助挤牌 · ${edge === "short" ? "短边" : "长边"}</span><strong>${word}</strong></div><small>保持连点，别让牌退回去</small><div class="divine-shouts"></div>`;
    document.body.append(overlay);
    const shouts = overlay.querySelector<HTMLElement>(".divine-shouts")!;
    const completionProgress = edge === "short" ? 0.3 : 1;
    const clickAdvance = completionProgress * DIVINE_MASH_CLICK_RATIO;
    let progress = completionProgress * DIVINE_MASH_INITIAL_RATIO;
    let lastAt = performance.now();
    let finished = false;
    const resolve = () => {
      if (finished) return;
      finished = true;
      activateChainContext(legIndex);
      const entry = dealSequence(game.pending!)[index]!;
      const hit = choice === "draw" || choice === "blow"
        ? game.applyDivineCall(entry.side, entry.handIndex, choice)
        : game.applyDivineCardType(entry.side, entry.handIndex, choice);
      overlay.remove();
      if (edge === "short") scene?.resetDivineMash();
      done(hit);
    };
    overlay.addEventListener("click", () => {
      if (finished) return;
      progress = Math.min(completionProgress, progress + clickAdvance);
      scene?.divineMashStep(edge, progress);
      const progressRatio = progress / completionProgress;
      const randomScale = 0.78 + Math.random() * 0.4;
      const maximumSize = Math.min(window.innerWidth * 0.24, window.innerHeight * 0.15);
      const fontSize = Math.max(34, Math.min((34 + progressRatio * 82) * randomScale, maximumSize));
      const position = randomDivineShoutPosition(fontSize, scene);
      const shout = document.createElement("span");
      shout.textContent = word;
      shout.style.setProperty("--x", `${position.x}px`);
      shout.style.setProperty("--y", `${position.y}px`);
      shout.style.setProperty("--shout-size", `${fontSize}px`);
      shout.style.setProperty("--stroke-width", `${1.5 + progressRatio * 2}px`);
      shout.style.setProperty("--shout-glow", `${18 + progressRatio * 32}px`);
      shout.style.setProperty("--slam-scale", `${2.1 + progressRatio * 1.2}`);
      shout.style.setProperty("--impact-scale", `${1.08 + progressRatio * 0.22}`);
      shout.style.setProperty("--r", `${-14 + Math.random() * 28}deg`);
      shouts.append(shout);
      setTimeout(() => shout.remove(), 420);
      const shake = 3 + progressRatio * 8;
      overlay.style.setProperty("--shake", `${shake}px`);
      overlay.style.setProperty("--shake-neg", `${-shake}px`);
      overlay.classList.remove("impact"); void overlay.offsetWidth; overlay.classList.add("impact");
      if ("vibrate" in navigator) navigator.vibrate(18);
      if (progress >= completionProgress) resolve();
    });
    const tick = (now: number) => {
      if (finished) return;
      const speed = completionProgress * divineMashRetreatRatioPerMs(progress / completionProgress);
      progress = Math.max(0, progress - (now - lastAt) * speed);
      lastAt = now;
      scene?.divineMashStep(edge, progress);
      if (progress <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { once: true });
}

function showDivineSpecialEvent(): void {
  if (!divineSpecialPending) return;
  divineSpecialPending = false;
  tablePlayerInteractionActive = true;
  const overlay = document.createElement("div");
  overlay.className = "divine-special-overlay";
  const outcomes: Outcome[] = ["banker", "player", "tie"];
  const forecast = outcomes[Math.floor(Math.random() * outcomes.length)]!;
  const forecastChance = .6 + Math.random() * .2;
  const allInThreshold = Math.floor(game.cash * (.6 + Math.random() * .3));
  const allInChance = .6 + Math.random() * .3;
  overlay.innerHTML = `<section><span>特殊事件</span><h2>我观察到了世界的变化！！</h2><p>连续三次神助并赢下本局，下一局可以改写一条规则。</p><div class="divine-special-options"><button data-special="forecast"><b>预言下次庄闲</b><small>我看见了趋势！是${outcomeName(forecast)}！！</small><i>下一局 ${Math.round(forecastChance * 100)}% 概率开${outcomeName(forecast)}</i></button><button data-special="lose"><b>预言下次结果</b><small>我看见了结果！会输！！</small><i>下一手必定失手</i></button><button data-special="all-in"><b>预言下次行为</b><small>我看见了机会！梭哈！！</small><i>下注 ≥ ${money(allInThreshold)}，胜率 ${Math.round(allInChance * 100)}%</i></button></div></section>`;
  document.body.append(overlay);
  overlay.querySelectorAll<HTMLButtonElement>("[data-special]").forEach((button) => button.addEventListener("click", () => {
    const selected = button.dataset.special;
    if (selected === "forecast") game.setNextRoundEffect({ kind: "forecast", outcome: forecast, chance: forecastChance });
    if (selected === "lose") game.setNextRoundEffect({ kind: "lose" });
    if (selected === "all-in") game.setNextRoundEffect({ kind: "all-in", threshold: allInThreshold, chance: allInChance });
    overlay.remove();
    tablePlayerInteractionActive = false;
  }));
}

function advanceAfterCurrentCards(legIndex: number | null = activeChainLegIndex, scene: TableScene | null = tableScene): void {
  const pending = game.pending!;
  const activeScene = game.pendingChain && legIndex !== null ? chainScenes.get(legIndex) ?? scene : scene;
  const currentCardsAreOpen = Array.from({ length: dealtCardCount }, (_, index) => index)
    .every((index) => revealedCardIndices.has(index));
  if (!currentCardsAreOpen) {
    if (activeScene && pending.bet && dealStage === "awaiting-card") {
      if (game.pendingChain && legIndex !== null) bindChainSceneSelection(legIndex);
      else activeScene.setCardSelection(unrevealedDealtCardIndices(dealtCardCount, revealedCardIndices), selectCardForReveal);
    }
    updateChainLegReports();
    return;
  }
  const sequence = dealSequence(pending);
  if (dealtCardCount < sequence.length) {
    const previousCount = dealtCardCount;
    dealtCardCount += 1;
    dealStage = "drawing-card";
    const nextDealtCardCount = dealtCardCount;
    const nextRevealedCardIndices = new Set(revealedCardIndices);
    const nextPeekedCardIndices = new Set(peekedCardIndices);
    const nextDealSequence = sequence.slice(0, nextDealtCardCount);
    if (activeScene) {
      activeScene.deal(nextDealSequence, nextRevealedCardIndices, () => {
        const isCurrentContext = !game.pendingChain
          || (game.pendingChain.currentLegIndex === legIndex && Boolean(game.pending));
        if (game.pendingChain && legIndex !== null) {
          chainLegUiStates.set(legIndex, {
            dealtCardCount: nextDealtCardCount,
            revealedCardIndices: new Set(nextRevealedCardIndices),
            peekedCardIndices: new Set(nextPeekedCardIndices),
            dealStage: "awaiting-card",
            divineCheckedStages: isCurrentContext ? new Set(divineCheckedStages) : new Set(chainLegUiStates.get(legIndex)?.divineCheckedStages ?? []),
            divineRevealFeedback: isCurrentContext ? new Map(divineRevealFeedback) : new Map(chainLegUiStates.get(legIndex)?.divineRevealFeedback ?? []),
            divineActivations: isCurrentContext ? divineActivationsThisRound : chainLegUiStates.get(legIndex)?.divineActivations ?? 0,
          });
          if (!isCurrentContext) {
            bindChainSceneSelection(legIndex);
            updateChainLegReports();
            return;
          }
          dealtCardCount = nextDealtCardCount;
          revealedCardIndices = new Set(nextRevealedCardIndices);
          peekedCardIndices = new Set(nextPeekedCardIndices);
          dealStage = "awaiting-card";
          bindChainSceneSelection(legIndex);
        } else {
          dealStage = "awaiting-card";
          activeScene.setCardSelection(unrevealedDealtCardIndices(dealtCardCount, revealedCardIndices), selectCardForReveal);
        }
        updateChainLegReports();
      }, previousCount, playerOwnedSide(pending));
    }
    updateChainLegReports();
    return;
  }
  if (!game.pendingChain && pendingLossCanBeChallenged(pending)) {
    dealStage = "awaiting-cheat";
    tablePlayerInteractionActive = false;
    render();
    return;
  }
  settleOnTable();
}

function pendingIsLoss(pending: PendingRound): boolean {
  if (!pending.bet) return false;
  if (pending.result.outcome === "tie" && pending.bet.side !== "tie") return false;
  return pending.result.outcome !== pending.bet.side;
}

function pendingLossCanBeChallenged(pending: PendingRound): boolean {
  return pendingIsLoss(pending) && game.availableChips > 0 && game.availableCheatSkills.length > 0;
}

function revealNextAutomatically(): void {
  const pending = game.pending;
  if (!pending || !tableScene) return;
  const index = automaticRevealOrder(pending).find((candidate) => !revealedCardIndices.has(candidate));
  if (index === undefined) {
    advanceAfterCurrentCards(activeChainLegIndex, tableScene);
    return;
  }
  const assist = armDivineAssist(index);
  if (assist) {
    tableScene.focus(index, () => beginDealerDivineReveal(index, assist.target, tableScene!, activeChainLegIndex));
    return;
  }
  tableScene.revealFocusedByDealer(index, () => finishReveal(index), { keepFocus: true });
}

function beginDealerDivineReveal(index: number, target: Outcome, scene: TableScene, legIndex: number | null): void {
  scene.beginSqueeze(index, () => undefined, () => finishRevealWhileFocused(index, scene, legIndex));
  startDivineGame(index, target, scene, legIndex);
}

function bind(): void {
  app.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => {
    const action = element.dataset.action;
    if (action === "toggle-confidence-details") {
      confidenceDetailsOpen = !confidenceDetailsOpen;
      syncConfidenceDetails();
      return;
    }
    const navigationAction = Boolean(action && ["map", "restaurant", "skills", "casinos", "lobby"].includes(action));
    if (view === "dealing" && action === "lobby" && (game.pending || game.pendingChain)) {
      const confirmed = window.confirm("退出牌局将视为认输，当前下注筹码不会返还。确定退出并回到大厅吗？");
      if (!confirmed) return;
      game.abandonPendingRound();
      resetBetDraft(false);
      roundWagerChips = [];
      lastRound = null;
      lastSettlement = null;
      lastChainSettlement = null;
      inlineWatchActive = false;
      tablePlayerInteractionActive = false;
      armedCheatSkill = null;
      setEdgeTarget = null;
      view = "lobby";
      render();
      return;
    }
    if (inlineWatchActive && !inlineWatchSettled && navigationAction) return;
    if (inlineWatchActive && inlineWatchSettled && navigationAction) resetInlineWatch();
    if (view === "table" && action && ["map", "restaurant", "skills", "casinos", "lobby"].includes(action)) resetBetDraft(true);
    if (action === "map") {
      homeSkillManagementOpen = false;
      view = "map";
    }
    if (action === "restaurant") {
      activeActivity = "restaurant";
      view = "restaurant";
    }
    if (action === "skills") {
      homeSkillManagementOpen = false;
      activeActivity = "home";
      view = "skills";
    }
    if (action === "casinos") { activeActivity = "casino"; view = "casino-select"; }
    if (action === "lobby") {
      game.clearRoadPlanning(tableId);
      roadMarkFeedback = null;
      roadCreationFailure = null;
      view = "lobby";
    }
    if (action === "upgrade") game.upgradeRestaurant();
    if (action === "pawn" && confirm(`本次抵押将获得 ${game.restaurantInfo().pawnLotChips} 枚筹码。确认抵押？`)) game.pawnRestaurantForChips();
    if (action === "redeem-pawn" && confirm(`需要支付 ${money(Math.ceil(game.restaurantInfo().pawnDebtCash * 2.5))} 赎回抵押额度。确认赎回？`)) game.redeemRestaurant();
    if (action === "close-restaurant") {
      game.closeRestaurant();
      restaurantClosingPromptOpen = false;
      activeActivity = "home";
      view = "skills";
    }
    if (action === "continue-restaurant") {
      game.continueRestaurantThroughNextClose();
      restaurantClosingPromptOpen = false;
    }
    if (action === "rest-at-home") {
      restChoiceOpen = true;
      return;
    }
    if (action === "open-rest-options") {
      restChoiceOpen = true;
      render();
      return;
    }
    if (action === "rest-natural" || action === "rest-next-opening") {
      restChoiceOpen = false;
      startRestTransition(action === "rest-natural" ? "natural" : "next-opening");
      return;
    }
    if (action === "open-skill-management") homeSkillManagementOpen = true;
    if (action === "close-skill-management") homeSkillManagementOpen = false;
    if (action === "confirm-sleep-collapse") {
      if (game.pending) game.settle();
      resetBetDraft(true);
      roundWagerChips = [];
      inlineWatchActive = false;
      tablePlayerInteractionActive = false;
      sleepCollapsePromptOpen = false;
      homeSkillManagementOpen = false;
      activeActivity = "home";
      view = "skills";
      startRestTransition("forced");
      return;
    }
    if (action === "confirm-sleep-deprivation") sleepDeprivationNoticeOpen = false;
    if (action === "open-restaurant-after-rest") {
      game.openRestaurant();
      wakePromptOpen = false;
      wakeAfterForcedRest = false;
      activeActivity = "restaurant";
      view = "restaurant";
    }
    if (action === "cancel-wake") {
      wakePromptOpen = false;
      wakeAfterForcedRest = false;
    }
    if (action === "equip-skill") game.equipSkill(element.dataset.skill as SkillId);
    if (action === "unequip-skill") game.equipSkill(null);
    if (action === "upgrade-skill") game.upgradeSkill(element.dataset.skill as SkillId);
    if (action === "clear-road-marks") {
      game.clearRoadMarks(tableId);
      roadMarkFeedback = null;
      game.notice = "已清除本桌全部路书标记";
    }
    if (action === "cancel-cheat") {
      cancelCheatSelection();
      return;
    }
    if (action === "confirm-covered-reorder") {
      cardReorderSession?.confirm();
      return;
    }
    if (action === "start-bet") {
      const casino = casinos.find((item) => item.id === casinoId)!;
      const minimum = Math.ceil(casino.minBet / 100);
      if (game.availableChips < minimum) {
        showTableActionNotice(`筹码不足，最低下注需要 ${minimum} 枚筹码`);
        return;
      }
      tableEntryStep = "chips";
      selectedChipCount = Math.max(1, minimum);
      render();
      return;
    }
    if (action === "open-targets") {
      const casino = casinos.find((item) => item.id === casinoId)!;
      const minimum = Math.ceil(casino.minBet / 100);
      if (game.availableChips < minimum) {
        showTableActionNotice(`筹码不足，最低下注需要 ${minimum} 枚筹码`);
        return;
      }
      tableEntryStep = "targets";
      chainRounds = casino.maxChainRounds;
      chainTargets = Array.from({ length: chainRounds }, () => "banker" as Outcome);
      chainTargetSelected = Array.from({ length: chainRounds }, () => false);
      stagedBetSide = null;
      render();
      return;
    }
    if (action === "cancel-entry") {
      game.cancelReservedBet();
      resetBetDraft(false, false);
      tableEntryStep = "choice";
      render();
      return;
    }
    if (action === "dismiss-road-creation-failure") roadCreationFailure = null;
    if (action === "cancel-bet") {
      game.cancelReservedBet();
      resetBetDraft(false);
      tableEntryStep = "choice";
      render();
      return;
    }
    if (action === "watch") {
      resetBetDraft(true);
      roundWagerChips = [];
      roadCreationFailure = null;
      game.play(tableId, null);
      inlineWatchActive = true;
      inlineWatchStep = 0;
      inlineWatchSettled = false;
      lastRound = null;
      lastSettlement = null;
      tableEntryStep = "choice";
      view = "table";
    }
    if (action === "confirm-bet" && (stagedBetSide || chainTargetSelected.some(Boolean))) {
      const chainStakeTargets = chainTargets.filter((target, index): target is Outcome => chainTargetSelected[index] && (target === "banker" || target === "player" || target === "tie"));
      if (!chainStakeTargets.length) return;
      const stake = selectedChipCount * 100;
      if (game.availableChips < selectedChipCount) {
        showTableActionNotice(`筹码不足，本次下注需要 ${selectedChipCount} 枚筹码`);
        return;
      }
      const reserved = chainStakeTargets.length > 1
        ? game.reserveChainStake(stake, tableId)
        : game.reserveChipBet(stake);
      if (!reserved) {
        showTableActionNotice("筹码不足，无法确认下注");
        render();
        return;
      }
      lastChainSettlement = null;
      roadCreationFailure = null;
      game.setRoadCreationSequence(tableId, chainStakeTargets.length > 1
        ? chainStakeTargets.filter((target): target is Side => target === "banker" || target === "player")
        : stagedBetSide === "banker" || stagedBetSide === "player" ? [stagedBetSide] : []);
      roundWagerChips = Array.from({ length: selectedChipCount }, () => ({ value: 100, colorIndex: 0 }));
      if (chainStakeTargets.length > 1) game.playChain(tableId, [...chainStakeTargets]);
      else game.play(tableId, { side: stagedBetSide!, amount: game.reservedBetAmount });
      chainLegUiStates.clear();
      activeChainLegIndex = chainRounds > 1 ? 0 : null;
      resetBetDraft(false, false);
      revealedCardIndices.clear(); divineCheckedStages.clear(); divineRevealFeedback.clear(); divineActivationsThisRound = 0; divineSpecialPending = false; tablePlayerInteractionActive = false; dealtCardCount = 4; dealStage = "animating"; view = "dealing";
    }
    if (action === "give-up") {
      if (game.pendingChain) {
        game.abandonPendingRound();
        resetBetDraft(false, false);
        roundWagerChips = [];
        chainLegUiStates.clear();
        activeChainLegIndex = null;
        revealedCardIndices.clear();
        peekedCardIndices.clear();
        lastRound = null;
        lastSettlement = null;
        lastChainSettlement = null;
        armedCheatSkill = null;
        setEdgeTarget = null;
        dealStage = "animating";
        tableEntryStep = "choice";
        view = "table";
        game.notice = "已放弃本场连战，下注筹码不予返还";
        render();
      } else if (game.pending && dealStage === "awaiting-cheat") {
        settleOnTable();
      }
      return;
    }
    if (action === "dismiss-settlement") {
      lastChainSettlement = null;
      if (inlineWatchActive) resetInlineWatch();
      else tablePlayerInteractionActive = false;
      dealStage = "animating";
      tableEntryStep = "choice";
      view = game.gameOver ? "game-over" : "table";
    }
    if (action === "continue" && inlineWatchActive) {
      resetInlineWatch();
      view = "table";
    } else if (action === "continue") {
      tablePlayerInteractionActive = false; dealStage = "animating"; view = "table";
    }
    if (action === "restart") window.location.reload();
    render();
  }));

  app.querySelectorAll<HTMLElement>("[data-casino]").forEach((element) => element.addEventListener("click", () => {
    const selectedCasinoId = element.dataset.casino!;
    if (!game.enterCasinoWithChips(selectedCasinoId)) {
      render();
      return;
    }
    casinoId = selectedCasinoId;
    view = "lobby";
    render();
  }));
  app.querySelectorAll<HTMLElement>("[data-table]").forEach((element) => element.addEventListener("click", () => {
    resetBetDraft(true);
    roadMarkFeedback = null;
    tableId = element.dataset.table!;
    const casino = casinos.find((item) => item.id === casinoId)!;
    selectedChipCount = Math.ceil(casino.minBet / 100);
    chainTargetSelected = [false];
    tableEntryStep = "choice";
    view = "table";
    render();
  }));

  app.querySelectorAll<HTMLElement>("[data-road-create-book]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (view !== "table" || game.pending) return;
    const roadBook = element.dataset.roadCreateBook as RoadBook;
    const table = game.table(tableId);
    const sequence = game.roadCreationSequence(tableId);
    const creationIndex = Number(element.dataset.creationIndex);
    if (!Number.isInteger(creationIndex) || creationIndex < 0 || creationIndex > sequence.length) return;
    const prefix = sequence.slice(0, creationIndex);
    const history = prefix.reduce((projected, side) => appendHypotheticalRound(table, projected, side), table.history);
    const currentSide = sequence[creationIndex] ?? null;
    const cancelFromCreation = () => {
      const removedCount = sequence.length - creationIndex;
      game.updateRoadCreation(tableId, creationIndex, null);
      roadMarkFeedback = {
        message: creationIndex === 0 ? "已取消全部创造路数" : `已撤销第 ${creationIndex + 1} 局及后续预测`,
        debug: `共撤销 ${removedCount} 局虚影`,
      };
      render();
    };
    if (roadBook !== "bead") {
      if (currentSide) {
        cancelFromCreation();
        return;
      }
      const selectedSide = element.dataset.roadSide;
      if (selectedSide !== "banker" && selectedSide !== "player") return;
      const selectedColor = element.dataset.roadColor === "blue" ? "蓝" : "红";
      game.updateRoadCreation(tableId, creationIndex, selectedSide);
      roadMarkFeedback = {
        message: `继续创造 · 第 ${creationIndex + 1} 局预想${outcomeName(selectedSide)}`,
        debug: `${selectedColor}色虚影已同步到全部路书，再点一次可撤销`,
      };
      render();
      return;
    }
    const currentCell = currentSide ? roadPreviewCell(table, roadBook, history, currentSide, creationIndex) : null;
    const desiredColor: DerivedRoadColor | null = !currentSide ? "red" : currentCell?.color === "red" ? "blue" : null;
    if (!desiredColor) {
      cancelFromCreation();
      return;
    }
    const clickedRow = Number(element.dataset.row);
    const clickedColumn = Number(element.dataset.column);
    const candidates = (["banker", "player"] as const)
      .map((side) => roadPreviewCell(table, roadBook, history, side, creationIndex))
      .filter((cell): cell is RoadPreviewCell => cell !== null && cell.color === desiredColor);
    const selected = candidates.find((cell) => cell.row === clickedRow && cell.column === clickedColumn) ?? candidates[0];
    if (!selected) {
      roadMarkFeedback = {
        message: `当前无法画出${desiredColor === "red" ? "红" : "蓝"}色下一路`,
        debug: "庄闲问路没有可唯一同步的对应结果",
      };
      render();
      return;
    }
    const removedLaterCount = Math.max(0, sequence.length - creationIndex - 1);
    game.updateRoadCreation(tableId, creationIndex, selected.side);
    roadMarkFeedback = {
      message: creationIndex === sequence.length
        ? `继续创造 · 第 ${creationIndex + 1} 局预想${outcomeName(selected.side)}`
        : `已修改第 ${creationIndex + 1} 局 · 预想${outcomeName(selected.side)}`,
      debug: `${desiredColor === "red" ? "红" : "蓝"}色虚影已同步到全部路书${removedLaterCount ? `，后续 ${removedLaterCount} 局已撤销` : ""}`,
    };
    render();
  }));

  app.querySelectorAll<HTMLElement>("[data-road-mark-title]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (view !== "table" || game.pending) return;
    const roadBook = element.dataset.roadMarkTitle as RoadBook;
    const history = game.roadAnalysisHistory(tableId);
    if (roadBook === "bead") {
      const patterns = game.markCurrentBeadRoad(tableId);
      const currentPattern = patterns[0] ?? null;
      const markedPatterns = game.markedRoadPatterns(tableId);
      game.notice = currentPattern ? `标记完成 · 共标记 ${markedRoadBookCount(tableId)} 路，成立 ${markedPatterns.length} 型` : "珠盘路已完整标记 · 当前未形成有效路数";
      roadMarkFeedback = {
        message: "珠盘路已完整标记",
        debug: currentPattern ? `${currentPattern.name}有效，预测${outcomeName(currentPattern.prediction)}` : "整张路书已标记，当前无有效路数",
      };
      render();
      return;
    }
    const roadWindow = element.parentElement?.querySelector<HTMLElement>("[data-road-window]");
    if (!roadWindow) return;
    const visibleFrom = Number(roadWindow.dataset.visibleFrom ?? 0);
    const columns = Number(roadWindow.dataset.columns ?? 1);
    const bounds = element.getBoundingClientRect();
    const localColumn = Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * columns)));
    const startColumn = visibleFrom + localColumn;
    const derived = makeDerivedRoads(history);
    const roadCells = roadBook === "big"
      ? makeBigRoad(history)
      : roadBook === "big-eye"
        ? derived.bigEye
        : roadBook === "small"
          ? derived.small
          : derived.cockroach;
    const cellsWithRounds = roadCells as Array<{ column: number; roundIndex: number }>;
    const startRound = cellsWithRounds
      .filter((cell) => cell.column >= startColumn)
      .sort((a, b) => a.roundIndex - b.roundIndex)[0]?.roundIndex ?? history.length;
    game.markRoad(tableId, roadBook, startColumn, startRound);
    const markedPatterns = game.markedRoadPatterns(tableId);
    const currentPattern = markedPatterns.find((pattern) => pattern.source === roadBook);
    const exactStart = confidenceRoadStartColumn(history, roadBook);
    game.notice = currentPattern ? `标记完成 · 共标记 ${markedRoadBookCount(tableId)} 路，成立 ${markedPatterns.length} 型` : "标记完成 · 当前区间未形成有效路数";
    roadMarkFeedback = {
      message: `${roadBook === "big" ? "大路" : roadBook === "big-eye" ? "大眼仔路" : roadBook === "small" ? "小路" : "曱甴路"}标题栏已标记`,
      debug: currentPattern
        ? `${currentPattern.name}有效，预测${outcomeName(currentPattern.prediction)}`
        : exactStart === null ? `第 ${startColumn + 1} 列当前无有效路数` : `未命中有效路数起始列；应标记第 ${exactStart + 1} 列`,
    };
    render();
  }));

  app.querySelectorAll<HTMLInputElement>("[data-chip-count]").forEach((element) => element.addEventListener("input", () => {
    selectedChipCount = Math.max(1, Math.floor(Number(element.value)));
    const valueLabel = element.closest<HTMLElement>(".chip-count-slider,.entry-chip-slider")?.querySelector<HTMLElement>("[data-chip-count-value]")
      ?? app.querySelector<HTMLElement>("[data-chip-count-value]");
    if (valueLabel) valueLabel.textContent = `${selectedChipCount} 枚`;
    app.querySelectorAll<HTMLElement>(".zone-wager strong").forEach((label) => { label.textContent = `${selectedChipCount} 枚`; });
    app.querySelectorAll<HTMLElement>("[data-bet-payout]").forEach((label) => {
      const rounds = Number(label.dataset.roundCount ?? 1);
      const multiplier = rounds > 1 ? `2^${rounds}` : "2";
      label.textContent = `${money(selectedChipCount * 100)} × ${multiplier} = ${money(selectedChipCount * 100 * (rounds > 1 ? 2 ** rounds : 2))}`;
    });
    const min = Number(element.min);
    const max = Number(element.max);
    const validTargets = chainTargetSelected.some(Boolean);
    const canConfirm = selectedChipCount >= min && selectedChipCount <= max && game.availableChips >= selectedChipCount && validTargets;
    const confirm = app.querySelector<HTMLButtonElement>("[data-bet-confirm]");
    if (confirm) confirm.disabled = !canConfirm;
  }));
  bindCheatSkillActions();
  app.querySelectorAll<HTMLElement>("[data-chain-leg-select]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation();
    selectChainLeg(Number(element.dataset.chainLegSelect));
  }));
  app.querySelectorAll<HTMLElement>("[data-bet-zone]").forEach((element) => element.addEventListener("click", () => {
    const casino = casinos.find((item) => item.id === casinoId)!;
    const side = element.dataset.betZone as Outcome;
    const targetIndex = chainRounds > 1 ? Number(element.dataset.betZoneIndex) : 0;
    if (tableEntryStep === "targets") {
      const selectedCount = chainTargetSelected.filter(Boolean).length;
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= chainRounds || targetIndex > selectedCount) return;
      const isSelected = chainTargetSelected[targetIndex] === true;
      const isSameTarget = isSelected && chainTargets[targetIndex] === side;
      if (isSameTarget) {
        for (let index = targetIndex; index < chainRounds; index += 1) {
          chainTargetSelected[index] = false;
          chainTargets[index] = "banker";
        }
      } else {
        chainTargets[targetIndex] = side;
        chainTargetSelected[targetIndex] = true;
      }
      stagedBetSide = chainTargetSelected.reduce((last, selected, index) => selected ? chainTargets[index]! : last, null as Outcome | null);
      game.setRoadCreationSequence(tableId, chainTargets.filter((target, index): target is Side => chainTargetSelected[index] && (target === "banker" || target === "player")));
      render();
      return;
    }
    if (chainRounds > 1 && Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < chainRounds) {
      const selectedCount = chainTargetSelected.filter(Boolean).length;
      const isSameTarget = chainTargetSelected[targetIndex] && chainTargets[targetIndex] === side;
      if (isSameTarget) {
        // 只能从最后一局开始撤销，前面的目标保持不变。
        if (targetIndex !== selectedCount - 1) return;
        const remainingCount = selectedCount - 1;
        if (remainingCount <= 0) {
          chainTargets = ["banker"];
          chainTargetSelected = [false];
          chainRounds = 1;
        } else {
          chainRounds = Math.min(casino.maxChainRounds, remainingCount + 1);
          chainTargets = chainTargets.slice(0, chainRounds);
          while (chainTargets.length < chainRounds) chainTargets.push("banker");
          chainTargetSelected = Array.from({ length: chainRounds }, (_, index) => index < remainingCount);
        }
      } else {
        // 目标行可以改押另一侧；只有点击当前最后一个空白行时才会追加下一行。
        chainTargets[targetIndex] = side;
        chainTargetSelected[targetIndex] = true;
        const nextSelectedCount = Math.max(selectedCount, targetIndex + 1);
        chainRounds = Math.min(casino.maxChainRounds, nextSelectedCount + 1);
        chainTargets = chainTargets.slice(0, chainRounds);
        while (chainTargets.length < chainRounds) chainTargets.push("banker");
        chainTargetSelected = Array.from({ length: chainRounds }, (_, index) => index < nextSelectedCount);
        if (targetIndex >= nextSelectedCount) {
          chainTargetSelected[targetIndex] = true;
        }
      }
    } else {
      if (chainTargetSelected[0] && chainTargets[0] === side) {
        chainTargetSelected[0] = false;
        game.setRoadCreationSequence(tableId, []);
        stagedBetSide = null;
        render();
        return;
      }
      chainTargets[0] = side;
      chainTargetSelected[0] = true;
      if (casino.maxChainRounds > 1) {
        chainRounds = 2;
        chainTargets.push("banker");
        chainTargetSelected.push(false);
      }
    }
    game.setRoadCreationSequence(tableId, chainTargets.filter((target, index): target is Side => {
      const selected = chainRounds > 1 ? chainTargetSelected[index] : chainTargetSelected[0];
      return selected && (target === "banker" || target === "player");
    }));
    const lastSelectedIndex = chainTargetSelected.reduce((last, selected, index) => selected ? index : last, -1);
    stagedBetSide = lastSelectedIndex >= 0 ? chainTargets[lastSelectedIndex]! : null;
    render();
  }));

  const restChoiceBackdrop = app.querySelector<HTMLElement>("[data-rest-choice-backdrop]");
  restChoiceBackdrop?.addEventListener("click", (event) => {
    if (event.target !== restChoiceBackdrop) return;
    restChoiceOpen = false;
    render();
  });
  bindConfidenceDetails();
}

render();

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (confidenceDetailsOpen) {
    confidenceDetailsOpen = false;
    syncConfidenceDetails();
    return;
  }
  debugMenuOpen = !debugMenuOpen;
  renderDebugMenu();
});

window.setInterval(() => {
  const atTable = view === "table" || view === "dealing";
  const insideCasino = activeActivity === "casino";
  const paused = worldTimePaused();
  const tick = game.tickRealtime(Date.now(), atTable ? tableId : null, insideCasino, paused, activeActivity === "restaurant");
  if (tick.income > 0) game.notice = `餐厅产出 ${tick.income} 枚筹码`;
  if (tick.sleepDeprivationStarted) {
    sleepDeprivationNoticeOpen = true;
    render();
    return;
  }
  if (tick.sleepDeprivationCollapseReached) {
    sleepCollapsePromptOpen = true;
    render();
    return;
  }
  if (tick.restaurantClosingReached) {
    restaurantClosingPromptOpen = true;
    render();
    return;
  }

  const wallet = document.querySelector<HTMLElement>(".wallet strong");
  if (wallet) wallet.textContent = money(game.cash);
  const chipWallet = document.querySelector<HTMLElement>(".chip-wallet strong");
  if (chipWallet) chipWallet.textContent = `${game.availableChips} 枚`;

  const worldClock = document.querySelector<HTMLElement>("[data-world-clock]");
  if (worldClock) worldClock.textContent = worldTimeLabel();
  const worldTimeSummary = document.querySelector<HTMLElement>("[data-world-time-summary]");
  if (worldTimeSummary) worldTimeSummary.textContent = worldTimeLabel();
  const mapWorld = document.querySelector<HTMLElement>("[data-map-world]");
  if (mapWorld) {
    const daylight = worldIsDaylight();
    mapWorld.classList.toggle("daylight", daylight);
    mapWorld.classList.toggle("night", !daylight);
  }
  const worldClockWrap = document.querySelector<HTMLElement>(".world-clock");
  worldClockWrap?.classList.toggle("paused", paused);
  worldClockWrap?.classList.toggle("sleep-deprived", game.isSleepDeprived());
  const sleepStatus = document.querySelector<HTMLElement>("[data-sleep-status]");
  if (sleepStatus) sleepStatus.hidden = !game.isSleepDeprived();

  const restaurantClock = document.querySelector<HTMLElement>("[data-restaurant-clock]");
  const restaurantCycleWorldMinutes = game.debugGameplayConfig.restaurantCycleWorldMinutes;
  const worldMinutesRemaining = Math.ceil(restaurantCycleWorldMinutes - game.restaurant.cycleElapsedWorldMinutes);
  if (restaurantClock) {
    restaurantClock.style.setProperty("--progress", String(game.restaurant.cycleElapsedWorldMinutes / restaurantCycleWorldMinutes));
    const value = restaurantClock.querySelector("strong");
    if (value) value.textContent = `${worldMinutesRemaining}分`;
  }
  const restaurantProgress = document.querySelector<HTMLElement>("[data-restaurant-progress]");
  if (restaurantProgress) {
    const bar = restaurantProgress.querySelector<HTMLElement>("i b");
    const label = restaurantProgress.querySelector<HTMLElement>("em");
    if (bar) bar.style.width = `${game.restaurant.open ? game.restaurant.cycleElapsedWorldMinutes / restaurantCycleWorldMinutes * 100 : 0}%`;
    if (label) label.textContent = game.restaurant.pawned ? "已停止" : game.restaurant.open ? `${worldMinutesRemaining} 游戏分钟后结算` : "餐厅已打烊";
  }
  document.querySelectorAll<HTMLElement>("[data-table-clock]").forEach((clock) => {
    const table = game.table(clock.dataset.tableClock!);
    clock.lastChild!.textContent = `${Math.ceil((LOBBY_ROUND_MS - table.realtimeElapsedMs) / 1000)}s 开牌`;
  });

  if (view === "lobby" && tick.tablesAdvanced > 0) {
    const casino = casinos.find((item) => item.id === casinoId)!;
    tick.advancedTableIds.forEach((advancedTableId) => {
      const tableCard = app.querySelector<HTMLElement>(`[data-table="${advancedTableId}"]`);
      if (tableCard) tableCard.innerHTML = lobbyTableContent(game.table(advancedTableId), casino);
    });
  }
}, 250);
