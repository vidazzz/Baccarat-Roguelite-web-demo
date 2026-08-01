import "./style.css";
import { cardLabel, cardValue, divineCallForRound, forecastBaccaratReveal, isRedCard, makeBeadPlate, makeBigRoad, makeDerivedRoads, pipLayout, predictRoadColors, rankLabel, suitSymbol, type BaccaratRevealForecast, type Card, type DerivedRoadCell, type Outcome, type RoadBook, type Side } from "./domain";
import { casinos, Game, LOBBY_ROUND_MS, MAX_SKILL_LEVEL, RESTAURANT_CYCLE_WORLD_MINUTES, inlineWatchSteps, skillDefinitions, type Casino, type GameTable, type PendingRound, type SkillId } from "./game";
import { TableScene } from "./table-scene";

type View = "home" | "restaurant" | "skills" | "casino-select" | "lobby" | "table" | "dealing" | "game-over";
type DealStage = "animating" | "drawing-card" | "awaiting-card" | "dealer-revealing" | "settled";

const game = new Game();
const app = document.querySelector<HTMLDivElement>("#app")!;
let view: View = "home";
let casinoId = casinos[0]!.id;
let tableId = "harbor-1";
let stagedBetSide: Outcome | null = null;
let selectedChip = 100;
let betDraftNotice = "选择筹码后，点击下注区落注";
let tableScene: TableScene | null = null;
let lastSettlement: { delta: number; income: number } | null = null;
let lastRound: PendingRound | null = null;
let viewTimers: number[] = [];
let dealStage: DealStage = "animating";
let revealedCardIndices = new Set<number>();
let divineCheckedStages = new Set<number>();
let divineRevealFeedback = new Map<number, { hit: boolean; target: Outcome; probability: number }>();
let dealtCardCount = 4;
let debugMenuOpen = false;
let tablePlayerInteractionActive = false;
let inlineWatchActive = false;
let inlineWatchStep = 0;
let inlineWatchSettled = false;
let roadMarkFeedback: { message: string; debug: string } | null = null;

const money = (value: number) => `¥${Math.floor(value).toLocaleString("zh-CN")}`;
const outcomeName = (outcome: Outcome) => ({ banker: "庄", player: "闲", tie: "和" })[outcome];
const chipDenominations = (casino: Casino) => [1, 2, 5, 10, 20].map((multiple) => casino.minBet * multiple).filter((value) => value <= casino.maxBet);
const roadBooks: RoadBook[] = ["bead", "big", "big-eye", "small", "cockroach"];
const markedRoadBookCount = (currentTableId: string) => roadBooks.filter((roadBook) => game.roadMark(currentTableId, roadBook)).length;

