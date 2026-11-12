import * as THREE from 'three';
import { MOUSE } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../../app/store';
import type { Tool } from '../../app/types';
import { FURNITURE_CATALOG } from '../../sim/world/furnitureCatalog';
import type { Rect } from '../../sim/world/types';
import type { InspectablePart } from '../models/types';

export interface EditorHost {
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  controls: OrbitControls;
  /** Objects that can be picked (furniture/obstacles/zones/robot/dock). */
  pickables(): THREE.Object3D[];
  floorMeshes(): THREE.Object3D[];
  getItemObject(id: string): THREE.Object3D | undefined;
  robotParts(): InspectablePart[];
  dockParts(): InspectablePart[];
  highlightPart(owner: 'robot' | 'dock' | null, id: string | null): void;
  zonePreview(kind: 'noGo' | 'noMop', r: Rect | null): void;
  api: {
    moveItem(kind: 'furniture' | 'obstacle', id: string, x: number, y: number): void;
    addZone(kind: 'noGo' | 'noMop', r: Rect): void;
    spill(kind: Parameters<EditorApi['spill']>[0], x: number, y: number): void;
    addObstacleAt(kind: Parameters<EditorApi['addObstacleAt']>[0], x: number, y: number): void;
    addFurnitureAt(kind: Parameters<EditorApi['addFurnitureAt']>[0], x: number, y: number): void;
    removeSelected(): void;
  };
  /** Is the layout item movable? */
  isMovable(kind: 'furniture' | 'obstacle', id: string): boolean;
}

type EditorApi = import('../../app/types').AppApi;

/**
 * Pointer interaction with the 3D scene. With an editor tool active, the LEFT mouse button is used by
 * the tool and the camera orbits with the RIGHT button (pan with middle/shift). Without a tool, the
 * camera behaves normally and a click on a robot/dock part opens the inspector.
 */
export class Editor {
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private drag: { kind: 'furniture' | 'obstacle'; id: string; obj: THREE.Object3D; offX: number; offZ: number; startX: number; startZ: number } | null = null;
  private zoneStart: THREE.Vector3 | null = null;
  private zoneRect: Rect | null = null;
  private downAt = { x: 0, y: 0 };
  private tool: Tool = 'none';

  constructor(private readonly host: EditorHost) {
    const d = host.dom;
    d.addEventListener('pointerdown', this.onDown);
    d.addEventListener('pointermove', this.onMove);
    d.addEventListener('pointerup', this.onUp);
    d.addEventListener('contextmenu', this.onContext);
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    const c = this.host.controls;
    const usesLeft = tool !== 'none' && tool !== 'inspect';
    c.mouseButtons = usesLeft ? { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE } : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    this.host.dom.style.cursor = usesLeft ? 'crosshair' : '';
    this.cancelZone();
  }

  private onContext = (e: Event) => e.preventDefault();

