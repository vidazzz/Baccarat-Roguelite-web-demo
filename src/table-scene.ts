import * as THREE from "three";
import { cardFaceAsset } from "./card-assets";
import { type Card, type Outcome, type Side } from "./domain";

export interface TableCard {
  card: Card;
  side: Side;
  handIndex: number;
}

export type CardRevealActor = "self" | "dealer";

export function cardRevealActor(cardSide: Side, ownedSide: Side | null): CardRevealActor {
  return ownedSide === cardSide ? "self" : "dealer";
}

export function unrevealedDealtCardIndices(dealtCardCount: number, revealed: ReadonlySet<number>): number[] {
  return Array.from({ length: Math.max(0, Math.floor(dealtCardCount)) }, (_, index) => index)
    .filter((index) => !revealed.has(index));
}

export interface TableCardPositions {
  table: { x: number; y: number; z: number };
  resting: { x: number; y: number; z: number };
}

export type ChipSettlementKind = "win" | "lose" | "push";

export interface TableChip {
  value: number;
  colorIndex: number;
}

export interface SettlementChipPositions {
  dealer: { x: number; y: number; z: number };
  wager: { x: number; y: number; z: number };
  returned: { x: number; y: number; z: number };
}

export function settlementChipPositions(side: Outcome): SettlementChipPositions {
  const wagerX = side === "player" ? -2.45 : side === "banker" ? 2.45 : 0;
  return {
    dealer: { x: 0, y: 0.08, z: -3.18 },
    wager: { x: wagerX, y: 0.08, z: 2.95 },
    returned: { x: wagerX, y: 0.08, z: 3.72 },
  };
}

export function composeChipAmount(amount: number, denominations: number[]): TableChip[] {
  let remaining = Math.max(0, Math.floor(amount));
  const sorted = denominations
    .map((value, colorIndex) => ({ value, colorIndex }))
    .filter((chip) => chip.value > 0)
    .sort((a, b) => b.value - a.value);
  const chips: TableChip[] = [];
  for (const denomination of sorted) {
    while (remaining >= denomination.value) {
      chips.push(denomination);
      remaining -= denomination.value;
    }
  }
  if (remaining > 0) chips.push({ value: remaining, colorIndex: denominations.length });
  return chips;
}

export function tableCardPositions(entry: Pick<TableCard, "side" | "handIndex">, ownedSide: Side | null): TableCardPositions {
  const handOffsets = [-1.5, 1.5, 3.9];
  const handOffset = handOffsets[entry.handIndex] ?? 3.9 + (entry.handIndex - 2) * 2.6;
  const pushedOffsets = [-1.5, 1.5, 4.1];
  const pushedX = pushedOffsets[entry.handIndex] ?? 4.1 + (entry.handIndex - 2) * 2.6;
  const sideCenter = entry.side === "player" ? -4.45 : 4.45;
  const tableX = sideCenter + (entry.side === "player" ? handOffset : -handOffset);
  const table = { x: tableX, y: 0.025, z: -0.72 };
  const resting = ownedSide === entry.side
    ? { x: pushedX, y: 0.028, z: 1.48 }
    : table;
  return { table, resting };
}

export type SqueezeDirection = "long-edge" | "corner" | "short-edge";

export interface SqueezeDirectionInfo {
  mode: SqueezeDirection;
  normal: { x: number; y: number };
  fingerDirection: { x: number; y: number };
}

export const SQUEEZE_COMPLETE_PROGRESS = 0.7;
export const DIVINE_MASH_INITIAL_RATIO = 0.28;
export const DIVINE_MASH_CLICK_RATIO = 0.09;

export function divineMashRetreatRatioPerMs(progressRatio: number): number {
  const ratio = THREE.MathUtils.clamp(progressRatio, 0, 1);
  return 0.0001 + ratio * ratio * 0.00032;
}

export function snapSqueezeDirection(x: number, y: number, side: Side): SqueezeDirectionInfo | null {
  const leftSign = side === "player" ? -1 : 1;
  const nearSign = side === "player" ? -1 : 1;
  if (Math.hypot(x, y) < 0.05) {
    return {
      mode: "corner",
      normal: { x: leftSign * Math.SQRT1_2, y: nearSign * Math.SQRT1_2 },
      fingerDirection: { x: leftSign * Math.SQRT1_2, y: -nearSign * Math.SQRT1_2 },
    };
  }

  const towardLeft = x * leftSign;
  const towardNear = y * nearSign;
  const angle = Math.atan2(towardNear, towardLeft) * 180 / Math.PI;
  if (angle < -25 || angle > 115) return null;
  if (angle <= 25) return { mode: "long-edge", normal: { x: leftSign, y: 0 }, fingerDirection: { x: 0, y: nearSign } };
  if (angle <= 65) {
    return {
      mode: "corner",
      normal: { x: leftSign * Math.SQRT1_2, y: nearSign * Math.SQRT1_2 },
      fingerDirection: { x: leftSign * Math.SQRT1_2, y: -nearSign * Math.SQRT1_2 },
    };
  }
  return { mode: "short-edge", normal: { x: 0, y: nearSign }, fingerDirection: { x: leftSign, y: 0 } };
}

export interface DealerRevealOptions {
  keepFocus?: boolean;
  threshold?: number;
  onThreshold?: (resume: () => void) => void;
}

interface SceneCard {
  group: THREE.Group;
  back: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  face: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  flapBack: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  flapFace: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  finger: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  tableTarget: THREE.Vector3;
  target: THREE.Vector3;
  revealed: boolean;
  side: Side;
  originalBackMap: THREE.Texture;
  revealCanvas: HTMLCanvasElement | null;
  revealTexture: THREE.CanvasTexture | null;
}

interface ChipMotion {
  group: THREE.Group;
  start: THREE.Vector3;
  target: THREE.Vector3;
  delay: number;
}