function resetBetDraft(refund = true): void {
  if (refund) game.cancelReservedBet();
  stagedBetSide = null;
  betDraftNotice = "选择筹码后，点击下注区落注";
}
const worldTimeLabel = () => {
  const { day, hour, minute } = game.worldTimeInfo();
  return `第 ${day} 日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};
const worldTimePaused = () => view === "table"
  || (view === "dealing" && (dealStage === "awaiting-card" || dealStage === "settled" || tablePlayerInteractionActive))
  || (debugMenuOpen && view === "dealing");

function shell(content: string): string {
  return `
    <header class="topbar">
      <button class="brand" data-action="home" aria-label="返回总览">澳门风云</button>
      <nav>
        <button data-action="restaurant" class="nav-btn">餐厅</button>
        <button data-action="skills" class="nav-btn">技能</button>
        <button data-action="casinos" class="nav-btn">赌场</button>
      </nav>
      <div class="world-clock ${worldTimePaused() ? "paused" : ""}"><span>世界时间</span><strong data-world-clock>${worldTimeLabel()}</strong></div>
      <div class="confidence"><span>信心</span><strong>${Math.round(game.confidence * 100)}%</strong></div>
      <div class="wallet"><span>可用现金</span><strong>${money(game.cash)}</strong></div>
    </header>
    <main>${content}</main>
  `;
}

function roadMarkOverlay(table: GameTable, roadBook: RoadBook, visibleFrom: number, columns: number): string {
  const mark = game.roadMark(table.id, roadBook);
  if (!mark || mark.startColumn >= visibleFrom + columns) return "";
  const start = roadBook === "bead" ? 0 : Math.max(0, mark.startColumn - visibleFrom);
  return `<span class="road-mark-range" style="--mark-start:${start}"></span>`;
}

function road(table: GameTable, compact = false, interactive = false): string {
  const cells = makeBigRoad(table.history);
  const maxColumn = Math.max(...cells.map((cell) => cell.column), 0);
  const columns = compact ? 12 : 28;
  const visibleFrom = Math.max(0, maxColumn - columns + 1);
  return `<div class="road ${compact ? "compact" : ""} ${interactive ? "markable-road" : ""}" aria-label="${table.name} 大路" ${interactive ? `data-road-book="big" data-visible-from="${visibleFrom}" data-columns="${columns}"` : ""}>${roadMarkOverlay(table, "big", visibleFrom, columns)}${cells
    .filter((cell) => cell.column >= visibleFrom)
    .map((cell) => `<span class="road-dot ${cell.outcome} ${cell.ties ? "has-tie" : ""}" style="--row:${cell.row};--col:${cell.column - visibleFrom}">${cell.ties ? `<i>${cell.ties > 1 ? cell.ties : ""}</i>` : ""}</span>`)
    .join("")}</div>`;
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
  const maxColumn = Math.max(...cells.map((cell) => cell.column), 0);
  const columns = compact ? 12 : 18;
  const visibleFrom = Math.max(0, maxColumn - columns + 1);
  return `<div class="derived-block ${kind}"><div class="derived-label"><i class="road-symbol ${kind} red"></i>${label}</div><div class="derived-road ${compact ? "compact" : ""} ${interactive ? "markable-road" : ""}" style="--columns:${columns}" aria-label="${label}" ${interactive ? `data-road-book="${roadBook}" data-visible-from="${visibleFrom}" data-columns="${columns}"` : ""}>${roadMarkOverlay(table, roadBook, visibleFrom, columns)}${cells.filter((cell) => cell.column >= visibleFrom).map((cell) => `<span class="derived-mark ${cell.color}" style="--row:${cell.row};--col:${cell.column - visibleFrom}"></span>`).join("")}</div></div>`;
}

function roadQuestions(table: GameTable): string {
  const banker = predictRoadColors(table.history, "banker");
  const player = predictRoadColors(table.history, "player");
  const mark = (color: "red" | "blue" | undefined, kind: DerivedRoadKind) => `<i class="road-symbol ${kind} ${color ?? "empty"}"></i>`;
  const row = (label: string, values: typeof banker, side: Side) => `<div class="question-row ${side}"><b>${label}</b><span>${mark(values.bigEye, "big-eye")}${mark(values.small, "small-road")}${mark(values.cockroach, "cockroach-road")}</span></div>`;
  return `<div class="road-questions"><strong>问路</strong>${row("闲问路", player, "player")}${row("庄问路", banker, "banker")}<small><i class="legend-red"></i>齐整 <i class="legend-blue"></i>不齐</small></div>`;
}

function roadSheet(table: GameTable, compact = false, interactive = false): string {
  const derived = makeDerivedRoads(table.history);
  return `<div class="road-sheet ${compact ? "compact" : ""}"><div class="road-board"><section class="bead-road-panel"><div class="road-panel-heading"><i class="bead-symbol banker"></i>珠盘路</div>${beadPlate(table, interactive)}</section><section class="big-road-panel"><div class="road-panel-heading"><i class="big-road-symbol banker"></i>大路</div>${road(table, compact, interactive)}</section><div class="derived-grid">${derivedRoad(table, derived.bigEye, "大眼仔路", "big-eye", "big-eye", true, interactive)}${derivedRoad(table, derived.small, "小路", "small", "small-road", true, interactive)}${derivedRoad(table, derived.cockroach, "曱甴路", "cockroach", "cockroach-road", true, interactive)}</div><aside class="road-info-panel">${roadStats(table)}${roadQuestions(table)}</aside></div></div>`;
}

function beadPlate(table: GameTable, interactive = false): string {
  const cells = makeBeadPlate(table.history, table.historyOffset);
  const maxColumn = Math.max(...cells.map((cell) => cell.column), 0);
  const visibleFrom = Math.max(0, maxColumn - 8);
  return `<div class="bead-plate ${interactive ? "markable-road" : ""}" aria-label="${table.name} 珠盘路" ${interactive ? `data-road-book="bead"` : ""}>${roadMarkOverlay(table, "bead", visibleFrom, 9)}${cells.filter((cell) => cell.column >= visibleFrom).map((cell) => `<span class="bead ${cell.outcome}" style="--row:${cell.row};--col:${cell.column - visibleFrom}">${outcomeName(cell.outcome)}</span>`).join("")}</div>`;
}

function homeView(): string {
  const restaurant = game.restaurantInfo();
  const equipped = skillDefinitions.find((skill) => skill.id === game.equippedSkill);
  const restaurantProgress = game.restaurant.cycleElapsedWorldMinutes / RESTAURANT_CYCLE_WORLD_MINUTES;
  const worldMinutesRemaining = Math.ceil(RESTAURANT_CYCLE_WORLD_MINUTES - game.restaurant.cycleElapsedWorldMinutes);
  return shell(`
    <section class="dashboard">
      <div class="intro">
        <p class="eyebrow">牌路试炼 · MVP</p>
        <h1>看准一条路，<br>再决定押多少。</h1>
        <p class="lede">十张牌桌同时开局。你的赌术会让玄学成真，但优势从来不是保证。</p>
        <button class="primary" data-action="casinos">进入赌场</button>
      </div>
      <div class="restaurant-band">
        <div>
          <span class="section-kicker">外港小馆</span>
          <h2>${game.restaurant.pawned ? "已典当" : `${game.restaurant.level} 级经营中`}</h2>
          <p>${game.restaurant.pawned ? "餐厅已停止产出。" : `离开赌场期间，每 1 游戏小时产出 ${money(restaurant.income)}`}</p>
        </div>
        <div class="cycle-ring" data-restaurant-clock style="--progress:${restaurantProgress}"><strong>${worldMinutesRemaining}分</strong><span>游戏时间</span></div>
        <button class="secondary" data-action="restaurant">管理餐厅</button>
      </div>
      <div class="skill-strip">
        <article><span>唯一技能栏</span><strong>${equipped ? equipped.name : "未装备"}</strong></article>
        <article><span>${equipped ? `${equipped.description} 当前信心改由路书标记结算。` : "信心由路书标记与下注风险共同结算。"}</span><strong>${equipped ? `Lv.${game.skills[equipped.id]}` : "—"}</strong></article>
        <button class="skill-manage-link" data-action="skills"><span>技能管理</span><strong>装配与升级 →</strong></button>
      </div>
    </section>
  `);
}

function skillsView(): string {
  const equipped = skillDefinitions.find((skill) => skill.id === game.equippedSkill);
  return shell(`
    <section class="page skills-page">
      <button class="back" data-action="home">← 返回</button>
      <div class="page-heading"><p class="eyebrow">赌术构筑</p><h1>技能管理</h1><p>当前只有一个技能栏位。技能等级暂不直接修改信心或神助效果，信心统一在封盘后由路书规则结算。</p></div>
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
  `);
}

function restaurantView(): string {
  const info = game.restaurantInfo();
  const max = info.nextCost === null;
  const progress = game.restaurant.cycleElapsedWorldMinutes / RESTAURANT_CYCLE_WORLD_MINUTES;
  const worldMinutesRemaining = Math.ceil(RESTAURANT_CYCLE_WORLD_MINUTES - game.restaurant.cycleElapsedWorldMinutes);
  return shell(`
    <section class="page restaurant-page">
      <button class="back" data-action="home">← 返回</button>
      <div class="page-heading"><p class="eyebrow">稳定收入</p><h1>外港小馆</h1><p>玩家不在赌场时持续营业，每经过 1 游戏小时自动结算一次收益。</p></div>
      <div class="restaurant-panel ${game.restaurant.pawned ? "is-pawned" : ""}">
        <div class="restaurant-mark">店</div>
        <div class="restaurant-stats">
          <div><span>当前等级</span><strong>${game.restaurant.level}</strong></div>
          <div><span>周期收益</span><strong>${game.restaurant.pawned ? "停止" : `${money(info.income)} / 1游戏小时`}</strong></div>
          <div><span>典当估值</span><strong>${game.restaurant.pawned ? "已领取" : money(info.pawn)}</strong></div>
        </div>
        <div class="progress-line" data-restaurant-progress><span style="width:${progress * 100}%"></span><em>${game.restaurant.pawned ? "已停止" : `${worldMinutesRemaining} 游戏分钟后结算`}</em></div>
        <div class="restaurant-actions">
          <button class="primary" data-action="upgrade" ${game.restaurant.pawned || max || game.cash < (info.nextCost ?? 0) ? "disabled" : ""}>${max ? "已达最高等级" : `升级 · ${money(info.nextCost!)}`}</button>
          <button class="danger" data-action="pawn" ${game.restaurant.pawned ? "disabled" : ""}>典当 · 获得 ${money(info.pawn)}</button>
        </div>
      </div>
    </section>
  `);
}

function casinoSelectView(): string {
  return shell(`
    <section class="page">
      <button class="back" data-action="home">← 返回</button>
      <div class="page-heading"><p class="eyebrow">今晚去哪一场</p><h1>选择赌场</h1><p>每次进入都需购买门票，赌场等级决定注码与可观察的牌桌数量。</p></div>
      <div class="casino-grid">${casinos.map((casino) => `
        <button class="casino-card ${casino.tone}" data-casino="${casino.id}" ${game.cash < casino.entryFee ? "disabled" : ""}>
          <span class="casino-number">0${casinos.indexOf(casino) + 1}</span>
          <div><span>${casino.subtitle}</span><h2>${casino.name}</h2></div>
          <dl><div><dt>门票</dt><dd>${money(casino.entryFee)}</dd></div><div><dt>牌桌</dt><dd>${casino.tableCount} 张</dd></div><div><dt>注码</dt><dd>${money(casino.minBet)} - ${money(casino.maxBet)}</dd></div></dl>
          <strong>${game.cash < casino.entryFee ? `现金不足 · 门票 ${money(casino.entryFee)}` : `支付 ${money(casino.entryFee)} 进入 →`}</strong>
        </button>`).join("")}</div>
    </section>
  `);
}

function lobbyView(): string {
  const casino = casinos.find((item) => item.id === casinoId)!;
  const tables = [...game.tables.values()].filter((table) => table.id.startsWith(casino.id));
  return shell(`
    <section class="page lobby-page ${casino.tone}">
      <button class="back" data-action="casinos">← 更换赌场</button>
      <div class="lobby-heading"><div><p class="eyebrow">${casino.subtitle}</p><h1>${casino.name}</h1></div><div class="legend"><span><i class="banker"></i>庄</span><span><i class="player"></i>闲</span><span><i class="tie"></i>和</span></div></div>
      <div class="tables-grid">${tables.map((table) => `<button class="table-card" data-table="${table.id}">${lobbyTableContent(table, casino)}</button>`).join("")}</div>
    </section>
  `);
}

function lobbyTableContent(table: GameTable, casino: Casino): string {
  const pattern = game.previewProbability(table.id).pattern;
  return `
    <div class="table-top"><strong>${table.name}</strong><span class="live" data-table-clock="${table.id}"><i></i>${Math.ceil((LOBBY_ROUND_MS - table.realtimeElapsedMs) / 1000)}s 开牌</span></div>
    <div class="table-shape"><span>庄</span><b>和</b><span>闲</span></div>
    ${roadSheet(table)}
    <div class="table-meta"><span class="pattern ${pattern.id !== "none" ? "active" : ""}">${pattern.name}</span><span>${money(casino.minBet)} - ${money(casino.maxBet)}</span></div>
  `;
}

function inlinePokerFace(card: Card): string {
  const rank = rankLabel(card);
  const suit = suitSymbol(card);
  const corner = (inverted = false) => `<span class="poker-corner ${inverted ? "inverted" : ""}"><b>${rank}</b><i>${suit}</i></span>`;
  const center = card.rank <= 10
    ? `<span class="pip-field">${pipLayout(card.rank).map((pip) => `<i class="poker-pip ${pip.inverted ? "inverted" : ""}" style="left:${pip.x * 100}%;top:${pip.y * 100}%">${suit}</i>`).join("")}</span>`
    : `<span class="court-card"><span>${rank}</span><i>${suit}</i><span>${rank}</span></span>`;
  return `<span class="poker-face ${isRedCard(card) ? "red" : ""}">${corner()}${center}${corner(true)}</span>`;
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
  return `<div class="inline-watch-hand ${side}"><span>${outcomeName(side)}家牌位</span><div class="inline-watch-cards">${cards.map(({ entry, index }) => {
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
  const probability = game.previewProbability(tableId);
  const stagedAmount = game.reservedBetAmount;
  const denominations = chipDenominations(casino);
  if (!denominations.includes(selectedChip)) selectedChip = denominations[0] ?? casino.minBet;
  const markedPatterns = game.markedRoadPatterns(table.id);
  const markedBookCount = markedRoadBookCount(table.id);
  const recognizedPatternList = markedPatterns.length
    ? `<div class="recognized-pattern-list">${markedPatterns.map((pattern) => `<span><b>${pattern.name}</b><i>预测${outcomeName(pattern.prediction)}</i></span>`).join("")}</div>`
    : "";
  const roadFeedback = roadMarkFeedback
    ? `<div class="road-mark-feedback" role="status"><span>${roadMarkFeedback.message}</span><code>DEBUG · ${roadMarkFeedback.debug}</code></div>`
    : "";
  const confidenceMessage = !stagedBetSide
    ? "点击珠盘路、大路或下三路进行标记；信心在封盘后结算"
    : `已押${outcomeName(stagedBetSide)} · 确认下注后才揭示信心变化`;
  const zone = (side: Outcome, english: string, odds: string, chance: number) => {
    const active = stagedBetSide === side && stagedAmount > 0;
    return `<button class="table-bet-zone ${side} ${active ? "has-wager" : ""}" data-bet-zone="${side}" aria-label="在${outcomeName(side)}区下注 ${money(selectedChip)}" ${inlineWatchActive ? "disabled" : ""}>
      <span><b>${outcomeName(side)}</b><em>${english}</em><i>${odds}</i></span>
      <small>${(chance * 100).toFixed(1)}% 路势概率</small>
      ${active ? `<span class="zone-wager"><i></i><i></i><i></i><strong>${money(stagedAmount)}</strong></span>` : ""}
    </button>`;
  };
  const canConfirm = Boolean(stagedBetSide) && stagedAmount >= casino.minBet && stagedAmount <= casino.maxBet;
  return shell(`
    <section class="table-page">
      <div class="table-header"><button class="back" data-action="lobby" ${inlineWatchActive && !inlineWatchSettled ? "disabled" : ""}>← 返回大厅</button><div><span>${casino.name}</span><h1>${table.name}</h1></div><span class="round-count">第 ${inlineWatchSettled ? table.round : table.round + 1} 局</span></div>
      <div class="table-layout">
        <section class="betting-panel ${inlineWatchActive ? "inline-watching" : ""}">
          <div class="table-felt ${inlineWatchActive ? "watch-active" : ""}">
            <div class="table-session-meta"><span>${inlineWatchActive ? `旁观牌局 · ${inlineWatchStatus(watchPending!)}` : `限红 ${money(casino.minBet)} - ${money(casino.maxBet)}`}</span><button class="secondary" data-action="watch" ${inlineWatchActive ? "disabled" : ""}>旁观本局</button></div>
            <div class="dealer-apron ${inlineWatchActive ? "inline-watch-apron" : ""}">${inlineWatchActive ? `${inlineWatchHand(watchPending!, "player")}<strong>${inlineWatchStatus(watchPending!)}</strong>${inlineWatchHand(watchPending!, "banker")}` : `<div><span>闲家牌位</span><i></i><i></i></div><strong>风云</strong><div><span>庄家牌位</span><i></i><i></i></div>`}</div>
            <div class="bet-zones">${zone("player", "PLAYER", "1:1", probability.player)}${zone("tie", "TIE", "1:8", probability.tie)}${zone("banker", "BANKER", "1:0.95", probability.banker)}</div>
            ${watchResult ? `<div class="inline-watch-result ${watchResult.outcome}" data-action="dismiss-settlement" role="button" tabindex="0" aria-label="关闭旁观结算"><i>${watchResult.outcome === "tie" ? "和" : outcomeName(watchResult.outcome)}</i><span>旁观结算</span><h2>${watchResult.outcome === "tie" ? "本局和局" : `${outcomeName(watchResult.outcome)}家胜`}</h2><p>庄 ${watchResult.bankerPoints} 点 · 闲 ${watchResult.playerPoints} 点</p><small>点击任意位置返回牌桌</small></div>` : ""}
          </div>
          <div class="bet-controls">
            <div class="bet-command-bar">
              <button class="secondary" data-action="cancel-bet" ${stagedAmount <= 0 || inlineWatchActive ? "disabled" : ""}><span>↶</span>取消</button>
              <button class="primary" data-action="confirm-bet" ${canConfirm && !inlineWatchActive ? "" : "disabled"}><span>✓</span>确认</button>
            </div>
            <div class="chip-console">
              <div class="chip-tray" aria-label="筹码面额">${denominations.map((amount, index) => `<button class="bet-chip chip-${index + 1} ${selectedChip === amount ? "selected" : ""}" data-chip="${amount}" aria-label="选择${money(amount)}筹码" ${inlineWatchActive ? "disabled" : ""}><span>${amount >= 1000 ? `${amount / 1000}K` : amount}</span></button>`).join("")}</div>
              <div class="stake-summary"><span>${inlineWatchActive ? "旁观中" : stagedBetSide ? `已押${outcomeName(stagedBetSide)}` : "尚未落注"}</span><strong>${inlineWatchActive ? "—" : money(stagedAmount)}</strong><small>${inlineWatchActive ? inlineWatchStatus(watchPending!) : betDraftNotice}</small></div>
              <div class="table-balance"><span>可用现金</span><strong>${money(game.cash)}</strong></div>
            </div>
            <div class="confidence-readout"><span>当前信心 ${Math.round(game.confidence * 100)}%</span><strong>${confidenceMessage}</strong></div>
          </div>
        </section>
        <aside class="road-panel"><div class="panel-title"><h2>牌路</h2><span class="pattern ${markedBookCount ? "active" : ""}">${markedBookCount ? `已标记 ${markedBookCount} 路 · DEBUG 有效 ${markedPatterns.length} 路` : "点击路书标记"}</span></div>${roadFeedback}${recognizedPatternList}${roadSheet(table, false, true)}</aside>
      </div>
    </section>
  `);
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

function nextUnrevealedForSide(pending: PendingRound, side: Side): number | null {
  const sequence = dealSequence(pending);
  const next = sequence.map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => index < dealtCardCount && entry.side === side && !revealedCardIndices.has(index))
    .sort((a, b) => a.entry.handIndex - b.entry.handIndex)[0];
  return next?.index ?? null;
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
  if (group.candidates.some((candidate) => candidate.faceGroup)) return labels.join("/");
  if (labels.length === 1) return labels[0]!;
  return `${labels[0]}-${labels.at(-1)}`;
}

function forecastRankDetail(group: ForecastRankGroup): string {
  if (group.candidates.flatMap((candidate) => candidate.labels).length === 13) return "A-K · 含 10/J/Q/K";
  if (group.candidates.some((candidate) => candidate.faceGroup)) return "均为 0 点";
  const values = group.candidates.map((candidate) => candidate.value);
  return values.length === 1 ? `${values[0]} 点` : `${values[0]}-${values.at(-1)} 点`;
}

function currentCardForecast(pending: PendingRound): string {
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
    const canMerge = sameResult && !candidate.faceGroup && !previous?.candidates.some((item) => item.faceGroup);
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
    return `<div class="forecast-value ${group.result.className} ${group.candidates.some((candidate) => candidate.faceGroup) ? "face-group" : ""}" aria-label="${ranks}：${group.result.label}"><b>${ranks}</b><span>${group.result.label}</span><small>${forecastRankDetail(group)}</small></div>`;
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
  const casino = casinos.find((item) => item.id === casinoId)!;
  const table = game.table(tableId);
  const probability = game.previewProbability(tableId);
  const sequence = dealSequence(pending);
  const isWatching = pending.bet === null;
  const ownedSide = playerOwnedSide(pending);
  const dealerSide: Side | null = ownedSide ? ownedSide === "banker" ? "player" : "banker" : null;
  const selfNext = ownedSide ? nextUnrevealedForSide(pending, ownedSide) : null;
  const dealerNext = dealerSide ? nextUnrevealedForSide(pending, dealerSide) : null;
  const finalCardForecast = currentCardForecast(pending);
  const revealChoice = dealStage === "awaiting-card" && ownedSide
    ? finalCardForecast
      ? `<div class="last-card-action-bar">${finalCardForecast}<div class="last-card-actions"><span>选择开牌方式</span><div><button class="primary" data-action="reveal-self" ${selfNext === null ? "disabled" : ""}>自己开${outcomeName(ownedSide)}家末张</button><button class="secondary" data-action="reveal-dealer" ${dealerNext === null ? "disabled" : ""}>荷官开${outcomeName(dealerSide!)}家末张</button></div></div></div>`
      : `<div class="reveal-choice"><span>选择下一张牌</span><div><button class="primary" data-action="reveal-self" ${selfNext === null ? "disabled" : ""}>自己开${outcomeName(ownedSide)}家下一张</button><button class="secondary" data-action="reveal-dealer" ${dealerNext === null ? "disabled" : ""}>荷官开${outcomeName(dealerSide!)}家下一张</button></div><small>${outcomeName(ownedSide)}家剩 ${sequence.filter((entry, index) => index < dealtCardCount && entry.side === ownedSide && !revealedCardIndices.has(index)).length} 张 · ${outcomeName(dealerSide!)}家剩 ${sequence.filter((entry, index) => index < dealtCardCount && entry.side === dealerSide && !revealedCardIndices.has(index)).length} 张</small></div>`
    : dealStage === "dealer-revealing" && finalCardForecast
      ? `<div class="last-card-action-bar dealer-opening">${finalCardForecast}</div>`
      : "";
  const result = dealStage === "settled" ? pending.result : null;
  const confidenceFeedback = `封盘结算 · ${Math.round(pending.confidence * 100)}%`;
  const delta = lastSettlement?.delta ?? 0;
  const betFeedback = !pending.bet ? "旁观完成" : result?.outcome === pending.bet.side ? `押中${outcomeName(pending.bet.side)}` : result?.outcome === "tie" ? "和局退注" : `押${outcomeName(pending.bet.side)}未中`;
  const settlementKind = !pending.bet ? "watch" : result?.outcome === pending.bet.side ? "hit" : result?.outcome === "tie" ? "push" : "miss";
  const settlementSeal = settlementKind === "hit" ? "中" : settlementKind === "miss" ? "负" : settlementKind === "push" ? "和" : "看";
  const settlementAmount = settlementKind === "hit" ? `盈利 +${money(delta)}` : settlementKind === "miss" ? `损失 -${money(Math.abs(delta))}` : settlementKind === "push" ? "本金已退回" : "本局未下注";
  const statusTitle = dealStage === "settled" ? result!.outcome === "tie" ? "和局" : `${outcomeName(result!.outcome)}家胜` : dealStage === "animating" ? "荷官发牌" : dealStage === "drawing-card" ? `${outcomeName(sequence[dealtCardCount - 1]!.side)}家补牌` : dealStage === "dealer-revealing" ? "荷官开牌" : `剩余 ${dealtCardCount - revealedCardIndices.size} 张未开`;
  return shell(`
    <section class="table-page table-dealing immersive-dealing ${dealStage}">
      <div class="table-header"><button class="back" data-action="lobby">← 返回大厅</button><div><span>${casino.name}</span><h1>${table.name}</h1></div><span class="round-count">第 ${dealStage === "settled" ? table.round : table.round + 1} 局</span></div>
      <div class="table-layout">
        <section class="betting-panel live-deal-panel">
          <div class="deal-status"><div class="deal-status-title"><p class="eyebrow">${dealStage === "settled" ? betFeedback : isWatching ? "旁观牌局" : `已押${outcomeName(pending.bet!.side)} · ${money(pending.bet!.amount)}`}</p><h1>${statusTitle}</h1></div>${dealStage === "settled" ? "" : liveBaccaratScore(pending)}<span>${dealStage === "settled" ? `庄 ${result!.bankerPoints} 点 · 闲 ${result!.playerPoints} 点` : ownedSide ? confidenceFeedback : "本局全部由荷官开牌 · 信心不变"}</span>${dealStage !== "settled" ? confidenceBreakdownView(pending) : ""}</div>
          <div class="immersive-table-stage">
            <div id="table-3d-stage" aria-label="3D百家乐牌桌"></div>
            ${pending.bet ? `<div class="active-bet-marker ${pending.bet.side}"><i></i><span>押${outcomeName(pending.bet.side)}</span><strong>${money(pending.bet.amount)}</strong></div>` : ""}
            ${revealChoice}
            ${dealStage === "settled" ? `<div class="table-settlement ${settlementKind}" data-action="dismiss-settlement" role="button" tabindex="0" aria-label="关闭结算"><section class="settlement-verdict"><i>${settlementSeal}</i><span>本局 ${outcomeName(result!.outcome)}${result!.outcome === "tie" ? "局" : "家胜"}</span><b>${betFeedback}</b><strong>${settlementAmount}</strong>${pending.bet ? `<small>押${outcomeName(pending.bet.side)} · ${money(pending.bet.amount)}</small>` : ""}${lastSettlement?.income ? `<em>餐厅同期到账 +${money(lastSettlement.income)}</em>` : ""}</section><div class="settlement-hands"><div><span>庄家 · ${result!.bankerPoints} 点</span><strong>${result!.bankerCards.map(cardLabel).join(" · ")}</strong></div><div><span>闲家 · ${result!.playerPoints} 点</span><strong>${result!.playerCards.map(cardLabel).join(" · ")}</strong></div></div><small class="settlement-dismiss-hint">点击任意位置返回牌桌</small></div>` : ""}
          </div>
        </section>
        <aside class="road-panel"><div class="panel-title"><h2>牌路</h2><span class="pattern active">${probability.pattern.name}</span></div>${roadSheet(table)}</aside>
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
  const debugValue = document.querySelector<HTMLElement>("[data-debug-confidence-value]");
  if (debugValue) debugValue.textContent = `${Math.round(game.confidence * 100)}%`;
}

function renderDebugMenu(): void {
  document.querySelector(".debug-overlay")?.remove();
  if (!debugMenuOpen) return;
  const overlay = document.createElement("div");
  overlay.className = "debug-overlay";
  overlay.innerHTML = `<section class="debug-menu" role="dialog" aria-modal="true" aria-label="测试调试菜单"><header><div><span>TEST TOOLS</span><h2>测试调试</h2></div><button type="button" data-debug-close aria-label="关闭调试菜单">×</button></header><div class="debug-row"><div><strong>信心锁定 100%</strong><small>神助触发率锁定为 100%，关闭后恢复原值</small></div><label class="debug-switch"><input type="checkbox" data-debug-confidence ${game.debugConfidenceForced ? "checked" : ""}><i></i></label></div><footer><span>当前信心</span><strong data-debug-confidence-value>${Math.round(game.confidence * 100)}%</strong><small>按 ESC 关闭</small></footer></section>`;
  document.body.append(overlay);
  overlay.querySelector<HTMLElement>("[data-debug-close]")!.addEventListener("click", () => {
    debugMenuOpen = false;
    renderDebugMenu();
  });
  overlay.querySelector<HTMLInputElement>("[data-debug-confidence]")!.addEventListener("change", (event) => {
    game.setDebugConfidenceForced((event.currentTarget as HTMLInputElement).checked);
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
    inlineWatchSettled = true;
    render();
  }, 700));
}

function render(): void {
  viewTimers.forEach((timer) => window.clearTimeout(timer));
  viewTimers = [];
  tableScene?.dispose();
  tableScene = null;
  const content = view === "home" ? homeView() : view === "restaurant" ? restaurantView() : view === "skills" ? skillsView() : view === "casino-select" ? casinoSelectView() : view === "lobby" ? lobbyView() : view === "table" ? tableView() : view === "dealing" ? dealingView() : gameOverView();
  app.innerHTML = content;
  bind();
  if (view === "dealing") setupDealing();
  if (view === "table" && inlineWatchActive) setupInlineWatch();
}

function settleOnTable(): void {
  const pending = game.pending!;
  lastRound = pending;
  lastSettlement = game.settle();
  dealStage = "settled";
  view = game.gameOver ? "game-over" : "dealing";
  render();
}

function setupDealing(): void {
  const pending = game.pending ?? lastRound!;
  const host = document.querySelector<HTMLElement>("#table-3d-stage");
  if (!host) return;
  tableScene = new TableScene(host);
  const sequence = dealSequence(pending);
  const animateFromIndex = dealStage === "animating" ? 0 : dealStage === "drawing-card" ? dealtCardCount - 1 : null;
  tableScene.deal(sequence.slice(0, dealtCardCount), revealedCardIndices, () => {
    if (playerOwnedSide(pending)) {
      dealStage = "awaiting-card";
      render();
    } else {
      dealStage = "dealer-revealing";
      render();
    }
  }, animateFromIndex, playerOwnedSide(pending));
  if (dealStage === "dealer-revealing") viewTimers.push(window.setTimeout(revealNextAutomatically, 280));
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

interface ArmedDivineAssist {
  target: Outcome;
  low: number;
  high: number;
}

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
  return { target: info.target, low: info.low, high: info.high };
}

function startDivineGame(index: number, target: Outcome, low: number, high: number, proceed: () => void): void {
  tablePlayerInteractionActive = true;
  const activation = document.createElement("div");
  activation.className = "divine-activation";
  activation.innerHTML = `<div class="divine-activation-lines"></div><strong>神助发动</strong>`;
  document.body.append(activation);
  document.body.classList.add("divine-activation-active");
  if ("vibrate" in navigator) navigator.vibrate([50, 24, 72, 28, 96]);
  window.setTimeout(() => {
    activation.remove();
    document.body.classList.remove("divine-activation-active");
    runDivineGame(index, target, low, high, proceed);
  }, 1000);
}

function runDivineGame(index: number, target: Outcome, low: number, high: number, proceed: () => void): void {
  const targetCard = dealSequence(game.pending!)[index]!;
  const call = divineCallForRound(game.pending!.result, targetCard.side, targetCard.handIndex, target);
  const callWord = call.word;
  const callMeaning = call.meaning;
  const overlay = document.createElement("div");
  overlay.className = "divine-overlay";
  overlay.innerHTML = `<div class="divine-heading"><span>神助 · 助你押中${outcomeName(target)}</span><strong>${Math.round(low * 100)}% <i>→</i> ${Math.round(high * 100)}%</strong></div><div class="divine-hit"><span class="divine-level"><i></i></span><strong class="divine-level-value">气势 24%</strong><b>${callWord}</b><small>${callMeaning} · 点击屏幕任意位置</small></div><div class="divine-timer"><i></i></div><span class="divine-time-value">剩余 3.2 秒</span><div class="divine-shouts"></div>`;
  document.body.append(overlay);
  const levelBar = overlay.querySelector<HTMLElement>(".divine-level i")!;
  const levelValue = overlay.querySelector<HTMLElement>(".divine-level-value")!;
  const timerBar = overlay.querySelector<HTMLElement>(".divine-timer i")!;
  const timeValue = overlay.querySelector<HTMLElement>(".divine-time-value")!;
  const shouts = overlay.querySelector<HTMLElement>(".divine-shouts")!;
  const duration = 3200;
  const startedAt = performance.now();
  let lastAt = startedAt;
  let level = 0.24;
  let ended = false;
  let callCount = 0;
  let impactTimer = 0;
  const updateLevel = () => {
    levelBar.style.height = `${level * 100}%`;
    levelValue.textContent = `气势 ${Math.round(level * 100)}%`;
    overlay.style.setProperty("--divine-intensity", level.toFixed(3));
    overlay.style.setProperty("--level-glow", `${Math.round(14 + level * 30)}px`);
    overlay.style.setProperty("--level-shadow-alpha", (0.2 + level * 0.5).toFixed(3));
  };
  const finish = (useHigh: boolean) => {
    if (ended) return;
    ended = true;
    const probability = useHigh ? high : low;
    const entry = dealSequence(game.pending!)[index]!;
    const hit = game.applyDivineAssist(entry.side, entry.handIndex, probability);
    divineRevealFeedback.set(index, { hit, target, probability });
    tableScene?.setCard(index, dealSequence(game.pending!)[index]!.card);
    overlay.classList.add("resolved", useHigh ? "high" : "low");
    overlay.querySelector<HTMLElement>(".divine-heading")!.innerHTML = `<span>神助结算 · 目标押中${outcomeName(target)}</span><strong>${useHigh ? "高档概率" : "低档概率"}</strong>`;
    const resultPanel = document.createElement("div");
    resultPanel.className = "divine-result";
    resultPanel.innerHTML = `<span>本次获得 · ${useHigh ? "高档神助" : "低档神助"}</span><b>${Math.round(probability * 100)}%</b><p>目标结果：押中${outcomeName(target)}</p><small>${callMeaning}。神助已经作用于最后一张暗牌，是否应验将在开牌时揭晓。</small><button class="primary" type="button">确认并继续开牌</button>`;
    overlay.append(resultPanel);
    resultPanel.querySelector("button")!.addEventListener("click", (event) => {
      event.stopPropagation();
      overlay.remove();
      tablePlayerInteractionActive = false;
      proceed();
    });
  };
  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
    if (ended) return;
    level = Math.min(1, level + 0.105);
    updateLevel();
    const power = 0.45 + level * 1.55;
    const shake = 3 + level * 7;
    overlay.style.setProperty("--impact-power", power.toFixed(3));
    overlay.style.setProperty("--shake", `${shake.toFixed(1)}px`);
    overlay.style.setProperty("--shake-neg", `${(-shake).toFixed(1)}px`);
    overlay.style.setProperty("--flash-alpha", (0.22 + level * 0.28).toFixed(3));
    overlay.classList.remove("impact");
    void overlay.offsetWidth;
    overlay.classList.add("impact");
    window.clearTimeout(impactTimer);
    impactTimer = window.setTimeout(() => overlay.classList.remove("impact"), 190);
    if ("vibrate" in navigator) navigator.vibrate(Math.round(10 + level * 28));
    const shout = document.createElement("span");
    shout.textContent = callWord;
    callCount += 1;
    shout.style.setProperty("--x", `${event.clientX / window.innerWidth * 100}%`);
    shout.style.setProperty("--y", `${event.clientY / window.innerHeight * 100}%`);
    shout.style.setProperty("--r", `${callCount % 2 ? -8 : 8}deg`);
    shout.style.setProperty("--power", power.toFixed(3));
    shout.style.setProperty("--shout-size", `${Math.round(58 + 24 * power)}px`);
    shout.style.setProperty("--stroke-width", `${(1 + 0.6 * power).toFixed(1)}px`);
    shout.style.setProperty("--shadow-y", `${Math.round(5 * power)}px`);
    shout.style.setProperty("--shout-glow", `${Math.round(16 * power)}px`);
    shout.style.setProperty("--slam-scale", (2.2 + 0.25 * power).toFixed(3));
    shout.style.setProperty("--impact-scale", (1.12 + 0.05 * power).toFixed(3));
    shouts.append(shout);
    window.setTimeout(() => shout.remove(), 480);
    if (level >= 1) finish(true);
  });
  updateLevel();
  const tick = (now: number) => {
    if (ended) return;
    const elapsed = now - startedAt;
    level = Math.max(0, level - (now - lastAt) * 0.00019);
    lastAt = now;
    updateLevel();
    timerBar.style.width = `${Math.max(0, 1 - elapsed / duration) * 100}%`;
    timeValue.textContent = `剩余 ${Math.max(0, (duration - elapsed) / 1000).toFixed(1)} 秒`;
    if (elapsed >= duration) finish(false);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  tableScene?.revealFocusedByDealer(index, () => {
    if (assist) finishRevealWhileFocused(index);
    else finishReveal(index);
  }, assist ? {
    keepFocus: true,
    threshold: 0.42,
    onThreshold: (resume) => startDivineGame(index, assist.target, assist.low, assist.high, resume),
  } : {});
}

function beginSqueeze(index: number, assist: ArmedDivineAssist | null): void {
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
  }, assist ? () => {
    overlay.classList.add("divine-paused");
    startDivineGame(index, assist.target, assist.low, assist.high, () => {
      overlay.classList.remove("divine-paused");
      overlay.classList.add("settling");
      tableScene?.resumeSqueezeAndComplete();
    });
  } : null);
  overlay.querySelector<HTMLElement>("[data-squeeze-quick]")!.addEventListener("click", () => tableScene?.quickSqueeze());
}

function bind(): void {
  app.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => element.addEventListener("click", () => {
    const action = element.dataset.action;
    const navigationAction = Boolean(action && ["home", "restaurant", "skills", "casinos", "lobby"].includes(action));
    if (inlineWatchActive && !inlineWatchSettled && navigationAction) return;
    if (inlineWatchActive && inlineWatchSettled && navigationAction) resetInlineWatch();
    if (view === "table" && action && ["home", "restaurant", "skills", "casinos", "lobby"].includes(action)) resetBetDraft(true);
    if (action === "home") view = "home";
    if (action === "restaurant") view = "restaurant";
    if (action === "skills") view = "skills";
    if (action === "casinos") view = "casino-select";
    if (action === "lobby") view = "lobby";
    if (action === "upgrade") game.upgradeRestaurant();
    if (action === "pawn" && confirm(`典当后餐厅将停止产出。确认典当并获得 ${money(game.restaurantInfo().pawn)}？`)) game.pawnRestaurant();
    if (action === "equip-skill") game.equipSkill(element.dataset.skill as SkillId);
    if (action === "unequip-skill") game.equipSkill(null);
    if (action === "upgrade-skill") game.upgradeSkill(element.dataset.skill as SkillId);
    if (action === "cancel-bet") {
      const refund = game.cancelReservedBet();
      stagedBetSide = null;
      betDraftNotice = refund > 0 ? `已撤回 ${money(refund)}` : "当前没有可撤回筹码";
    }
    if (action === "watch") {
      resetBetDraft(true);
      game.play(tableId, null);
      inlineWatchActive = true;
      inlineWatchStep = 0;
      inlineWatchSettled = false;
      lastRound = null;
      lastSettlement = null;
      view = "table";
    }
    if (action === "confirm-bet" && stagedBetSide && game.reservedBetAmount > 0) {
      game.play(tableId, { side: stagedBetSide, amount: game.reservedBetAmount });
      resetBetDraft(false);
      revealedCardIndices.clear(); divineCheckedStages.clear(); divineRevealFeedback.clear(); tablePlayerInteractionActive = false; dealtCardCount = 4; dealStage = "animating"; view = "dealing";
    }
    if (action === "reveal-self") {
      const pending = game.pending!;
      const side = playerOwnedSide(pending)!;
      const index = nextUnrevealedForSide(pending, side);
      if (index !== null && tableScene) {
        tableScene.focus(index, () => beginSqueeze(index, armDivineAssist(index)));
      }
      return;
    }
    if (action === "reveal-dealer") {
      const pending = game.pending!;
      const side = playerOwnedSide(pending)! === "banker" ? "player" : "banker";
      const index = nextUnrevealedForSide(pending, side);
      if (index !== null && tableScene) {
        document.querySelector<HTMLElement>(".last-card-action-bar")?.classList.add("dealer-opening");
        tableScene.focus(index, () => revealFocusedCardByDealer(index));
      }
      return;
    }
    if (action === "dismiss-settlement") {
      if (inlineWatchActive) resetInlineWatch();
      else tablePlayerInteractionActive = false;
      dealStage = "animating";
      view = "table";
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

  app.querySelectorAll<HTMLElement>("[data-road-book]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (view !== "table") return;
    const roadBook = element.dataset.roadBook as RoadBook;
    if (roadBook === "bead") {
      const table = game.table(tableId);
      const patterns = game.markCurrentBeadRoad(tableId);
      const count = patterns.length;
      const markedCount = markedRoadBookCount(tableId);
      game.notice = count ? `珠盘路标记完成 · 共标记 ${markedCount} 路，成立 ${game.markedRoadPatterns(tableId).length} 型` : "珠盘路未标记 · 下一格所在行向左未形成有效路数";
      const nextRow = (table.historyOffset + table.history.length) % 6 + 1;
      const rowHistory: Outcome[] = [];
      for (let index = table.history.length - 6; index >= 0 && rowHistory.length < 6; index -= 6) rowHistory.push(table.history[index]!.outcome);
      const rowLabel = rowHistory.length ? rowHistory.map(outcomeName).join("、") : "尚无记录";
      roadMarkFeedback = {
        message: "珠盘路已标记",
        debug: count
          ? `${patterns[0]!.name}有效，预测${outcomeName(patterns[0]!.prediction)}`
          : `当前无有效路数；下一格第 ${nextRow} 行，向左为 ${rowLabel}`,
      };
      render();
      return;
    }
    const visibleFrom = Number(element.dataset.visibleFrom ?? 0);
    const columns = Number(element.dataset.columns ?? 1);
    const bounds = element.getBoundingClientRect();
    const localColumn = Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * columns)));
    const startColumn = visibleFrom + localColumn;
    const table = game.table(tableId);
    const derived = makeDerivedRoads(table.history);
    const roadCells = roadBook === "big"
      ? makeBigRoad(table.history)
      : roadBook === "big-eye"
        ? derived.bigEye
        : roadBook === "small"
          ? derived.small
          : derived.cockroach;
    const startRound = roadCells.filter((cell) => cell.column >= startColumn).sort((a, b) => a.roundIndex - b.roundIndex)[0]?.roundIndex ?? table.history.length;
    game.markRoad(tableId, roadBook, startColumn, startRound);
    const markedPatterns = game.markedRoadPatterns(tableId);
    const currentPattern = markedPatterns.find((pattern) => pattern.source === roadBook);
    game.notice = currentPattern ? `标记完成 · 共标记 ${markedRoadBookCount(tableId)} 路，成立 ${markedPatterns.length} 型` : "标记完成 · 当前区间未形成有效路数";
    roadMarkFeedback = {
      message: "路书区间已标记",
      debug: currentPattern ? `${currentPattern.name}有效，预测${outcomeName(currentPattern.prediction)}` : "当前无有效路数",
    };
    render();
  }));

  app.querySelectorAll<HTMLElement>("[data-chip]").forEach((element) => element.addEventListener("click", () => {
    selectedChip = Number(element.dataset.chip);
    betDraftNotice = `已选择 ${money(selectedChip)} 筹码`;
    render();
  }));
  app.querySelectorAll<HTMLElement>("[data-bet-zone]").forEach((element) => element.addEventListener("click", () => {
    const side = element.dataset.betZone as Outcome;
    const casino = casinos.find((item) => item.id === casinoId)!;
    if (stagedBetSide && stagedBetSide !== side) {
      betDraftNotice = `本轮已押${outcomeName(stagedBetSide)}，请先取消再改押${outcomeName(side)}`;
      render();
      return;
    }
    if (game.reservedBetAmount + selectedChip > casino.maxBet) {
      betDraftNotice = `超过本桌上限 ${money(casino.maxBet)}`;
      render();
      return;
    }
    if (!game.reserveBetChip(selectedChip)) {
      betDraftNotice = `现金不足，无法投入 ${money(selectedChip)}`;
      render();
      return;
    }
    stagedBetSide = side;
    betDraftNotice = `已投入一枚 ${money(selectedChip)} 筹码`;
    render();
  }));
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
  const insideCasino = view === "lobby" || atTable;
  const paused = worldTimePaused();
  const tick = game.tickRealtime(Date.now(), atTable ? tableId : null, insideCasino, paused);
  if (tick.income > 0) game.notice = `餐厅到账 ${money(tick.income)}`;

  const wallet = document.querySelector<HTMLElement>(".wallet strong");
  if (wallet) wallet.textContent = money(game.cash);

  const worldClock = document.querySelector<HTMLElement>("[data-world-clock]");
  if (worldClock) worldClock.textContent = worldTimeLabel();
  const worldClockWrap = document.querySelector<HTMLElement>(".world-clock");
  worldClockWrap?.classList.toggle("paused", paused);

  const restaurantClock = document.querySelector<HTMLElement>("[data-restaurant-clock]");
  const worldMinutesRemaining = Math.ceil(RESTAURANT_CYCLE_WORLD_MINUTES - game.restaurant.cycleElapsedWorldMinutes);
  if (restaurantClock) {
    restaurantClock.style.setProperty("--progress", String(game.restaurant.cycleElapsedWorldMinutes / RESTAURANT_CYCLE_WORLD_MINUTES));
    const value = restaurantClock.querySelector("strong");
    if (value) value.textContent = `${worldMinutesRemaining}分`;
  }
  const restaurantProgress = document.querySelector<HTMLElement>("[data-restaurant-progress]");
  if (restaurantProgress) {
    const bar = restaurantProgress.querySelector<HTMLElement>("span");
    const label = restaurantProgress.querySelector<HTMLElement>("em");
    if (bar) bar.style.width = `${game.restaurant.cycleElapsedWorldMinutes / RESTAURANT_CYCLE_WORLD_MINUTES * 100}%`;
    if (label) label.textContent = `${worldMinutesRemaining} 游戏分钟后结算`;
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
