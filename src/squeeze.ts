import * as THREE from "three";
import { isRedCard, pipLayout, rankLabel, suitSymbol, type Card } from "./domain";

export class SqueezeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  private cardBack: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  private cardFace: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  private cardGroup: THREE.Group | null = null;
  private textures: THREE.CanvasTexture[] = [];
  private dragging = false;
  private progress = 0;
  private disposed = false;
  private startY = 0;
  private onProgress: (value: number) => void = () => undefined;
  private onComplete: () => void = () => undefined;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    host.append(this.renderer.domElement);
    this.camera.fov = 42;
    this.camera.position.set(0, 5.7, 7.4);
    this.camera.lookAt(0, 0.15, -0.35);
    this.camera.updateProjectionMatrix();

    this.scene.add(new THREE.HemisphereLight(0xfff2d3, 0x162a22, 2.2));
    const key = new THREE.DirectionalLight(0xffdfac, 3.4);
    key.position.set(-3, 5, 5);
    key.castShadow = true;
    this.scene.add(key);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerUp);
    window.addEventListener("resize", this.resize);
    this.resize();
    this.animate();
  }

  show(card: Card, onProgress: (value: number) => void, onComplete: () => void): void {
    if (this.cardGroup) this.scene.remove(this.cardGroup);
    this.progress = 0;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    const backGeometry = new THREE.PlaneGeometry(3.15, 4.55, 32, 44);
    const faceGeometry = backGeometry.clone();
    backGeometry.userData.basePositions = Float32Array.from(backGeometry.attributes.position.array);
    faceGeometry.userData.basePositions = Float32Array.from(faceGeometry.attributes.position.array);
    const backMaterial = new THREE.MeshStandardMaterial({
      map: this.makeBackTexture(),
      roughness: 0.7,
      metalness: 0.02,
      side: THREE.FrontSide,
    });
    const faceMaterial = new THREE.MeshStandardMaterial({
      map: this.makeFaceTexture(card),
      roughness: 0.66,
      metalness: 0.01,
      side: THREE.BackSide,
    });
    this.cardBack = new THREE.Mesh(backGeometry, backMaterial);
    this.cardFace = new THREE.Mesh(faceGeometry, faceMaterial);
    this.cardGroup = new THREE.Group();
    for (const mesh of [this.cardBack, this.cardFace]) {
      mesh.rotation.x = -Math.PI / 2;
      this.cardGroup.add(mesh);
    }
    this.cardGroup.rotation.y = -Math.PI / 4;
    this.cardGroup.position.set(0, 0.015, -0.4);
    this.scene.add(this.cardGroup);
    this.cardBack.castShadow = true;
    this.updateGeometry();
  }

  quickReveal(): void {
    this.progress = 1;
    this.updateGeometry();
    this.onProgress(1);
    window.setTimeout(this.onComplete, 260);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
    this.textures.forEach((texture) => texture.dispose());
    this.host.replaceChildren();
  }

  private pointerDown = (event: PointerEvent) => {
    if (!this.cardBack || this.progress >= 1) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (event.clientY < bounds.top + bounds.height * 0.48) return;
    this.dragging = true;
    this.startY = event.clientY + this.progress * this.dragDistance();
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.progress = THREE.MathUtils.clamp((this.startY - event.clientY) / this.dragDistance(), 0, 1);
    this.updateGeometry();
    this.onProgress(this.progress);
  };

  private pointerUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.progress >= 0.72) {
      this.progress = 1;
      this.updateGeometry();
      this.onProgress(1);
      window.setTimeout(this.onComplete, 220);
    } else {
      const start = this.progress;
      const startedAt = performance.now();
      const rebound = (now: number) => {
        const t = Math.min((now - startedAt) / 260, 1);
        this.progress = start * (1 - t) * (1 - t);
        this.updateGeometry();
        this.onProgress(this.progress);
        if (t < 1) requestAnimationFrame(rebound);
      };
      requestAnimationFrame(rebound);
    }
  };

  private updateGeometry(): void {
    if (!this.cardBack || !this.cardFace) return;
    this.deformGeometry(this.cardBack.geometry);
    this.deformGeometry(this.cardFace.geometry);
  }

  private deformGeometry(geometry: THREE.PlaneGeometry): void {
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const base = geometry.userData.basePositions as Float32Array;
    const diagonal = Math.SQRT1_2;
    const inwardX = -diagonal;
    const inwardY = diagonal;
    const axisX = diagonal;
    const axisY = diagonal;
    const eased = this.progress * this.progress * (3 - 2 * this.progress);
    const foldDepth = 0.2 + eased * 1.55;
    const fullAngle = -eased * Math.PI * 0.94;
    const creaseX = 1.575 + inwardX * foldDepth;
    const creaseY = -2.275 + inwardY * foldDepth;

    for (let index = 0; index < positions.count; index += 1) {
      const x = base[index * 3] ?? 0;
      const y = base[index * 3 + 1] ?? 0;
      const fromCornerX = x - 1.575;
      const fromCornerY = y + 2.275;
      const inwardDistance = fromCornerX * inwardX + fromCornerY * inwardY;

      if (this.progress === 0 || inwardDistance >= foldDepth) {
        positions.setXYZ(index, x, y, 0);
        continue;
      }

      const penetration = foldDepth - inwardDistance;
      const bandProgress = THREE.MathUtils.clamp(penetration / 0.42, 0, 1);
      const bend = bandProgress * bandProgress * (3 - 2 * bandProgress);
      const angle = fullAngle * bend;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const relativeX = x - creaseX;
      const relativeY = y - creaseY;
      const axisDot = axisX * relativeX + axisY * relativeY;
      const crossZ = axisX * relativeY - axisY * relativeX;
      const rotatedX = relativeX * cosine + axisX * axisDot * (1 - cosine);
      const rotatedY = relativeY * cosine + axisY * axisDot * (1 - cosine);
      const rotatedZ = crossZ * sine;
      positions.setXYZ(index, creaseX + rotatedX, creaseY + rotatedY, rotatedZ);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  private dragDistance(): number {
    return THREE.MathUtils.clamp(this.host.clientHeight * 0.58, 260, 390);
  }

  private makeFaceTexture(card: Card): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 920;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f8f4e9";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#c8bda5";
    ctx.lineWidth = 12;
    ctx.strokeRect(18, 18, 604, 884);
    const red = isRedCard(card);
    const rank = rankLabel(card);
    const suit = suitSymbol(card);
    ctx.fillStyle = red ? "#a8262a" : "#171a18";
    ctx.font = "700 82px Georgia";
    ctx.textAlign = "left";
    ctx.fillText(rank, 48, 92);
    ctx.font = "700 68px Georgia";
    ctx.fillText(suit, 50, 158);
    ctx.save();
    ctx.translate(640, 920);
    ctx.rotate(Math.PI);
    ctx.font = "700 82px Georgia";
    ctx.textAlign = "left";
    ctx.fillText(rank, 48, 92);
    ctx.font = "700 68px Georgia";
    ctx.fillText(suit, 50, 158);
    ctx.restore();

    if (card.rank >= 11) {
      ctx.strokeStyle = red ? "#b43439" : "#252a27";
      ctx.lineWidth = 8;
      ctx.strokeRect(145, 155, 350, 610);
      ctx.fillStyle = red ? "#a8262a" : "#171a18";
      ctx.fillRect(158, 168, 324, 584);
      ctx.fillStyle = "#d5aa50";
      ctx.fillRect(178, 188, 284, 544);
      ctx.fillStyle = "#f4eee0";
      ctx.font = "700 130px Georgia";
      ctx.textAlign = "center";
      ctx.fillText(rank, 320, 335);
      ctx.font = "700 150px Georgia";
      ctx.fillText(suit, 320, 545);
      ctx.save();
      ctx.translate(640, 920);
      ctx.rotate(Math.PI);
      ctx.font = "700 130px Georgia";
      ctx.fillText(rank, 320, 335);
      ctx.restore();
    } else {
      const pips = pipLayout(card.rank);
      for (const pip of pips) {
        ctx.save();
        ctx.translate(pip.x * canvas.width, pip.y * canvas.height);
        if (pip.inverted) ctx.rotate(Math.PI);
        const size = card.rank === 1 ? 240 : card.rank >= 8 ? 92 : 118;
        ctx.font = `700 ${size}px Georgia`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(suit, 0, 0);
        ctx.restore();
      }
    }
    return this.makeCanvasTexture(canvas);
  }

  private makeBackTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 920;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#791f25";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#d1a759";
    ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, 600, 880);
    ctx.strokeStyle = "rgba(216, 173, 89, .42)";
    ctx.lineWidth = 2;
    for (let x = -canvas.height; x < canvas.width; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + canvas.height, canvas.height);
      ctx.stroke();
    }
    return this.makeCanvasTexture(canvas);
  }

  private makeCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    return texture;
  }

  private resize = () => {
    const width = this.host.clientWidth || 800;
    const height = this.host.clientHeight || 520;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private animate = () => {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  };
}