  private setRay(e: PointerEvent): void {
    const r = this.host.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.host.camera);
  }

  /** World point on the floor plane under the cursor. */
  private floorPoint(): THREE.Vector3 | null {
    return this.ray.ray.intersectPlane(this.plane, this.hitPoint) ? this.hitPoint.clone() : null;
  }

  private pick(): { kind: string; id: string; partId?: string; owner?: 'robot' | 'dock' } | null {
    const hits = this.ray.intersectObjects(this.host.pickables(), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const ud = o.userData as { pickKind?: string; id?: string; partId?: string };
        if (ud.partId) {
          let r: THREE.Object3D | null = o;
          while (r && r.name !== 'robot' && r.name !== 'dock') r = r.parent;
          return { kind: 'part', id: ud.partId, partId: ud.partId, owner: r?.name === 'dock' ? 'dock' : 'robot' };
        }
        if (ud.pickKind && ud.id) return { kind: ud.pickKind, id: ud.id };
        o = o.parent;
      }
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    this.downAt = { x: e.clientX, y: e.clientY };
    if (e.button !== 0) return;
    const tool = this.tool;
    if (tool === 'none' || tool === 'inspect') return;
    this.setRay(e);
    const st = useStore.getState();
    if (tool === 'noGo' || tool === 'noMop') {
      const p = this.floorPoint();
      if (p) {
        this.zoneStart = p;
        this.host.dom.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (tool === 'select' || tool === 'remove') {
      const hit = this.pick();
      if (hit && (hit.kind === 'furniture' || hit.kind === 'obstacle' || hit.kind === 'zone')) {
        st.set({ selection: { kind: hit.kind, id: hit.id } });
        if (tool === 'remove') {
          this.host.api.removeSelected();
          return;
        }
        if (hit.kind !== 'zone') {
          const kind = hit.kind as 'furniture' | 'obstacle';
          if (!this.host.isMovable(kind, hit.id)) {
            st.notify('This built-in fixture cannot be moved', 'info');
            return;
          }
          const obj = this.host.getItemObject(hit.id);
          const p = this.floorPoint();
          if (obj && p) {
            this.drag = { kind, id: hit.id, obj, offX: obj.position.x - p.x, offZ: obj.position.z - p.z, startX: obj.position.x, startZ: obj.position.z };
            this.host.dom.setPointerCapture(e.pointerId);
          }
        }
      } else if (tool === 'select') st.set({ selection: null });
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.drag) {
      this.setRay(e);
      const p = this.floorPoint();
      if (p) {
        this.drag.obj.position.x = p.x + this.drag.offX;
        this.drag.obj.position.z = p.z + this.drag.offZ;
      }
      return;
    }
    if (this.zoneStart) {
      this.setRay(e);
      const p = this.floorPoint();
      if (!p) return;
      const a = this.zoneStart;
      this.zoneRect = { x: Math.min(a.x, p.x), y: Math.min(a.z, p.z), w: Math.abs(p.x - a.x), h: Math.abs(p.z - a.z) };
      this.host.zonePreview(this.tool === 'noMop' ? 'noMop' : 'noGo', this.zoneRect);
    }
  };

  private onUp = (e: PointerEvent): void => {
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      if (Math.hypot(d.obj.position.x - d.startX, d.obj.position.z - d.startZ) > 0.01) this.host.api.moveItem(d.kind, d.id, d.obj.position.x, d.obj.position.z);
      return;
    }
    if (this.zoneStart) {
      const r = this.zoneRect;
      const kind = this.tool === 'noMop' ? 'noMop' : 'noGo';
      this.cancelZone();
      if (r) this.host.api.addZone(kind, r);
      return;
    }
    if (moved || e.button !== 0) return;
    this.setRay(e);
    const st = useStore.getState();
    const tool = this.tool;
    if (tool === 'none' || tool === 'inspect') {
      const hit = this.pick();
      if (hit?.kind === 'part' && hit.partId && hit.owner) {
        const parts = hit.owner === 'robot' ? this.host.robotParts() : this.host.dockParts();
        const part = parts.find((p) => p.id === hit.partId);
        if (part) {
          st.set({ inspected: { owner: hit.owner, id: part.id, name: part.name, description: part.description } });
          this.host.highlightPart(hit.owner, part.id);
        }
      } else if (tool === 'inspect') {
        st.set({ inspected: null });
        this.host.highlightPart(null, null);
      }
      return;
    }
    const p = this.floorPoint();
    if (!p) return;
    if (tool === 'spill') this.host.api.spill(st.spillKind, p.x, p.z);
    else if (tool === 'addObstacle') this.host.api.addObstacleAt(st.obstacleKind, p.x, p.z);
    else if (tool === 'addFurniture') this.host.api.addFurnitureAt(st.furnitureKind, p.x, p.z);
    else if (tool === 'spot') st.setDraft({ spot: { x: p.x, y: p.z }, kind: 'spot' });
  };

  private cancelZone(): void {
    this.zoneStart = null;
    this.zoneRect = null;
    this.host.zonePreview('noGo', null);
  }

  dispose(): void {
    const d = this.host.dom;
    d.removeEventListener('pointerdown', this.onDown);
    d.removeEventListener('pointermove', this.onMove);
    d.removeEventListener('pointerup', this.onUp);
    d.removeEventListener('contextmenu', this.onContext);
  }
}

export function isMovableFurniture(kind: keyof typeof FURNITURE_CATALOG): boolean {
  return FURNITURE_CATALOG[kind].movable;
}
