import "./style.css";
import casinoAsset from "./casino.jpg";
import homeAsset from "./home.jpg";
import homeNightAsset from "./home_night.jpg";
import mapAsset from "./map.jpg";
import mapDaylightAsset from "./map_daylight.jpg";
import restaurantAsset from "./restaurant.jpg";
import { cardFaceAsset } from "./card-assets";
import { cardLabel, cardValue, confidenceRoadStartColumn, forecastBaccaratReveal, makeBeadPlate, makeBigRoad, makeDerivedRoads, type BaccaratRevealForecast, type Card, type DerivedRoadCell, type DerivedRoadColor, type Outcome, type RoadBook, type RoundResult, type Side } from "./domain";
import { casinos, Game, LOBBY_ROUND_MS, MAX_SKILL_LEVEL, inlineWatchSteps, skillDefinitions, type Casino, type DebugGameplayConfig, type DivineCardType, type GameTable, type PendingRound, type RoadCreationResolution, type SettlementResult, type SkillId } from "./game";
import { cardRevealActor, composeChipAmount, DIVINE_MASH_CLICK_RATIO, DIVINE_MASH_INITIAL_RATIO, divineMashRetreatRatioPerMs, TableScene, unrevealedDealtCardIndices, type TableChip } from "./table-scene";

type View = "map" | "restaurant" | "skills" | "casino-select" | "lobby" | "table" | "dealing" | "game-over";
type Activity = "restaurant" | "casino" | "home";
type DealStage = "animating" | "drawing-card" | "awaiting-card" | "dealer-revealing" | "settling-chips" | "settled";

const game = new Game();
const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "map";
let activeActivity: Activity = "restaurant";
let casinoId = casinos[0]!.id;
let tableId = "harbor-1";
let stagedBetSide: Outcome | null = null;
let stagedBetChips: TableChip[] = [];
let roundWagerChips: TableChip[] = [];
let selectedChip = 100;
let tableScene: TableScene | null = null;
let lastSettlement: SettlementResult | null = null;
let lastRound: PendingRound | null = null;
let viewTimers: number[] = [];
let dealStage: DealStage = "animating";
let revealedCardIndices = new Set<number>();
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
let roadCreationFailure: RoadCreationResolution | null = null;
let restaurantClosingPromptOpen = false;
let sleepTransitionActive = false;
let wakePromptOpen = false;
let sleepCollapsePromptOpen = false;
let sleepDeprivationNoticeOpen = false;
let wakeAfterForcedRest = false;
let homeSkillManagementOpen = false;
let restChoiceOpen = false;

const money = (value: number) => `¥${Math.floor(value).toLocaleString("zh-CN")}`;
const outcomeName = (outcome: Outcome) => ({ banker: "庄", player: "闲", tie: "和" })[outcome];
const chipDenominations = (casino: Casino) => [1, 2, 5, 10, 20].map((multiple) => casino.minBet * multiple).filter((value) => value <= casino.maxBet);
const roadBooks: RoadBook[] = ["bead", "big", "big-eye", "small", "cockroach"];
const SHOW_LAST_CARD_FORECAST = false;
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

