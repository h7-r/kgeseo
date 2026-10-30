/**
 * freeCamera.ts — 검수 둘러보기 카메라 (ReviewBridge 에서 떼어 냄, 10/15)
 *   검수 작업대 둘러보기(ReviewBridge)와 5174 편집 모드 「라이브러리 배치」(placement/LibraryPlaceMode)가 같이 쓴다.
 */
import * as THREE from "three";

import { UNITS_PER_METER } from "../plan/sitePlan";

const U = UNITS_PER_METER;
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * 둘러보기 카메라(10/15 미르: 회전·줌·이동 모두 되게) — 궤도(OrbitControls) 대신 「제자리 둘러보기」.
 *   왼쪽 끌기 = 그 자리에서 고개 돌리기(요·피치) · 오른쪽 끌기 = 화면 평면 이동 · 휠 = 커서 쪽으로 날기 · WASD/QE = 날기.
 *   [왜] 궤도식은 회전 중심이 멀면 회전이 「옆으로 미끄러지는 이동」으로 보이고, 가까우면 이동·줌이 거의 안 된다.
 *   target 은 시점 고정 작업(구역 사진)이 바라볼 곳을 넘기는 자리로만 쓴다 — update() 가 그쪽을 보게 하고 1 m 앞으로 당긴다.
 */
export class FreeCamera {
  enabled = true;
  readonly target = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private drag: { button: number; x: number; y: number; id: number } | null = null;
  constructor(
    private readonly camera: THREE.Camera,
    private readonly dom: HTMLElement,
  ) {
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerup", this.onUp);
    dom.addEventListener("pointercancel", this.onUp);
    dom.addEventListener("contextmenu", this.onMenu);
    this.resetTarget();
  }
  private resetTarget() {
    this.target.copy(this.camera.position).add(this.camera.getWorldDirection(_dir).multiplyScalar(U));
  }
  /** 바깥에서 target 을 바꿨으면 그쪽을 본다(구역 사진 시점) */
  update() {
    if (this.target.distanceToSquared(this.camera.position) < 1e-8) return;
    this.camera.lookAt(this.target);
    this.resetTarget();
  }
  private readonly onMenu = (e: Event) => e.preventDefault();
  private readonly onDown = (e: PointerEvent) => {
    if (!this.enabled || (e.button !== 0 && e.button !== 2)) return;
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, id: e.pointerId };
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트 등 */
    }
  };
  private readonly onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!this.enabled || !d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.button === 0) {
      // 고개 돌리기 — 화면 폭 한 번 끌면 약 180°
      const k = Math.PI / Math.max(1, this.dom.clientWidth);
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= dx * k;
      this.euler.x = Math.max(-1.5, Math.min(1.5, this.euler.x - dy * k));
      this.euler.z = 0;
      this.camera.quaternion.setFromEuler(this.euler);
    } else {
      // 화면 평면 이동 — 1 px ≈ 5 cm, Shift 3배
      const m = 0.05 * U * (e.shiftKey ? 3 : 1);
      _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      _up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(_right, -dx * m).addScaledVector(_up, dy * m);
    }
    this.camera.updateMatrixWorld();
    this.resetTarget();
  };
  private readonly onUp = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.id) {
      try {
        this.dom.releasePointerCapture(e.pointerId);
      } catch {
        /* 무시 */
      }
      this.drag = null;
    }
  };
  dispose() {
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointercancel", this.onUp);
    this.dom.removeEventListener("contextmenu", this.onMenu);
  }
}