export class TableScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
  private cards: SceneCard[] = [];
  private textures: THREE.Texture[] = [];
  private disposed = false;
  private dealStartedAt = 0;
  private dealStartIndex = 0;
  private dealDone = false;
  private pushStartedAt = 0;
  private pushStartPositions: THREE.Vector3[] = [];
  private onDealComplete: () => void = () => undefined;
  private focusTarget: { position: THREE.Vector3; lookAt: THREE.Vector3; done: () => void } | null = null;
  private cameraLookAt = new THREE.Vector3(0, 0, 0);
  private homeCameraPosition = new THREE.Vector3(0, 7.4, 9.2);
  private homeCameraLookAt = new THREE.Vector3(0, 0, 0);
  private squeezeIndex: number | null = null;
  private squeezeProgress = 0;
  private squeezeDragging = false;
  private squeezeCompleting = false;
  private squeezePaused = false;
  private squeezeThresholdTriggered = false;
  private squeezeThreshold = 0.32;
  private squeezeStartProjection = 0;
  private squeezeAttempt = 0;
  private squeezeLastPointer = new THREE.Vector2();
  private foldNormal = new THREE.Vector2(0, -1);
  private foldOffset = 1;
  private fingerDirection = new THREE.Vector2(-1, 0);
  private fingerRemovalProgress = 0;
  private fingerIntentDistance = 0;
  private fingerRemoving = false;
  private onSqueezeProgress: (value: number) => void = () => undefined;
  private onSqueezeThreshold: (() => void) | null = null;
  private onSqueezeComplete: () => void = () => undefined;
  private settlementChipGroups: THREE.Group[] = [];
  private chipMotions: ChipMotion[] = [];
  private chipTransferStartedAt = 0;
  private chipTransferDone = false;
  private onChipTransferComplete: () => void = () => undefined;
  private selectableCardIndices = new Set<number>();
  private hoveredCardIndex: number | null = null;
  private onCardSelect: (index: number) => void = () => undefined;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    host.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.pointerUp);
    this.camera.position.copy(this.homeCameraPosition);
    this.cameraLookAt.copy(this.homeCameraLookAt);

    this.scene.add(new THREE.HemisphereLight(0xfff0cf, 0x0b271e, 2.6));
    const light = new THREE.DirectionalLight(0xffd99b, 3.8);
    light.position.set(-4, 7, 5);
    light.castShadow = true;
    this.scene.add(light);
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(16, 11), new THREE.MeshStandardMaterial({ color: 0x124534, roughness: 0.92 }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);
    this.addCardArea("PLAYER", 0x77c5ed, -4.45);
    this.addCardArea("BANKER", 0xef9b87, 4.45);
    this.addCardShoe();
    window.addEventListener("resize", this.resize);
    this.resize();
    this.animate();
  }

  deal(cards: TableCard[], revealed: Set<number>, onDone: () => void, animateFromIndex: number | null = null, ownedSide: Side | null = null): void {
    this.cards.forEach((entry) => this.scene.remove(entry.group));
    this.cards = cards.map((entry, index) => this.createCard(entry, revealed.has(index), ownedSide));
    this.dealStartIndex = animateFromIndex ?? cards.length;
    this.dealStartedAt = animateFromIndex === null ? 0 : performance.now();
    this.dealDone = animateFromIndex === null;
    this.pushStartedAt = 0;
    this.pushStartPositions = [];
    this.onDealComplete = onDone;
    this.cards.forEach((entry, index) => {
      if (animateFromIndex === null || index < animateFromIndex) entry.group.position.copy(entry.target);
    });
  }

  focus(index: number, onDone: () => void): void {
    const entry = this.cards[index];
    if (!entry) return;
    this.focusTarget = {
      position: new THREE.Vector3(entry.target.x, 3.15, entry.target.z + 3.4),
      lookAt: new THREE.Vector3(entry.target.x, 0, entry.target.z),
      done: onDone,
    };
  }

  setCardSelection(indices: number[], onSelect: (index: number) => void): void {
    this.clearCardHover();
    this.selectableCardIndices = new Set(indices.filter((index) => {
      const entry = this.cards[index];
      return Boolean(entry && !entry.revealed);
    }));
    this.onCardSelect = onSelect;
    this.renderer.domElement.style.cursor = this.selectableCardIndices.size ? "pointer" : "default";
  }

  activeCardScreenBounds(): { left: number; top: number; right: number; bottom: number } | null {
    const entry = this.squeezeIndex === null ? null : this.cards[this.squeezeIndex];
    if (!entry) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    entry.group.updateWorldMatrix(true, false);
    this.camera.updateMatrixWorld();
    const points = [
      new THREE.Vector3(-0.575, -0.85, 0),
      new THREE.Vector3(0.575, -0.85, 0),
      new THREE.Vector3(0.575, 0.85, 0),
      new THREE.Vector3(-0.575, 0.85, 0),
    ].map((point) => entry.group.localToWorld(point).project(this.camera));
    const xs = points.map((point) => bounds.left + (point.x + 1) * bounds.width / 2);
    const ys = points.map((point) => bounds.top + (1 - point.y) * bounds.height / 2);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  showRevealed(index: number): void {
    const entry = this.cards[index];
    if (!entry) return;
    entry.back.visible = false;
    entry.face.visible = true;
    entry.revealed = true;
  }

  setCard(index: number, card: Card): void {
    const entry = this.cards[index];
    if (!entry) return;
    const texture = this.faceTexture(card);
    entry.face.material.map = texture;
    entry.face.material.needsUpdate = true;
    entry.flapFace.material.map = this.mirroredTexture(texture);
    entry.flapFace.material.needsUpdate = true;
  }

  beginSqueeze(index: number, onProgress: (value: number) => void, onComplete: () => void, onThreshold: (() => void) | null = null): void {
    const entry = this.cards[index];
    if (!entry) return;
    this.squeezeIndex = index;
    this.squeezeCompleting = false;
    this.squeezePaused = false;
    this.squeezeThresholdTriggered = false;
    this.squeezeProgress = 0;
    this.fingerRemovalProgress = 0;
    this.fingerIntentDistance = 0;
    this.fingerRemoving = false;
    this.onSqueezeProgress = onProgress;
    this.onSqueezeThreshold = onThreshold;
    this.onSqueezeComplete = onComplete;
    this.foldNormal.set(0, -1);
    this.foldOffset = this.foldSupport(this.foldNormal);
    entry.face.visible = false;
    entry.flapBack.visible = true;
    entry.flapFace.visible = true;
    entry.finger.visible = false;
    entry.finger.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    entry.finger.material.opacity = 1;
    entry.flapBack.material.transparent = true;
    entry.flapFace.material.transparent = true;
    entry.back.material.transparent = true;
    this.renderer.domElement.style.cursor = "grab";
  }

  quickSqueeze(): void {
    if (this.squeezeIndex === null) return;
    if (this.onSqueezeThreshold && !this.squeezeThresholdTriggered) {
      this.pauseSqueezeAtThreshold();
      return;
    }
    this.squeezeProgress = 1;
    this.onSqueezeProgress(1);
    this.completeSqueeze();
  }

  divineMashStep(edge: "short" | "long", progress: number): void {
    if (this.squeezeIndex === null || this.squeezeCompleting) return;
    const entry = this.cards[this.squeezeIndex]!;
    this.foldNormal.set(edge === "short" ? 0 : -1, edge === "short" ? -1 : 0);
    this.fingerDirection.set(edge === "short" ? -1 : 0, edge === "short" ? 0 : -1);
    this.squeezeProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.foldOffset = this.foldSupport(this.foldNormal) * (1 - this.squeezeProgress);
    entry.face.visible = false;
    entry.flapBack.visible = true;
    entry.flapFace.visible = true;
    entry.finger.visible = true;
    this.updateSqueezeTexture();
  }

  resetDivineMash(): void {
    if (this.squeezeIndex === null || this.squeezeCompleting) return;
    const entry = this.cards[this.squeezeIndex]!;
    this.squeezeProgress = 0;
    this.foldOffset = this.foldSupport(this.foldNormal);
    entry.face.visible = false;
    entry.flapBack.visible = false;
    entry.flapFace.visible = false;
    entry.finger.visible = false;
    entry.back.visible = true;
    entry.back.material.map = entry.originalBackMap;
    entry.back.material.needsUpdate = true;
  }

  resumeSqueezeAndComplete(): void {
    if (this.squeezeIndex === null || !this.squeezePaused || this.squeezeCompleting) return;
    this.squeezePaused = false;
    const start = this.squeezeProgress;
    const startedAt = performance.now();
    const finish = (now: number) => {
      if (this.squeezeIndex === null) return;
      const progress = Math.min((now - startedAt) / 300, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      this.squeezeProgress = THREE.MathUtils.lerp(start, 1, eased);
      this.foldOffset = this.foldSupport(this.foldNormal) * (1 - this.squeezeProgress);
      this.updateSqueezeTexture();
      this.onSqueezeProgress(this.squeezeProgress);
      if (progress < 1) requestAnimationFrame(finish);
      else this.completeSqueeze();
    };
    requestAnimationFrame(finish);
  }

  returnToTable(onDone: () => void = () => undefined): void {
    this.focusTarget = {
      position: this.homeCameraPosition.clone(),
      lookAt: this.homeCameraLookAt.clone(),
      done: onDone,
    };
  }

  showWagerChips(side: Outcome, chips: TableChip[]): void {
    this.clearSettlementChips();
    const { wager } = settlementChipPositions(side);
    const wagerPosition = new THREE.Vector3(wager.x, wager.y, wager.z);
    this.createChipPile(wagerPosition, chips);
  }

  animateChipSettlement(kind: ChipSettlementKind, side: Outcome, wagerChips: TableChip[], payoutChips: TableChip[], onDone: () => void): void {
    this.clearSettlementChips();
    const positions = settlementChipPositions(side);
    const dealer = new THREE.Vector3(positions.dealer.x, positions.dealer.y, positions.dealer.z);
    const wager = new THREE.Vector3(positions.wager.x, positions.wager.y, positions.wager.z);
    const returned = new THREE.Vector3(positions.returned.x, positions.returned.y, positions.returned.z);

    if (kind === "win") {
      this.createChipPile(wager, wagerChips);
    }

    const movingChips = kind === "win" ? payoutChips : wagerChips;
    const start = (kind === "win" ? dealer : wager).clone();
    const target = (kind === "lose" ? dealer : kind === "push" ? returned : wager).clone();
    if (kind === "win") target.z -= 0.68;
    const group = this.createChipPile(start, movingChips);
    this.chipMotions.push({ group, start, target, delay: 0 });

    this.onChipTransferComplete = onDone;
    this.chipTransferDone = false;
    this.chipTransferStartedAt = performance.now() + 220;
  }

  revealByDealer(index: number, onDone: () => void): void {
    this.focus(index, () => this.revealFocusedByDealer(index, onDone));
  }

  revealFocusedByDealer(index: number, onDone: () => void, options: DealerRevealOptions = {}): void {
    const entry = this.cards[index];
    if (!entry) return;
    const threshold = options.threshold ?? 1;
    let progress = 0;
    let lastAt = performance.now();
    let thresholdTriggered = false;
    let paused = false;
    const applyProgress = () => {
      const scale = Math.abs(Math.cos(progress * Math.PI));
      entry.group.scale.x = Math.max(scale, 0.03);
      if (progress >= 0.5) {
        entry.back.visible = false;
        entry.face.visible = true;
      }
    };
    const resume = () => {
      if (!paused) return;
      paused = false;
      lastAt = performance.now();
      requestAnimationFrame(flip);
    };
    const flip = (now: number) => {
      if (paused) return;
      progress = Math.min(progress + (now - lastAt) / 460, 1);
      lastAt = now;
      if (!thresholdTriggered && options.onThreshold && progress >= threshold) {
        progress = threshold;
        thresholdTriggered = true;
        paused = true;
        applyProgress();
        options.onThreshold(resume);
        return;
      }
      applyProgress();
      if (progress < 1) requestAnimationFrame(flip);
      else {
        entry.group.scale.x = 1;
        entry.revealed = true;
        if (options.keepFocus) {
          onDone();
          return;
        }
        window.setTimeout(() => {
          this.resetCamera();
          window.setTimeout(onDone, 280);
        }, 340);
      }
    };
    requestAnimationFrame(flip);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("resize", this.resize);
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.pointerUp);
    this.clearSettlementChips();
    this.textures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.host.replaceChildren();
  }

  private createChipPile(position: THREE.Vector3, chips: TableChip[]): THREE.Group {
    const group = new THREE.Group();
    // Keep the card's local squeeze geometry unchanged while presenting a larger table card.
    group.scale.setScalar(2);
    const grouped = new Map<string, TableChip[]>();
    chips.forEach((chip) => {
      const key = `${chip.colorIndex}:${chip.value}`;
      const stack = grouped.get(key) ?? [];
      stack.push(chip);
      grouped.set(key, stack);
    });
    const stacks = [...grouped.values()];
    stacks.forEach((stack, stackIndex) => {
      const stackX = (stackIndex - (stacks.length - 1) / 2) * 0.68;
      stack.forEach((chipInfo, chipIndex) => {
        const color = this.chipColor(chipInfo.colorIndex);
        const height = chipIndex * 0.09;
        const chip = new THREE.Mesh(
          new THREE.CylinderGeometry(0.31, 0.31, 0.084, 32),
          new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.08 }),
        );
        chip.position.set(stackX, height, 0);
        chip.rotation.y = chipIndex * 0.14;
        chip.castShadow = true;
        group.add(chip);

        const top = new THREE.Mesh(
          new THREE.CircleGeometry(0.27, 32),
          new THREE.MeshBasicMaterial({ map: this.chipFaceTexture(chipInfo), transparent: true }),
        );
        top.rotation.x = -Math.PI / 2;
        top.position.set(stackX, height + 0.043, 0);
        group.add(top);
      });
    });
    group.position.copy(position);
    this.scene.add(group);
    this.settlementChipGroups.push(group);
    return group;
  }

  private chipColor(colorIndex: number): number {
    return [0x202522, 0xa5473f, 0xa9782f, 0x594482, 0x34807b, 0xd6d5cb][colorIndex] ?? 0x355f85;
  }

  private chipFaceTexture(chip: TableChip): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const color = `#${this.chipColor(chip.colorIndex).toString(16).padStart(6, "0")}`;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f2e2b9";
    ctx.lineWidth = 13;
    ctx.setLineDash([22, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(128, 128, 78, 0, Math.PI * 2);
    ctx.stroke();
    const label = chip.value >= 1_000 && chip.value % 1_000 === 0 ? `${chip.value / 1_000}K` : String(chip.value);
    ctx.fillStyle = chip.colorIndex === 2 || chip.colorIndex === 5 ? "#20231f" : "#fff3cf";
    ctx.font = `900 ${label.length >= 4 ? 48 : 58}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 132);
    return this.canvasTexture(canvas);
  }

  private clearSettlementChips(): void {
    this.settlementChipGroups.forEach((group) => {
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      this.scene.remove(group);
    });
    this.settlementChipGroups = [];
    this.chipMotions = [];
    this.chipTransferStartedAt = 0;
  }

  private createCard(entry: TableCard, revealed: boolean, ownedSide: Side | null): SceneCard {
    const group = new THREE.Group();
    const positions = tableCardPositions(entry, ownedSide);
    const tableTarget = new THREE.Vector3(positions.table.x, positions.table.y, positions.table.z);
    const target = new THREE.Vector3(positions.resting.x, positions.resting.y, positions.resting.z);
    group.position.set(0, 0.05, -3.75);
    group.rotation.x = -Math.PI / 2;
    const geometry = new THREE.PlaneGeometry(1.15, 1.7);
    const back = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.backTexture(), side: THREE.DoubleSide }));
    const face = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({ map: this.faceTexture(entry.card), side: THREE.DoubleSide, transparent: true }));
    const flapGeometry = new THREE.BufferGeometry();
    const flapBack = new THREE.Mesh(flapGeometry, new THREE.MeshBasicMaterial({ map: back.material.map, side: THREE.FrontSide }));
    const flapFace = new THREE.Mesh(flapGeometry, new THREE.MeshBasicMaterial({ map: this.mirroredTexture(face.material.map!), side: THREE.BackSide, transparent: true }));
    const finger = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xc58f72, side: THREE.DoubleSide, transparent: true }));
    face.position.z = -0.004;
    face.visible = revealed;
    back.visible = !revealed;
    flapBack.visible = false;
    flapFace.visible = false;
    finger.visible = false;
    flapBack.position.z = 0.006;
    flapFace.position.z = 0.006;
    group.add(back, face, flapBack, flapFace, finger);
    this.scene.add(group);
    return {
      group, back, face, flapBack, flapFace, finger, tableTarget, target, revealed,
      side: entry.side,
      originalBackMap: back.material.map!,
      revealCanvas: null,
      revealTexture: null,
    };
  }

  private pointerDown = (event: PointerEvent) => {
    if (this.squeezeIndex === null) {
      const index = this.selectableCardAtPointer(event);
      if (index === null) return;
      if (event.cancelable) event.preventDefault();
      const onSelect = this.onCardSelect;
      this.selectableCardIndices.clear();
      this.clearCardHover();
      this.renderer.domElement.style.cursor = "default";
      onSelect(index);
      return;
    }
    if (this.squeezeProgress >= 1 || this.squeezeCompleting || this.squeezePaused) return;
    const local = this.pointerOnCardPlane(event);
    if (!local) return;
    const entry = this.cards[this.squeezeIndex]!;
    const snapped = snapSqueezeDirection(local.x, local.y, "player");
    if (!snapped) return;
    if (event.cancelable) event.preventDefault();
    this.squeezeAttempt += 1;
    this.foldNormal.set(snapped.normal.x, snapped.normal.y);
    this.fingerDirection.set(snapped.fingerDirection.x, snapped.fingerDirection.y);
    this.fingerRemovalProgress = 0;
    this.fingerIntentDistance = 0;
    this.fingerRemoving = false;
    entry.finger.visible = true;
    this.squeezeLastPointer.set(local.x, local.y);
    this.squeezeStartProjection = this.foldNormal.dot(new THREE.Vector2(local.x, local.y));
    this.foldOffset = this.foldSupport(this.foldNormal);
    this.squeezeProgress = 0;
    this.updateSqueezeTexture();
    this.squeezeDragging = true;
    this.renderer.domElement.style.cursor = "grabbing";
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    if (this.squeezeIndex === null) {
      const hovered = this.selectableCardAtPointer(event);
      if (hovered !== this.hoveredCardIndex) {
        this.clearCardHover();
        this.hoveredCardIndex = hovered;
        if (hovered !== null) this.cards[hovered]!.group.scale.set(1.04, 1.04, 1.04);
      }
      this.renderer.domElement.style.cursor = hovered === null ? "default" : "pointer";
      return;
    }
    if (!this.squeezeDragging) return;
    if (event.cancelable) event.preventDefault();
    const local = this.pointerOnCardPlane(event);
    if (!local) return;
    const pointer = new THREE.Vector2(local.x, local.y);
    const delta = pointer.clone().sub(this.squeezeLastPointer);
    this.squeezeLastPointer.copy(pointer);
    const removalDelta = delta.dot(this.fingerDirection);
    const inwardDelta = -delta.dot(this.foldNormal);

    if (!this.fingerRemoving) {
      if (removalDelta > 0 && removalDelta > Math.abs(inwardDelta) * 1.8) {
        this.fingerIntentDistance += removalDelta;
      } else if (Math.abs(inwardDelta) >= Math.max(removalDelta, 0)) {
        this.fingerIntentDistance = Math.max(0, this.fingerIntentDistance - Math.abs(inwardDelta));
      }
      if (this.fingerIntentDistance >= 0.1) this.fingerRemoving = true;
    }

    if (this.fingerRemoving) {
      if (inwardDelta > Math.abs(removalDelta) * 1.6 && inwardDelta > 0.003) {
        this.fingerRemoving = false;
        this.fingerIntentDistance = 0;
      } else {
        this.fingerRemovalProgress = THREE.MathUtils.clamp(this.fingerRemovalProgress + removalDelta / 0.42, 0, 1);
        this.updateSqueezeTexture();
        return;
      }
    }

    const projection = this.foldNormal.dot(pointer);
    const travel = this.foldSupport(this.foldNormal);
    this.squeezeProgress = THREE.MathUtils.clamp((this.squeezeStartProjection - projection) / travel, 0, 1);
    if (this.onSqueezeThreshold && !this.squeezeThresholdTriggered && this.squeezeProgress >= this.squeezeThreshold) {
      this.pauseSqueezeAtThreshold(event.pointerId);
      return;
    }
    this.foldOffset = this.foldSupport(this.foldNormal) * (1 - this.squeezeProgress);
    this.updateSqueezeTexture();
    this.onSqueezeProgress(this.squeezeProgress);
    if (this.foldAdvance() >= SQUEEZE_COMPLETE_PROGRESS) {
      this.squeezeDragging = false;
      this.quickSqueeze();
    }
  };

  private pointerUp = (event?: PointerEvent) => {
    if (!this.squeezeDragging) return;
    if (event?.cancelable) event.preventDefault();
    this.squeezeDragging = false;
    this.renderer.domElement.style.cursor = "grab";
    if (this.foldAdvance() >= SQUEEZE_COMPLETE_PROGRESS) this.quickSqueeze();
    else {
      const attempt = this.squeezeAttempt;
      const start = this.squeezeProgress;
      const fingerStart = this.fingerRemovalProgress;
      const startedAt = performance.now();
      const rebound = (now: number) => {
        if (attempt !== this.squeezeAttempt || this.squeezeIndex === null || this.squeezeDragging || this.squeezeCompleting || this.squeezePaused) return;
        const t = Math.min((now - startedAt) / 240, 1);
        this.squeezeProgress = start * (1 - t) * (1 - t);
        this.fingerRemovalProgress = fingerStart * (1 - t) * (1 - t);
        this.foldOffset = this.foldSupport(this.foldNormal) * (1 - this.squeezeProgress);
        this.updateSqueezeTexture();
        this.onSqueezeProgress(this.squeezeProgress);
        if (t < 1) requestAnimationFrame(rebound);
        else {
          const entry = this.cards[this.squeezeIndex]!;
          entry.finger.visible = false;
          entry.finger.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
        }
      };
      requestAnimationFrame(rebound);
    }
  };

  private pauseSqueezeAtThreshold(pointerId?: number): void {
    if (this.squeezeIndex === null || this.squeezeThresholdTriggered) return;
    this.squeezeThresholdTriggered = true;
    this.squeezePaused = true;
    this.squeezeDragging = false;
    this.squeezeProgress = this.squeezeThreshold;
    this.foldOffset = this.foldSupport(this.foldNormal) * (1 - this.squeezeProgress);
    this.updateSqueezeTexture();
    this.onSqueezeProgress(this.squeezeProgress);
    this.renderer.domElement.style.cursor = "default";
    if (pointerId !== undefined && this.renderer.domElement.hasPointerCapture(pointerId)) {
      this.renderer.domElement.releasePointerCapture(pointerId);
    }
    this.onSqueezeThreshold?.();
  }

  private pointerOnCardPlane(event: PointerEvent): THREE.Vector3 | null {
    if (this.squeezeIndex === null) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const entry = this.cards[this.squeezeIndex]!;
    entry.group.updateWorldMatrix(true, false);
    const worldNormal = new THREE.Vector3(0, 0, 1).transformDirection(entry.group.matrixWorld);
    const worldPoint = entry.group.localToWorld(new THREE.Vector3(0, 0, 0));
    const intersection = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(worldNormal, worldPoint), new THREE.Vector3());
    return intersection ? entry.group.worldToLocal(intersection) : null;
  }

  private selectableCardAtPointer(event: PointerEvent): number | null {
    if (!this.selectableCardIndices.size) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const pointer = new THREE.Vector2(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    this.scene.updateMatrixWorld(true);
    const meshes = [...this.selectableCardIndices].flatMap((index) => {
      const entry = this.cards[index];
      return entry ? [entry.back, entry.face] : [];
    });
    const hit = raycaster.intersectObjects(meshes, false)[0]?.object;
    if (!hit) return null;
    return [...this.selectableCardIndices].find((index) => {
      const entry = this.cards[index];
      return entry?.back === hit || entry?.face === hit;
    }) ?? null;
  }

  private clearCardHover(): void {
    if (this.hoveredCardIndex !== null) this.cards[this.hoveredCardIndex]?.group.scale.set(1, 1, 1);
    this.hoveredCardIndex = null;
  }

  private foldSupport(normal: THREE.Vector2): number {
    return Math.abs(normal.x) * 0.575 + Math.abs(normal.y) * 0.85;
  }

  private foldAdvance(): number {
    const totalDistance = this.foldSupport(this.foldNormal);
    return totalDistance > 0 ? THREE.MathUtils.clamp(1 - this.foldOffset / totalDistance, 0, 1) : 1;
  }

  private updateSqueezeTexture(): void {
    const entry = this.squeezeIndex === null ? null : this.cards[this.squeezeIndex];
    if (!entry) return;
    const backCanvas = entry.originalBackMap.image as HTMLCanvasElement;
    if (!entry.revealCanvas) {
      entry.revealCanvas = document.createElement("canvas");
      entry.revealCanvas.width = backCanvas.width;
      entry.revealCanvas.height = backCanvas.height;
      entry.revealTexture = this.canvasTexture(entry.revealCanvas);
    }
    entry.back.material.map = entry.revealTexture;
    entry.back.material.needsUpdate = true;
    const canvas = entry.revealCanvas;
    const ctx = canvas.getContext("2d")!;
    const width = canvas.width;
    const height = canvas.height;
    const toLocal = ({ x, y }: { x: number; y: number }) => new THREE.Vector2(x / width * 1.15 - 0.575, 0.85 - y / height * 1.7);
    const distance = (point: { x: number; y: number }) => {
      const local = toLocal(point);
      return this.foldNormal.dot(local) - this.foldOffset;
    };
    let polygon = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    const clipped: typeof polygon = [];
    polygon.forEach((current, index) => {
      const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
      const currentInside = distance(current) >= 0;
      const previousInside = distance(previous) >= 0;
      if (currentInside !== previousInside) {
        const previousDistance = distance(previous);
        const ratio = -previousDistance / (distance(current) - previousDistance);
        clipped.push({ x: previous.x + (current.x - previous.x) * ratio, y: previous.y + (current.y - previous.y) * ratio });
      }
      if (currentInside) clipped.push(current);
    });
    polygon = clipped;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(backCanvas, 0, 0);
    if (polygon.length >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(polygon[0]!.x, polygon[0]!.y);
      polygon.slice(1).forEach(({ x, y }) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.clip();
      ctx.clearRect(0, 0, width, height);
      ctx.restore();
    }
    const points = this.foldLineIntersections(width, height);
    if (this.squeezeProgress > 0 && this.squeezeProgress < 1) {
      if (points.length >= 2) {
        ctx.strokeStyle = "rgba(235,207,137,.92)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        ctx.lineTo(points[1]!.x, points[1]!.y);
        ctx.stroke();
      }
    }
    entry.revealTexture!.needsUpdate = true;
    this.updateFoldFlap(entry, polygon, points, width, height);
  }

  private foldLineIntersections(width: number, height: number): { x: number; y: number }[] {
    const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    const local = (point: { x: number; y: number }) => new THREE.Vector2(point.x / width * 1.15 - 0.575, 0.85 - point.y / height * 1.7);
    const value = (point: { x: number; y: number }) => this.foldNormal.dot(local(point)) - this.foldOffset;
    const intersections: { x: number; y: number }[] = [];
    corners.forEach((start, index) => {
      const end = corners[(index + 1) % corners.length]!;
      const startValue = value(start);
      const endValue = value(end);
      if (startValue === 0) intersections.push(start);
      if (startValue * endValue < 0) {
        const ratio = -startValue / (endValue - startValue);
        intersections.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
      }
    });
    return intersections.filter((point, index) => intersections.findIndex((other) => Math.hypot(point.x - other.x, point.y - other.y) < 0.5) === index).slice(0, 2);
  }

  private updateFoldFlap(entry: SceneCard, polygon: { x: number; y: number }[], linePoints: { x: number; y: number }[], width: number, height: number): void {
    if (polygon.length < 3 || this.squeezeProgress <= 0) {
      entry.flapBack.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      this.updateRestingFinger(entry);
      return;
    }
    if (linePoints.length < 2) {
      this.updateRestingFinger(entry);
      return;
    }
    const toLocal = ({ x, y }: { x: number; y: number }) => new THREE.Vector3(x / width * 1.15 - 0.575, 0.85 - y / height * 1.7, 0);
    const lineStart = toLocal(linePoints[0]!);
    const lineEnd = toLocal(linePoints[1]!);
    const axis = lineEnd.clone().sub(lineStart).normalize();
    const source = polygon.map(toLocal);
    let angle = Math.PI * 0.82;
    const rotate = (point: THREE.Vector3, radians: number) => point.clone().sub(lineStart).applyAxisAngle(axis, radians).add(lineStart);
    const supportCorner = new THREE.Vector3(Math.sign(this.foldNormal.x || 1) * 0.575, Math.sign(this.foldNormal.y || 1) * 0.85, 0);
    if (rotate(supportCorner, angle).z < 0) angle = -angle;
    const folded = source.map((point) => rotate(point, angle));
    const positions: number[] = [];
    const uvs: number[] = [];
    for (let index = 1; index < folded.length - 1; index += 1) {
      for (const vertexIndex of [0, index + 1, index]) {
        const point = folded[vertexIndex]!;
        const original = source[vertexIndex]!;
        positions.push(point.x, point.y, point.z);
        uvs.push((original.x + 0.575) / 1.15, (original.y + 0.85) / 1.7);
      }
    }
    entry.flapBack.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    entry.flapBack.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    entry.flapBack.geometry.computeVertexNormals();
    this.updateFinger(entry, lineStart, axis, angle);
  }

  private updateFinger(entry: SceneCard, lineStart: THREE.Vector3, axis: THREE.Vector3, angle: number): void {
    const anchor = this.fingerAnchor(entry);
    if (this.fingerRemovalProgress >= 0.995) {
      entry.finger.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      return;
    }

    const center = anchor.add(new THREE.Vector3(this.fingerDirection.x, this.fingerDirection.y, 0).multiplyScalar(this.fingerRemovalProgress * 0.55));
    const rotate = (point: THREE.Vector3) => point.clone().sub(lineStart).applyAxisAngle(axis, angle).add(lineStart);
    const surfaceNormal = new THREE.Vector3(0, 0, 1).applyAxisAngle(axis, angle).multiplyScalar(-0.014);
    this.setFingerGeometry(entry, center, (point) => rotate(point).add(surfaceNormal));
  }

  private updateRestingFinger(entry: SceneCard): void {
    if (this.fingerRemovalProgress >= 0.995) {
      entry.finger.geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
      return;
    }
    const center = this.fingerAnchor(entry).add(
      new THREE.Vector3(this.fingerDirection.x, this.fingerDirection.y, 0).multiplyScalar(this.fingerRemovalProgress * 0.55),
    );
    this.setFingerGeometry(entry, center, (point) => point.add(new THREE.Vector3(0, 0, 0.014)));
  }

  private fingerAnchor(_entry: SceneCard): THREE.Vector3 {
    const sign = -1;
    return new THREE.Vector3(sign * 0.45, sign * 0.63, 0);
  }

  private setFingerGeometry(entry: SceneCard, center: THREE.Vector3, transform: (point: THREE.Vector3) => THREE.Vector3): void {
    const positions: number[] = [];
    const segments = 18;
    const transformedCenter = transform(center.clone());
    for (let index = 0; index < segments; index += 1) {
      const startAngle = index / segments * Math.PI * 2;
      const endAngle = (index + 1) / segments * Math.PI * 2;
      const start = transform(center.clone().add(new THREE.Vector3(Math.cos(startAngle) * 0.16, Math.sin(startAngle) * 0.25, 0)));
      const end = transform(center.clone().add(new THREE.Vector3(Math.cos(endAngle) * 0.16, Math.sin(endAngle) * 0.25, 0)));
      positions.push(...transformedCenter.toArray(), ...start.toArray(), ...end.toArray());
    }
    entry.finger.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    entry.finger.geometry.computeVertexNormals();
  }

  private completeSqueeze = () => {
    if (this.squeezeIndex === null || this.squeezeCompleting) return;
    this.squeezeCompleting = true;
    const index = this.squeezeIndex;
    const entry = this.cards[index]!;
    entry.face.visible = true;
    entry.face.material.side = THREE.DoubleSide;
    this.renderer.domElement.style.cursor = "default";
    entry.face.material.transparent = true;
    entry.face.material.opacity = 0;
    entry.face.position.z = 0.14;
    entry.back.material.opacity = 1;
    entry.flapBack.material.opacity = 1;
    entry.flapFace.material.opacity = 1;
    entry.finger.material.opacity = 1;
    const startedAt = performance.now();
    const settleFace = (now: number) => {
      const progress = Math.min((now - startedAt) / 320, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      entry.face.material.opacity = eased;
      entry.back.material.opacity = 1 - eased;
      entry.flapBack.material.opacity = 1 - eased;
      entry.flapFace.material.opacity = 1 - eased;
      entry.finger.material.opacity = 1 - eased;
      entry.face.position.z = THREE.MathUtils.lerp(0.14, -0.004, eased);
      if (progress < 1) requestAnimationFrame(settleFace);
      else {
        entry.back.visible = false;
        entry.flapBack.visible = false;
        entry.flapFace.visible = false;
        entry.finger.visible = false;
        entry.face.material.transparent = false;
        entry.face.material.opacity = 1;
        entry.revealed = true;
        this.squeezeIndex = null;
        window.setTimeout(() => {
          this.squeezeCompleting = false;
          this.onSqueezeComplete();
        }, 500);
      }
    };
    requestAnimationFrame(settleFace);
  };

  private addCardArea(label: string, color: number, x: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 1260;
    canvas.height = 920;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = "rgba(238,228,193,.58)";
    ctx.lineWidth = 6;
    ctx.strokeRect(100, 200, 460, 680);
    ctx.strokeRect(700, 200, 460, 680);
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.font = "700 54px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 630, 120);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 4.6), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.014, -0.92);
    this.scene.add(mesh);
  }

  private addCardShoe(): void {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.38, 1.65),
      new THREE.MeshStandardMaterial({ color: 0x171b18, roughness: 0.72, metalness: 0.08 }),
    );
    body.position.set(0, 0.2, -4.18);
    body.castShadow = true;
    this.scene.add(body);
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.12, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x7d2228, roughness: 0.62 }),
    );
    mouth.position.set(0, 0.16, -3.3);
    this.scene.add(mouth);
  }

  private faceTexture(card: Card): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 720;
    const ctx = canvas.getContext("2d")!;
    const texture = this.canvasTexture(canvas);
    const image = new Image();
    image.addEventListener("load", () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture.needsUpdate = true;
    }, { once: true });
    image.src = cardFaceAsset(card.rank);
    return texture;
  }

  private backTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 720;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#7d2228";
    ctx.fillRect(0, 0, 480, 720);
    ctx.strokeStyle = "#d7ae59";
    ctx.lineWidth = 12;
    ctx.strokeRect(18, 18, 444, 684);
    ctx.strokeStyle = "rgba(255,220,153,.32)";
    ctx.lineWidth = 3;
    for (let x = -720; x < 480; x += 34) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 720, 720); ctx.stroke();
    }
    return this.canvasTexture(canvas);
  }

  private canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    return texture;
  }

  private mirroredTexture(texture: THREE.Texture): THREE.Texture {
    const mirrored = texture.clone();
    mirrored.wrapS = THREE.RepeatWrapping;
    mirrored.repeat.x = -1;
    mirrored.offset.x = 1;
    mirrored.needsUpdate = true;
    this.textures.push(mirrored);
    return mirrored;
  }

  private resetCamera(): void {
    this.returnToTable();
  }

  private resize = () => {
    const width = this.host.clientWidth || 900;
    const height = this.host.clientHeight || 620;
    this.camera.aspect = width / height;
    const distanceScale = THREE.MathUtils.clamp(1.12 / this.camera.aspect, 1, 1.65);
    this.homeCameraPosition.set(0, 7.4 * distanceScale, 9.2 * distanceScale);
    this.homeCameraLookAt.set(0, 0, 0);
    if (!this.focusTarget && this.squeezeIndex === null) {
      this.camera.position.copy(this.homeCameraPosition);
      this.cameraLookAt.copy(this.homeCameraLookAt);
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private animate = () => {
    if (this.disposed) return;
    const now = performance.now();
    if (this.dealStartedAt) {
      const elapsed = now - this.dealStartedAt;
      this.cards.forEach((entry, index) => {
        if (index < this.dealStartIndex) return;
        const progress = THREE.MathUtils.clamp((elapsed - (index - this.dealStartIndex) * 220) / 480, 0, 1);
        const eased = 1 - (1 - progress) * (1 - progress);
        entry.group.position.lerpVectors(new THREE.Vector3(0, 0.05, -3.75), entry.tableTarget, eased);
      });
      if (!this.dealDone && elapsed >= (this.cards.length - this.dealStartIndex) * 220 + 500) {
        this.dealStartedAt = 0;
        this.pushStartPositions = this.cards.map((entry) => entry.group.position.clone());
        const needsPush = this.cards.some((entry) => entry.group.position.distanceTo(entry.target) > 0.01);
        if (needsPush) this.pushStartedAt = now + 220;
        else {
          this.dealDone = true;
          this.onDealComplete();
        }
      }
    }
    if (this.pushStartedAt) {
      const progress = THREE.MathUtils.clamp((now - this.pushStartedAt) / 620, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      this.cards.forEach((entry, index) => {
        const start = this.pushStartPositions[index] ?? entry.tableTarget;
        entry.group.position.lerpVectors(start, entry.target, eased);
        entry.group.position.y += Math.sin(progress * Math.PI) * 0.025;
      });
      if (!this.dealDone && progress >= 1) {
        this.pushStartedAt = 0;
        this.dealDone = true;
        this.cards.forEach((entry) => entry.group.position.copy(entry.target));
        this.onDealComplete();
      }
    }
    if (this.focusTarget) {
      this.camera.position.lerp(this.focusTarget.position, 0.2);
      this.cameraLookAt.lerp(this.focusTarget.lookAt, 0.2);
      if (this.camera.position.distanceTo(this.focusTarget.position) < 0.05 && this.cameraLookAt.distanceTo(this.focusTarget.lookAt) < 0.05) {
        const done = this.focusTarget.done;
        this.focusTarget = null;
        done();
      }
    }
    if (this.chipTransferStartedAt) {
      const elapsed = now - this.chipTransferStartedAt;
      const duration = 980;
      this.chipMotions.forEach((motion) => {
        const progress = THREE.MathUtils.clamp((elapsed - motion.delay) / duration, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        motion.group.position.lerpVectors(motion.start, motion.target, eased);
        motion.group.position.y += Math.sin(progress * Math.PI) * 0.1;
        motion.group.rotation.y = Math.sin(progress * Math.PI) * 0.12;
      });
      const finalDelay = Math.max(0, ...this.chipMotions.map((motion) => motion.delay));
      if (!this.chipTransferDone && elapsed >= finalDelay + duration + 420) {
        this.chipTransferDone = true;
        this.chipTransferStartedAt = 0;
        this.chipMotions.forEach((motion) => motion.group.position.copy(motion.target));
        this.onChipTransferComplete();
      }
    }
    this.camera.lookAt(this.cameraLookAt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  };
}