function resetBetDraft(refund = true): void {
  if (refund) game.cancelReservedBet();
  stagedBetSide = null;
  stagedBetChips = [];
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
  || (debugMenuOpen && view === "dealing");

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
      <div class="confidence"><span>信心</span><strong>${Math.round(game.confidence * 100)}%</strong></div>
      <div class="wallet"><span>可用现金</span><strong>${money(game.cash)}</strong></div>
    </header>
    <main>${content}</main>
    ${restaurantClosingPromptOpen ? restaurantClosingPrompt() : ""}
    ${wakePromptOpen ? wakePrompt() : ""}
    ${restChoiceOpen ? restChoicePrompt() : ""}
    ${sleepDeprivationNoticeOpen ? sleepDeprivationNotice() : ""}
    ${sleepCollapsePromptOpen ? sleepCollapsePrompt() : ""}
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

type DerivedRoadKind = "big-eye" | "small-road" | "cockroach-road";

function derivedRoad(table: GameTable, cells: DerivedRoadCell[], label: string, roadBook: RoadBook, kind: DerivedRoadKind, compact = false, interactive = false): string {
  const previews = roadPreviewCells(table, roadBook);
  const ghosts = roadCreatedCells(table, roadBook);
  const maxColumn = Math.max(...cells.map((cell) => cell.column), ...previews.map((cell) => cell.column), ...ghosts.map((cell) => cell.column), 0);
  const columns = compact ? 12 : 18;
  const visibleFrom = Math.max(0, maxColumn - columns + 1);
  return `<div class="derived-block ${kind}"><div class="derived-label ${interactive ? "road-mark-title" : ""}" ${interactive ? `data-road-mark-title="${roadBook}" title="点击标题栏对应列标记路数"` : ""}><i class="road-symbol ${kind} red"></i>${label}</div><div class="derived-road ${compact ? "compact" : ""} ${interactive ? "creatable-road" : ""}" style="--columns:${columns}" aria-label="${label}" data-road-window data-visible-from="${visibleFrom}" data-columns="${columns}">${roadMarkOverlay(table, roadBook, visibleFrom, columns)}${cells.filter((cell) => cell.column >= visibleFrom).map((cell) => `<span class="derived-mark ${cell.color}" style="--row:${cell.row};--col:${cell.column - visibleFrom}"></span>`).join("")}${ghosts.filter((cell) => cell.column >= visibleFrom).map((cell) => `<span class="derived-mark created-road-ghost ${cell.color}" style="--row:${cell.row};--col:${cell.column - visibleFrom}"></span>`).join("")}${interactive ? roadCreationTargets(table, roadBook, visibleFrom) : ""}</div></div>`;
}

function beadRoadPanel(table: GameTable, interactive = false, columns = 9): string {
  return `<section class="bead-road-panel"><div class="road-panel-heading ${interactive ? "road-mark-title" : ""}" ${interactive ? `data-road-mark-title="bead" title="点击标题栏标记整张珠盘路"` : ""}><i class="bead-symbol banker"></i>珠盘路</div>${beadPlate(table, interactive, columns)}</section>`;
}

function roadSheet(table: GameTable, compact = false, interactive = false, layout: "full" | "expanded" = "full"): string {
  const derived = makeDerivedRoads(table.history);
  const bead = beadRoadPanel(table, interactive);
  const bigRoadPanel = (columns?: number) => `<section class="big-road-panel"><div class="road-panel-heading ${interactive ? "road-mark-title" : ""}" ${interactive ? `data-road-mark-title="big" title="点击标题栏对应列标记路数"` : ""}><i class="big-road-symbol banker"></i>大路</div>${road(table, compact, interactive, columns)}</section>`;
  const desktopBig = bigRoadPanel(layout === "expanded" ? 30 : undefined);
  const mobileBig = bigRoadPanel(layout === "expanded" ? 18 : undefined);
  const derivedRoads = (derivedCompact: boolean) => `${derivedRoad(table, derived.bigEye, "大眼仔路", "big-eye", "big-eye", derivedCompact, interactive)}${derivedRoad(table, derived.small, "小路", "small", "small-road", derivedCompact, interactive)}${derivedRoad(table, derived.cockroach, "曱甴路", "cockroach", "cockroach-road", derivedCompact, interactive)}`;
  const info = `<aside class="road-info-panel"><div class="road-stats-title">牌局结果</div>${roadStats(table)}</aside>`;
  const expandedClass = layout === "expanded" ? "expanded" : "";
  const desktopBead = layout === "expanded" ? beadRoadPanel(table, interactive, 10) : bead;
  const mobileBead = layout === "expanded" ? beadRoadPanel(table, interactive, 18) : bead;
  const desktopRoadContent = layout === "expanded"
    ? `${info}${desktopBead}${desktopBig}<div class="derived-grid">${derivedRoads(false)}</div>`
    : `${desktopBead}${desktopBig}<div class="derived-grid">${derivedRoads(true)}</div>${info}`;
  const mobileRoadContent = layout === "expanded"
    ? `${info}${mobileBead}${mobileBig}<div class="derived-grid">${derivedRoads(true)}</div>`
    : `${mobileBead}${mobileBig}<div class="derived-grid">${derivedRoads(true)}</div>${info}`;
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
          <span class="map-location-pulse" aria-hidden="true"></span><span class="map-location-icon">店</span><strong>外港小馆</strong><small>${game.restaurant.pawned ? "已典当 · 停止营业" : `${game.restaurant.open ? "营业中" : "已打烊"} · ${game.restaurant.level} 级 · 每小时 ${money(restaurant.income)}`}</small>${locationStatus("restaurant", game.restaurant.open ? "经营" : "打烊")}
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
  const daylight = worldIsDaylight();
  const skillManagement = homeSkillManagementOpen ? `<div class="home-skill-overlay" role="dialog" aria-modal="true" aria-labelledby="home-skill-title">
    <section class="residence-skill-workspace">
      <header class="home-skill-header"><div><span>书桌 · 赌术构筑</span><h2 id="home-skill-title">技能管理</h2><small>只有一个技能栏位</small></div><button class="home-skill-close" data-action="close-skill-management" aria-label="关闭技能管理">×</button></header>
      <section class="equipped-skill-slot ${equipped ? "filled" : "empty"}">
        <div><span>唯一技能栏位 · 1 SLOT</span><h2>${equipped ? equipped.name : "尚未装备技能"}</h2><p>${equipped ? `${equipped.description} 当前 Lv.${game.skills[equipped.id]}，等级保留但不参与本轮信心公式。` : "未装备技能也可以通过标记路书获得信心。"}</p></div>
        ${equipped ? `<button class="secondary" data-action="unequip-skill">卸下技能</button>` : ""}
      </section>
      <div class="skill-grid">${skillDefinitions.map((skill) => {
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
        <div class="restaurant-scene-header"><div><p class="eyebrow">稳定收入 · 外港小馆</p><h1>${game.restaurant.pawned ? "已典当" : game.restaurant.open ? `${game.restaurant.level} 级经营中` : "今日已打烊"}</h1></div></div>
        <section class="restaurant-control-panel ${game.restaurant.pawned ? "is-pawned" : ""} ${game.restaurant.open ? "is-open" : "is-closed"}">
          <header><div><span>餐厅经营 · 08:00 - 20:00</span><h2>${game.restaurant.pawned ? "停止营业" : game.restaurant.open ? "营业中" : "已打烊"}</h2></div><strong>${game.restaurant.pawned || !game.restaurant.open ? "—" : money(info.income)}<small>${game.restaurant.pawned ? "无收益" : game.restaurant.open ? `/ ${cycleLabel}` : "等待继续营业"}</small></strong></header>
          <div class="restaurant-scene-stats"><div><span>当前等级</span><b>Lv.${game.restaurant.level}</b></div><div><span>周期收益</span><b>${game.restaurant.pawned || !game.restaurant.open ? "停止" : money(info.income)}</b></div><div><span>典当估值</span><b>${game.restaurant.pawned ? "已领取" : money(info.pawn)}</b></div></div>
          <div class="restaurant-progress ${game.restaurant.open ? "" : "is-stopped"}" data-restaurant-progress><div><span>下一次结算</span><em>${game.restaurant.pawned ? "已停止" : game.restaurant.open ? `${worldMinutesRemaining} 游戏分钟后` : "餐厅已打烊"}</em></div><i><b style="width:${game.restaurant.open ? progress * 100 : 0}%"></b></i></div>
          <div class="restaurant-actions">${!game.restaurant.open && !game.restaurant.pawned ? `<button class="primary" data-action="continue-restaurant">继续营业 · 至下次打烊</button>` : ""}<button class="primary" data-action="upgrade" ${game.restaurant.pawned || max || game.cash < (info.nextCost ?? 0) ? "disabled" : ""}>${max ? "已达最高等级" : `升级 · ${money(info.nextCost!)}`}</button><button class="danger" data-action="pawn" ${game.restaurant.pawned ? "disabled" : ""}>典当 · 获得 ${money(info.pawn)}</button></div>
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
        ${casinos.map((casino, index) => `<button class="casino-scene-choice ${casino.tone} casino-scene-choice-${index + 1}" data-casino="${casino.id}" ${game.cash < casino.entryFee ? "disabled" : ""}><span class="casino-scene-number">0${index + 1}</span><div><span>${casino.subtitle}</span><strong>${casino.name}</strong></div><dl><div><dt>门票</dt><dd>${money(casino.entryFee)}</dd></div><div><dt>牌桌</dt><dd>${casino.tableCount} 张</dd></div><div><dt>注码</dt><dd>${money(casino.minBet)} - ${money(casino.maxBet)}</dd></div></dl><b>${game.cash < casino.entryFee ? `现金不足 · 门票 ${money(casino.entryFee)}` : "支付门票进入"}</b></button>`).join("")}
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
    <div class="table-shape"><span>庄</span><b>和</b><span>闲</span></div>
    ${roadSheet(table, false, false, "expanded")}
    <div class="table-meta"><span class="pattern ${pattern.id !== "none" ? "active" : ""}">${pattern.name}</span><span>${money(casino.minBet)} - ${money(casino.maxBet)}</span></div>
  `;
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

function tableView(): string {
  const casino = casinos.find((item) => item.id === casinoId)!;
  const table = game.table(tableId);
  const watchPending = inlineWatchActive ? game.pending ?? lastRound : null;
  const watchResult = inlineWatchSettled ? watchPending?.result ?? null : null;
  const stagedAmount = game.reservedBetAmount;
  const denominations = chipDenominations(casino);
  if (!denominations.includes(selectedChip)) selectedChip = denominations[0] ?? casino.minBet;
  const markedPatterns = game.markedRoadPatterns(table.id);
  const markedBookCount = markedRoadBookCount(table.id);
  const createdRoads = game.roadCreationSequence(table.id);
  const createdRoad = createdRoads[0] ?? null;
  const recognizedPatternList = markedPatterns.length
    ? `<div class="recognized-pattern-list">${markedPatterns.map((pattern) => `<span><b>${pattern.name}</b><i>预测${outcomeName(pattern.prediction)}</i></span>`).join("")}</div>`
    : "";
  const roadFeedback = roadMarkFeedback
    ? `<div class="road-mark-feedback" role="status"><span>${roadMarkFeedback.message}</span><code>DEBUG · ${roadMarkFeedback.debug}</code></div>`
    : "";
  const confidenceMessage = !stagedBetSide
    ? createdRoad ? `预想下一局${outcomeName(createdRoad)} · 信心待封盘结算` : "路数预判待定 · 信心待封盘结算"
    : `已押${outcomeName(stagedBetSide)} · 确认下注后才揭示信心变化`;
  const zone = (side: Outcome, english: string, odds: string) => {
    const active = stagedBetSide === side && stagedAmount > 0;
    return `<button class="table-bet-zone ${side} ${active ? "has-wager" : ""}" data-bet-zone="${side}" aria-label="在${outcomeName(side)}区下注 ${money(selectedChip)}" ${inlineWatchActive ? "disabled" : ""}>
      <span><b>${outcomeName(side)}</b><em>${english}</em><i>${odds}</i></span>
      ${active ? `<span class="zone-wager"><i></i><i></i><i></i><strong>${money(stagedAmount)}</strong></span>` : ""}
    </button>`;
  };
  const canConfirm = Boolean(stagedBetSide) && stagedAmount >= casino.minBet && stagedAmount <= casino.maxBet;
  return shell(`
    <section class="table-page">
      <div class="table-header table-header-status"><span class="round-count">第 ${inlineWatchSettled ? table.round : table.round + 1} 局</span></div>
      <div class="table-layout">
        <section class="betting-panel ${inlineWatchActive ? "inline-watching" : ""}">
          <div class="table-felt ${inlineWatchActive ? "watch-active" : ""}">
            <div class="table-session-meta"><span>${inlineWatchActive ? `旁观牌局 · ${inlineWatchStatus(watchPending!)}` : `限红 ${money(casino.minBet)} - ${money(casino.maxBet)}`}</span></div>
            <div class="dealer-apron ${inlineWatchActive ? "inline-watch-apron" : ""}">${inlineWatchActive ? `${inlineWatchHand(watchPending!, "player")}<strong>${inlineWatchStatus(watchPending!)}</strong>${inlineWatchHand(watchPending!, "banker")}` : `<div class="table-hand-placement player"><span>PLAYER</span><i></i><i></i></div><span class="dealer-apron-gap" aria-hidden="true"></span><div class="table-hand-placement banker"><span>BANKER</span><i></i><i></i></div>`}</div>
            <div class="bet-zones">${zone("player", "PLAYER", "1:1")}${zone("tie", "TIE", "1:8")}${zone("banker", "BANKER", "1:0.95")}</div>
            ${watchResult ? `<div class="inline-watch-result ${watchResult.outcome}" data-action="dismiss-settlement" role="button" tabindex="0" aria-label="关闭旁观结算"><i>${watchResult.outcome === "tie" ? "和" : outcomeName(watchResult.outcome)}</i><span>旁观结算</span><h2>${watchResult.outcome === "tie" ? "本局和局" : `${outcomeName(watchResult.outcome)}家胜`}</h2><p>庄 ${watchResult.bankerPoints} 点 · 闲 ${watchResult.playerPoints} 点</p><small>点击任意位置返回牌桌</small></div>` : ""}
          </div>
          <div class="bet-controls">
            <div class="chip-console">
              <div class="chip-tray" aria-label="筹码面额">${denominations.map((amount, index) => `<button class="bet-chip chip-${index + 1} ${selectedChip === amount ? "selected" : ""}" data-chip="${amount}" aria-label="选择${money(amount)}筹码" ${inlineWatchActive ? "disabled" : ""}><span>${amount >= 1000 ? `${amount / 1000}K` : amount}</span></button>`).join("")}</div>
              ${inlineWatchActive ? "" : stagedAmount > 0 ? `<div class="bet-command-bar">
                <button class="secondary" data-action="cancel-bet"><span>↶</span>取消</button>
                <button class="primary" data-action="confirm-bet" ${canConfirm ? "" : "disabled"}><span>✓</span>确认</button>
              </div>` : `<div class="bet-command-bar single-action"><button class="secondary chip-watch-action" data-action="watch">旁观本局</button></div>`}
            </div>
            <div class="confidence-readout"><span>当前信心 ${Math.round(game.confidence * 100)}%</span><strong>${confidenceMessage}</strong></div>
          </div>
        </section>
        <aside class="road-panel"><div class="panel-title"><h2>牌路</h2><div class="road-mark-actions">${createdRoad ? `<span class="road-creation-status active">已创造 ${createdRoads.length} 局 · 下一局${outcomeName(createdRoad)}</span>` : ""}${markedBookCount ? `<span class="pattern active">已标记 ${markedBookCount} 路 · DEBUG 有效 ${markedPatterns.length} 路</span><button class="clear-road-marks" data-action="clear-road-marks">全清标记</button>` : ""}</div></div>${roadFeedback}${recognizedPatternList}${roadSheet(table, false, !inlineWatchActive, "expanded")}</aside>
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

function forecastLabel(forecast: BaccaratRevealForecast, pending: PendingRound): { label: string; className: string } {
  if (forecast.kind === "pending") return { label: "待定", className: "pending" };
  if (forecast.kind === "draw") return { label: `${outcomeName(forecast.side)}补牌`, className: "draw" };
  if (forecast.outcome === "tie") {
    return pending.bet?.side === "tie" ? { label: "赢", className: "win" } : { label: "和", className: "tie" };
  }
  if (!pending.bet) return { label: `${outcomeName(forecast.outcome)}赢`, className: forecast.outcome };
  return forecast.outcome === pending.bet.side ? { label: "赢", className: "win" } : { label: "输", className: "lose" };
}

interface ForecastRankCandidate {
  labels: string[];
  value: number;
  faceGroup?: boolean;
}

interface ForecastRankGroup {
  candidates: ForecastRankCandidate[];
  result: ReturnType<typeof forecastLabel>;
}

const forecastRankCandidates: ForecastRankCandidate[] = [
  { labels: ["A"], value: 1 },
  ...Array.from({ length: 8 }, (_, index) => ({ labels: [String(index + 2)], value: index + 2 })),
  { labels: ["10", "J", "Q", "K"], value: 0, faceGroup: true },
];

function forecastRankLabel(group: ForecastRankGroup): string {
  const labels = group.candidates.flatMap((candidate) => candidate.labels);
  if (labels.length === 13) return "全牌型";
  const includesFaceCards = group.candidates.some((candidate) => candidate.faceGroup);
  if (includesFaceCards && labels.length === 4) return "10/J/Q/K";
  if (includesFaceCards) return `${labels[0]}-K`;
  if (labels.length === 1) return labels[0]!;
  return `${labels[0]}-${labels.at(-1)}`;
}

function currentCardForecast(pending: PendingRound): string {
  if (!SHOW_LAST_CARD_FORECAST) return "";
  if (dealStage === "settled" || dealStage === "animating" || dealStage === "drawing-card") return "";
  const remaining = Array.from({ length: dealtCardCount }, (_, index) => index).filter((index) => !revealedCardIndices.has(index));
  if (remaining.length !== 1) return "";
  const index = remaining[0]!;
  const entry = dealSequence(pending)[index]!;
  const player = revealedHandInfo(pending, "player").values;
  const banker = revealedHandInfo(pending, "banker").values;
  const groups = forecastRankCandidates.reduce<ForecastRankGroup[]>((result, candidate) => {
    const forecast = forecastLabel(forecastBaccaratReveal(player, banker, entry.side, entry.handIndex, candidate.value), pending);
    const previous = result.at(-1);
    const sameResult = previous?.result.label === forecast.label && previous.result.className === forecast.className;
    const canMerge = sameResult;
    if (canMerge) previous!.candidates.push(candidate);
    else result.push({ candidates: [candidate], result: forecast });
    return result;
  }, []);
  const firstGroup = groups[0];
  const allSameResult = firstGroup && groups.every((group) => group.result.label === firstGroup.result.label && group.result.className === firstGroup.result.className);
  if (allSameResult && groups.length > 1) {
    groups.splice(0, groups.length, { candidates: groups.flatMap((group) => group.candidates), result: firstGroup.result });
  }
  const values = groups.map((group) => {
    const ranks = forecastRankLabel(group);
    return `<div class="forecast-value ${group.result.className} ${group.candidates.some((candidate) => candidate.faceGroup) ? "face-group" : ""}" aria-label="${ranks}：${group.result.label}"><b>${ranks}</b><span>${group.result.label}</span></div>`;
  }).join("");
  const perspective = pending.bet ? `以押${outcomeName(pending.bet.side)}判定` : "旁观判定";
  return `<section class="card-forecast"><header><div><span>末张判势</span><strong>开${outcomeName(entry.side)}家第 ${entry.handIndex + 1} 张</strong></div><small>${perspective}</small></header><div class="forecast-values" style="--forecast-count:${groups.length}">${values}</div></section>`;
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
    : `<span>无额外修正</span>`}<strong>封盘 ${Math.round(pending.confidence * 100)}%</strong></div>`;
}

function dealingView(): string {
  const pending = game.pending ?? lastRound!;
  const table = game.table(tableId);
  const sequence = dealSequence(pending);
  const isWatching = pending.bet === null;
  const result = dealStage === "settled" ? pending.result : null;
  const confidenceFeedback = `封盘结算 · ${Math.round(pending.confidence * 100)}%`;
  const delta = lastSettlement?.delta ?? 0;
  const betFeedback = !pending.bet ? "旁观完成" : result?.outcome === pending.bet.side ? `押中${outcomeName(pending.bet.side)}` : result?.outcome === "tie" ? "和局退注" : `押${outcomeName(pending.bet.side)}未中`;
  const settlementKind = !pending.bet ? "watch" : result?.outcome === pending.bet.side ? "hit" : result?.outcome === "tie" ? "push" : "miss";
  const settlementSeal = settlementKind === "hit" ? "中" : settlementKind === "miss" ? "负" : settlementKind === "push" ? "和" : "看";
  const settlementAmount = settlementKind === "hit" ? `盈利 +${money(delta)}` : settlementKind === "miss" ? `损失 -${money(Math.abs(delta))}` : settlementKind === "push" ? "本金已退回" : "本局未下注";
  const chipSettlementKind = !pending.bet ? null : pending.result.outcome === pending.bet.side ? "win" : pending.result.outcome === "tie" ? "push" : "lose";
  const chipTransferLabel = chipSettlementKind === "win" ? `荷官赔付 · +${money(Math.max(0, delta))}` : chipSettlementKind === "lose" ? `荷官收注 · ${money(pending.bet?.amount ?? 0)}` : chipSettlementKind === "push" ? "和局退注 · 本金返还" : "";
  const statusTitle = dealStage === "settled" ? result!.outcome === "tie" ? "和局" : `${outcomeName(result!.outcome)}家胜` : dealStage === "settling-chips" ? chipTransferLabel : dealStage === "animating" ? "荷官发牌" : dealStage === "drawing-card" ? `${outcomeName(sequence[dealtCardCount - 1]!.side)}家补牌` : dealStage === "dealer-revealing" ? "荷官开牌" : `剩余 ${dealtCardCount - revealedCardIndices.size} 张未开`;
  return shell(`
    <section class="table-page table-dealing immersive-dealing ${dealStage}">
      <div class="table-header table-header-status"><span class="round-count">第 ${dealStage === "settled" || dealStage === "settling-chips" ? table.round : table.round + 1} 局</span></div>
      <div class="table-layout">
        <section class="betting-panel live-deal-panel">
          <div class="deal-status"><div class="deal-status-title"><p class="eyebrow">${dealStage === "settled" ? betFeedback : isWatching ? "旁观牌局" : `已押${outcomeName(pending.bet!.side)} · ${money(pending.bet!.amount)}`}</p><h1>${statusTitle}</h1></div>${dealStage === "settled" ? "" : liveBaccaratScore(pending)}<span>${dealStage === "settled" ? `庄 ${result!.bankerPoints} 点 · 闲 ${result!.playerPoints} 点` : pending.bet ? confidenceFeedback : "本局全部由荷官开牌 · 信心不变"}</span>${dealStage !== "settled" ? confidenceBreakdownView(pending) : ""}</div>
          <div class="immersive-table-stage">
            <div id="table-3d-stage" aria-label="3D百家乐牌桌"></div>
            ${pending.bet && dealStage !== "settling-chips" ? `<div class="active-bet-marker ${pending.bet.side}"><i></i><span>押${outcomeName(pending.bet.side)}</span><strong>${money(pending.bet.amount)}</strong></div>` : ""}
            ${dealStage === "settling-chips" ? `<div class="chip-transfer-callout ${chipSettlementKind}"><span>${chipSettlementKind === "win" ? "PAYOUT" : chipSettlementKind === "lose" ? "COLLECT" : "PUSH"}</span><strong>${chipTransferLabel}</strong></div>` : ""}
            ${dealStage === "settled" ? `<div class="table-settlement ${settlementKind}" data-action="dismiss-settlement" role="button" tabindex="0" aria-label="关闭结算"><section class="settlement-verdict"><i>${settlementSeal}</i><span>本局 ${outcomeName(result!.outcome)}${result!.outcome === "tie" ? "局" : "家胜"}</span><b>${betFeedback}</b><strong>${settlementAmount}</strong>${pending.bet ? `<small>押${outcomeName(pending.bet.side)} · ${money(pending.bet.amount)}</small>` : ""}${lastSettlement?.income ? `<em>餐厅同期到账 +${money(lastSettlement.income)}</em>` : ""}</section><div class="settlement-hands"><div><span>庄家 · ${result!.bankerPoints} 点</span><strong>${result!.bankerCards.map(cardLabel).join(" · ")}</strong></div><div><span>闲家 · ${result!.playerPoints} 点</span><strong>${result!.playerCards.map(cardLabel).join(" · ")}</strong></div></div><small class="settlement-dismiss-hint">点击任意位置返回牌桌</small></div>` : ""}
          </div>
        </section>
      </div>
    </section>
  `);
}

function gameOverView(): string {
  return shell(`
    <section class="game-over-page">
      <p class="eyebrow">所有筹码与家底均已耗尽</p>
      <div class="game-over-mark">终局</div>
      <h1>赌桌不再赊账</h1>
      <p>餐厅已经典当，可用资金归零。本次试炼到此结束。</p>
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
  const cashControl = `<section class="debug-cash-control"><div><span>当前资金</span><strong>${money(game.cash)}</strong></div><div><button type="button" data-debug-cash-adjust="-100000" ${game.cash <= 0 ? "disabled" : ""}>扣钱 -100,000</button><button type="button" data-debug-cash-adjust="100000">加钱 +100,000</button></div></section>`;
  overlay.innerHTML = `<section class="debug-menu" role="dialog" aria-modal="true" aria-label="测试调试菜单"><header><div><span>TEST TOOLS</span><h2>测试调试</h2></div><button type="button" data-debug-close aria-label="关闭调试菜单">×</button></header><div class="debug-menu-body"><div class="debug-row debug-confidence-control"><div><strong>基础信心</strong><small>路数、下注和连胜仍会参与最终结算。</small></div><output data-debug-base-confidence-value>${basePercent}%</output><div class="debug-slider-row"><input type="range" min="0" max="100" value="${basePercent}" style="--debug-confidence:${basePercent}%" data-debug-base-confidence aria-label="调整基础信心"><div><span>0%</span><span>50%</span><span>100%</span></div></div><label class="debug-switch"><input type="checkbox" data-debug-confidence-lock ${game.debugConfidenceForced ? "checked" : ""}><i></i><span>锁定 100% 信心</span></label></div><section class="debug-settings"><h3>经营与时间</h3>${debugNumberField("餐厅周期收益", "当前等级每次结算实际到账", "restaurantIncomePerCycle", config.restaurantIncomePerCycle, 0, 100, "元")}${debugNumberField("餐厅结算周期", "按游戏世界时间累计", "restaurantCycleWorldMinutes", config.restaurantCycleWorldMinutes, 1, 1, "游戏分钟")}${debugNumberField("赌场外时间流速", "每 1 个现实秒推进的游戏时间", "worldMinutesPerRealSecondOutsideCasino", config.worldMinutesPerRealSecondOutsideCasino, 0, 1, "游戏分钟/秒")}${debugNumberField("赌场内时间流速", "每 1 个现实秒推进的游戏时间", "worldMinutesPerRealSecondInsideCasino", config.worldMinutesPerRealSecondInsideCasino, 0, 0.1, "游戏分钟/秒")}</section><section class="debug-settings"><h3>睡眠与疲劳</h3>${debugNumberField("每日睡眠债务", "每天 00:00 新增", "sleepDebtPerMidnightWorldMinutes", config.sleepDebtPerMidnightWorldMinutes / 60, 0, 0.5, "小时", 60)}${debugNumberField("疲劳触发阈值", "累计达到该数值后进入睡眠不足", "sleepDebtThresholdWorldMinutes", config.sleepDebtThresholdWorldMinutes / 60, 1 / 60, 0.5, "小时", 60)}</section></div><footer><div><span>${game.debugConfidenceForced ? "锁定覆盖已启用" : "当前总信心"}</span><strong data-debug-confidence-value>${confidencePercent}%</strong></div><button class="debug-reset-all" type="button" data-debug-reset-all>恢复全部默认</button><small>按 ESC 关闭</small></footer></section>`;
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
      }
      renderDebugMenu();
    });
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
  lastRound = pending;
  lastSettlement = game.settle();
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
  const host = document.querySelector<HTMLElement>("#table-3d-stage");
  if (!host) return;
  tableScene = new TableScene(host);
  const sequence = dealSequence(pending);
  const animateFromIndex = dealStage === "animating" ? 0 : dealStage === "drawing-card" ? dealtCardCount - 1 : null;
  tableScene.deal(sequence.slice(0, dealtCardCount), revealedCardIndices, () => {
    if (pending.bet) {
      dealStage = "awaiting-card";
      render();
    } else {
      dealStage = "dealer-revealing";
      render();
    }
  }, animateFromIndex, playerOwnedSide(pending));
  if (dealStage === "awaiting-card" && pending.bet) {
    const selectable = unrevealedDealtCardIndices(dealtCardCount, revealedCardIndices);
    tableScene.setCardSelection(selectable, selectCardForReveal);
  }
  const denominations = chipDenominations(casino);
  const recordedWagerTotal = roundWagerChips.reduce((sum, chip) => sum + chip.value, 0);
  const wagerChips = pending.bet && recordedWagerTotal === pending.bet.amount
    ? roundWagerChips
    : composeChipAmount(pending.bet?.amount ?? 0, denominations);
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

function selectCardForReveal(index: number): void {
  const pending = game.pending;
  if (!pending?.bet || dealStage !== "awaiting-card" || index >= dealtCardCount || revealedCardIndices.has(index) || !tableScene) return;
  const entry = dealSequence(pending)[index];
  if (!entry) return;
  const ownedSide = playerOwnedSide(pending);
  tableScene.focus(index, () => {
    if (cardRevealActor(entry.side, ownedSide) === "self") beginSqueeze(index, armDivineAssist(index));
    else revealFocusedCardByDealer(index);
  });
}

function finishReveal(index: number): void {
  revealedCardIndices.add(index);
  advanceAfterCurrentCards();
}

function finishRevealWhileFocused(index: number): void {
  revealedCardIndices.add(index);
  const feedback = divineRevealFeedback.get(index);
  const returnToTable = () => tableScene?.returnToTable(advanceAfterCurrentCards);
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

function startDivineGame(index: number, target: Outcome): void {
  tablePlayerInteractionActive = true;
  const activation = document.createElement("div");
  activation.className = "divine-activation";
  activation.innerHTML = `<div class="divine-activation-lines"></div><strong>这张牌！我感觉到了！！</strong>`;
  document.body.append(activation);
  document.body.classList.add("divine-activation-active");
  if ("vibrate" in navigator) navigator.vibrate([50, 24, 72, 28, 96]);
  window.setTimeout(() => {
    activation.remove();
    document.body.classList.remove("divine-activation-active");
    chooseDivineCardType(index, target);
  }, 1000);
}

function chooseDivineCardType(index: number, target: Outcome): void {
  const overlay = document.createElement("div");
  overlay.className = "divine-choice-overlay";
  const choices: { type: DivineCardType; label: string; detail: string }[] = [
    { type: "face", label: "公", detail: "人头牌" }, { type: "no-edge", label: "没边", detail: "A" },
    { type: "two-edge", label: "两边", detail: "2 · 3" }, { type: "three-edge", label: "三边", detail: "4 · 5 · 6" },
    { type: "four-edge", label: "四边", detail: "7 · 8 · 9" },
  ];
  overlay.innerHTML = `<section><span>神助一阶段 · 锁定牌型</span><h2>这张牌，要什么？</h2><p>选定牌型后，以连点挤牌把它挤出来。</p><div>${choices.map((choice) => `<button data-divine-type="${choice.type}"><b>${choice.label}</b><small>${choice.detail}</small></button>`).join("")}</div></section>`;
  document.body.append(overlay);
  overlay.querySelectorAll<HTMLButtonElement>("[data-divine-type]").forEach((button) => button.addEventListener("click", () => {
    const type = button.dataset.divineType as DivineCardType;
    overlay.remove();
    runDivineMash(index, type, "short", (hit) => {
      if (hit && game.pending!.result.outcome === target) {
        divineRevealFeedback.set(index, { hit: true, target, probability: .72 });
        tableScene?.setCard(index, dealSequence(game.pending!)[index]!.card);
        tablePlayerInteractionActive = false;
        tableScene?.quickSqueeze();
        return;
      }
      chooseDivineCall(index, target);
    });
  }));
}

function chooseDivineCall(index: number, target: Outcome): void {
  const overlay = document.createElement("div");
  overlay.className = "divine-choice-overlay";
  overlay.innerHTML = `<section><span>神助二阶段 · 定下点数</span><h2>吸，还是吹？</h2><p>再挤一次，把胜局锁住。</p><div><button data-divine-call="draw"><b>吸</b><small>向上补点</small></button><button data-divine-call="blow"><b>吹</b><small>压低点数</small></button></div></section>`;
  document.body.append(overlay);
  overlay.querySelectorAll<HTMLButtonElement>("[data-divine-call]").forEach((button) => button.addEventListener("click", () => {
    overlay.remove();
    runDivineMash(index, button.dataset.divineCall as "draw" | "blow", "long", (hit) => {
      divineRevealFeedback.set(index, { hit, target, probability: .78 });
      tableScene?.setCard(index, dealSequence(game.pending!)[index]!.card);
      tablePlayerInteractionActive = false;
      tableScene?.quickSqueeze();
    });
  }));
}

interface DivineShoutRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function randomDivineShoutPosition(fontSize: number): { x: number; y: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const horizontalMargin = Math.max(width * 0.1, Math.min(fontSize * 1.35, width * 0.3));
  const verticalMargin = Math.max(height * 0.18, fontSize * 0.7);
  const safe = { left: horizontalMargin, top: verticalMargin, right: width - horizontalMargin, bottom: height - verticalMargin };
  const card = tableScene?.activeCardScreenBounds() ?? { left: width * 0.38, top: height * 0.25, right: width * 0.62, bottom: height * 0.75 };
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

function runDivineMash(index: number, choice: DivineCardType | "draw" | "blow", edge: "short" | "long", done: (hit: boolean) => void): void {
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
      const entry = dealSequence(game.pending!)[index]!;
      const hit = choice === "draw" || choice === "blow"
        ? game.applyDivineCall(entry.side, entry.handIndex, choice)
        : game.applyDivineCardType(entry.side, entry.handIndex, choice);
      overlay.remove();
      if (edge === "short") tableScene?.resetDivineMash();
      done(hit);
    };
    overlay.addEventListener("click", () => {
      if (finished) return;
      progress = Math.min(completionProgress, progress + clickAdvance);
      tableScene?.divineMashStep(edge, progress);
      const progressRatio = progress / completionProgress;
      const randomScale = 0.78 + Math.random() * 0.4;
      const maximumSize = Math.min(window.innerWidth * 0.24, window.innerHeight * 0.15);
      const fontSize = Math.max(34, Math.min((34 + progressRatio * 82) * randomScale, maximumSize));
      const position = randomDivineShoutPosition(fontSize);
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
      tableScene?.divineMashStep(edge, progress);
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

function advanceAfterCurrentCards(): void {
  const pending = game.pending!;
  const currentCardsAreOpen = Array.from({ length: dealtCardCount }, (_, index) => index)
    .every((index) => revealedCardIndices.has(index));
  if (!currentCardsAreOpen) {
    render();
    return;
  }
  const sequence = dealSequence(pending);
  if (dealtCardCount < sequence.length) {
    dealtCardCount += 1;
    dealStage = "drawing-card";
    render();
    return;
  }
  settleOnTable();
}

function revealNextAutomatically(): void {
  const pending = game.pending;
  if (!pending || !tableScene) return;
  const index = automaticRevealOrder(pending).find((candidate) => !revealedCardIndices.has(candidate));
  if (index === undefined) {
    advanceAfterCurrentCards();
    return;
  }
  tableScene.focus(index, () => revealFocusedCardByDealer(index));
}

function revealFocusedCardByDealer(index: number): void {
  const assist = armDivineAssist(index);
  if (assist) {
    tableScene?.beginSqueeze(index, () => undefined, () => finishRevealWhileFocused(index));
    startDivineGame(index, assist.target);
    return;
  }
  tableScene?.revealFocusedByDealer(index, () => {
    finishReveal(index);
  });
}

function beginSqueeze(index: number, assist: ArmedDivineAssist | null): void {
  if (assist) {
    tableScene?.beginSqueeze(index, () => undefined, () => finishRevealWhileFocused(index));
    startDivineGame(index, assist.target);
    return;
  }
  const tableStage = document.querySelector<HTMLElement>(".immersive-table-stage")!;
  tableStage.classList.add("squeeze-active");
  const overlay = document.createElement("div");
  const forecast = currentCardForecast(game.pending!);
  overlay.className = "table-squeeze-ui";
  overlay.innerHTML = `
    <div class="squeeze-direction-hints" aria-hidden="true">
      <i class="squeeze-direction-arrow long-edge"></i>
      <i class="squeeze-direction-arrow corner"></i>
      <i class="squeeze-direction-arrow short-edge"></i>
    </div>
    <div class="table-squeeze-controls ${forecast ? "has-forecast" : ""}">
      ${forecast}
      <button class="secondary" data-squeeze-quick>快速开牌</button>
    </div>`;
  tableStage.append(overlay);
  tableScene!.beginSqueeze(index, (progress) => {
    overlay.classList.toggle("interacting", progress > 0.01);
    if (progress >= 1) overlay.classList.add("settling");
  }, () => {
    tableStage.classList.remove("squeeze-active");
    overlay.remove();
    finishRevealWhileFocused(index);
  });
  overlay.querySelector<HTMLElement>("[data-squeeze-quick]")!.addEventListener("click", () => tableScene?.quickSqueeze());
}

function bind(): void {
  app.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => {
    const action = element.dataset.action;
    const navigationAction = Boolean(action && ["map", "restaurant", "skills", "casinos", "lobby"].includes(action));
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
    if (action === "pawn" && confirm(`典当后餐厅将停止产出。确认典当并获得 ${money(game.restaurantInfo().pawn)}？`)) game.pawnRestaurant();
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
    if (action === "dismiss-road-creation-failure") roadCreationFailure = null;
    if (action === "cancel-bet") {
      game.cancelReservedBet();
      stagedBetSide = null;
      stagedBetChips = [];
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
      view = "table";
    }
    if (action === "confirm-bet" && stagedBetSide && game.reservedBetAmount > 0) {
      roadCreationFailure = null;
      roundWagerChips = [...stagedBetChips];
      game.play(tableId, { side: stagedBetSide, amount: game.reservedBetAmount });
      resetBetDraft(false);
      revealedCardIndices.clear(); divineCheckedStages.clear(); divineRevealFeedback.clear(); divineActivationsThisRound = 0; divineSpecialPending = false; tablePlayerInteractionActive = false; dealtCardCount = 4; dealStage = "animating"; view = "dealing";
    }
    if (action === "dismiss-settlement") {
      if (inlineWatchActive) resetInlineWatch();
      else tablePlayerInteractionActive = false;
      dealStage = "animating";
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
    if (!game.enterCasino(selectedCasinoId)) {
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
    selectedChip = casino.minBet;
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

  app.querySelectorAll<HTMLElement>("[data-chip]").forEach((element) => element.addEventListener("click", () => {
    selectedChip = Number(element.dataset.chip);
    render();
  }));
  app.querySelectorAll<HTMLElement>("[data-bet-zone]").forEach((element) => element.addEventListener("click", () => {
    const side = element.dataset.betZone as Outcome;
    const casino = casinos.find((item) => item.id === casinoId)!;
    if (stagedBetSide && stagedBetSide !== side) {
      render();
      return;
    }
    if (game.reservedBetAmount + selectedChip > casino.maxBet) {
      render();
      return;
    }
    if (!game.reserveBetChip(selectedChip)) {
      render();
      return;
    }
    stagedBetSide = side;
    stagedBetChips.push({ value: selectedChip, colorIndex: chipDenominations(casino).indexOf(selectedChip) });
    render();
  }));

  const restChoiceBackdrop = app.querySelector<HTMLElement>("[data-rest-choice-backdrop]");
  restChoiceBackdrop?.addEventListener("click", (event) => {
    if (event.target !== restChoiceBackdrop) return;
    restChoiceOpen = false;
    render();
  });
}

render();

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  debugMenuOpen = !debugMenuOpen;
  renderDebugMenu();
});

window.setInterval(() => {
  const atTable = view === "table" || view === "dealing";
  const insideCasino = activeActivity === "casino";
  const paused = worldTimePaused();
  const tick = game.tickRealtime(Date.now(), atTable ? tableId : null, insideCasino, paused, activeActivity === "restaurant");
  if (tick.income > 0) game.notice = `餐厅到账 ${money(tick.income)}`;
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
