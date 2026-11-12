import type { UiState } from '../app/store';
import type { PerfStats, Quality, WallMode } from '../app/types';
import type { Simulation } from '../sim/Simulation';
import { FURNITURE_CATALOG } from '../sim/world/furnitureCatalog';
import type { HouseLayout, Rect } from '../sim/world/types';
import { CameraRig } from './camera/CameraRig';
import { HouseView } from './house/HouseView';
import { Editor } from './interaction/Editor';
import { Debris, DirtOverlay } from './overlays/DirtOverlay';
import { Labels } from './overlays/Labels';
import { MapOverlay, PlanOverlay, ZoneOverlay } from './overlays/PlanOverlay';
import { SensorOverlay } from './overlays/SensorOverlay';
import { DockView, RobotView } from './RobotView';
import { Stage } from './Stage';

export interface ViewApi {
  moveItem(kind: 'furniture' | 'obstacle', id: string, x: number, y: number): void;
  addZone(kind: 'noGo' | 'noMop', r: Rect): void;
  spill: import('../app/types').AppApi['spill'];
  addObstacleAt: import('../app/types').AppApi['addObstacleAt'];
  addFurnitureAt: import('../app/types').AppApi['addFurnitureAt'];
  removeSelected(): void;
}

/**
 * The 3D view of one Simulation. Purely a consumer of simulation state: it never advances or mutates
 * the simulation (edits go through ViewApi). Sim-bound overlays are rebuilt on reset; house geometry
 * is synced incrementally on layout edits. Every GPU resource is disposed in dispose()/reset.
 */
export class WorldView {
  readonly stage: Stage;
  readonly rig: CameraRig;
  readonly house: HouseView;
  private robot: RobotView;
  private dock: DockView;
  private sim!: Simulation;
  private dirt: DirtOverlay | null = null;
  private debris: Debris | null = null;
  private sensors: SensorOverlay | null = null;
  private plan: PlanOverlay | null = null;
  private mapOverlay: MapOverlay | null = null;
  private readonly zones = new ZoneOverlay();
  private readonly labels: Labels;
  private readonly editor: Editor;
  private ui: UiState;
  private time = 0;
  private quality: Quality;
  private readonly resizeObs: ResizeObserver;
  // adaptive performance
  private fpsWindow: number[] = [];
  private adaptiveLevel = 0;
  private lowFpsTime = 0;
  private highFpsTime = 0;
  private lastFrameMs = 0;

  constructor(
    private readonly container: HTMLElement,
    api: ViewApi,
    ui: UiState,
  ) {
    this.ui = ui;
    this.quality = ui.quality;
    container.style.position = 'relative';
    this.stage = new Stage(container);
    this.rig = new CameraRig(this.stage.camera, this.stage.renderer.domElement);
    this.house = new HouseView({ quality: ui.quality });
    this.robot = new RobotView(ui.quality);
    this.dock = new DockView(ui.quality);
    this.labels = new Labels(container);
    const scene = this.stage.scene;
    scene.add(this.house.root, this.robot.model.root, this.dock.model.root, this.zones.group, this.labels.group);
    this.stage.setQuality(ui.quality);
    this.editor = new Editor({
      camera: this.stage.camera,
      dom: this.stage.renderer.domElement,
      controls: this.rig.controls,
      pickables: () => [this.house.root, this.zones.group, this.robot.model.root, this.dock.model.root],
      floorMeshes: () => this.house.floorMeshes,
      getItemObject: (id) => this.house.getItemObject(id),
      robotParts: () => this.robot.model.parts,
      dockParts: () => this.dock.model.parts,
      highlightPart: (owner, id) => {
        this.robot.model.highlight(owner === 'robot' ? id : null);
        this.dock.model.highlight(owner === 'dock' ? id : null);
      },
      zonePreview: (kind, r) => this.zones.showPreview(kind, r),
      api,
      isMovable: (kind, id) => {
        if (kind === 'obstacle') return true;
        const f = this.sim.layout.furniture.find((x) => x.id === id);
        return !!f && FURNITURE_CATALOG[f.kind].movable;
      },
    });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  private resize(): void {
    this.stage.resize();
    this.labels.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  /** Bind to a (new) simulation: rebuild sim-dependent overlays and reset the camera. */
  setSimulation(sim: Simulation): void {
    const scene = this.stage.scene;
    for (const o of [this.dirt, this.mapOverlay]) if (o) scene.remove(o.mesh);
    for (const o of [this.debris, this.sensors, this.plan]) if (o) scene.remove(o.group);
    this.dirt?.dispose();
    this.debris?.dispose();
    this.sensors?.dispose();
    this.plan?.dispose();
    this.mapOverlay?.dispose();
    this.sim = sim;
    this.dirt = new DirtOverlay(sim);
    this.debris = new Debris(sim, this.quality === 'low' ? 800 : 2400, this.quality === 'low' ? 200 : 700);
    this.sensors = new SensorOverlay(sim);
    this.plan = new PlanOverlay(sim);
    this.mapOverlay = new MapOverlay(sim);
    scene.add(this.dirt.mesh, this.debris.group, this.sensors.group, this.plan.group, this.mapOverlay.mesh);
    this.robot.snap(sim);
    this.dock.place(sim);
    this.syncLayout(sim.layout);
    this.applyUi(this.ui, null);
    this.rig.setMode(this.ui.cameraMode, sim.body, sim.layout.dock, true);
  }

  syncLayout(layout: HouseLayout): void {
    if (!this.sim) return;
    this.house.sync(layout);
    this.zones.sync(layout, this.ui.selection?.kind === 'zone' ? this.ui.selection.id : null);
    this.labels.syncRooms(layout);
    this.labels.setRoomsVisible(this.ui.overlays.roomLabels);
    this.stage.fitBounds(layout.bounds);
    this.rig.setBounds(layout.bounds);
    this.dock.place(this.sim);
    this.house.setHighlight(this.ui.selection && this.ui.selection.kind !== 'zone' ? this.ui.selection.id : null);
  }

  /** Re-sample debris particles after a spill. */
  refreshDebris(): void {
    this.debris?.resample();
  }

  private effectiveWallMode(s: UiState): WallMode {
    if (s.cameraMode === 'cutaway') return 'cutaway';
    if (s.cameraMode === 'lidar' || s.cameraMode === 'topDown') return s.wallMode === 'full' ? 'cutaway' : s.wallMode;
    return s.wallMode;
  }

  applyUi(s: UiState, p: UiState | null): void {
    this.ui = s;
    if (!this.sim) return;
    if (!p || s.cameraMode !== p.cameraMode) this.rig.setMode(s.cameraMode, this.sim.body, this.sim.layout.dock, !p);
    this.house.setWallMode(this.effectiveWallMode(s));
    if (p && s.quality !== p.quality) {
      this.quality = s.quality;
      this.stage.setQuality(s.quality);
      this.house.setQuality(s.quality);
      this.adaptiveLevel = 0;
      this.stage.adaptiveScale = 1;
    }
    const o = s.overlays;
    const lidarMode = s.cameraMode === 'lidar';
    this.dirt?.setView(o.dirt, o.coverage);
    if (this.debris) this.debris.group.visible = o.dirt === 'realistic';
    if (this.sensors) {
      this.sensors.showPoints = o.pointCloud || lidarMode;
      this.sensors.showRays = o.lidarRays || lidarMode;
      this.sensors.showSensors = o.sensors || (s.eduEnabled && (s.eduTopic === 'cliff' || s.eduTopic === 'lidar'));
    }
    if (this.plan) {
      this.plan.showPath = o.path;
      this.plan.showTrail = o.trail;
      this.plan.spotPoint = s.draft.kind === 'spot' ? s.draft.spot : null;
    }
    if (this.mapOverlay) this.mapOverlay.mesh.visible = o.costmap || lidarMode || (s.eduEnabled && (s.eduTopic === 'occupancy' || s.eduTopic === 'astar'));
    this.zones.group.visible = o.zones;
    this.labels.setRoomsVisible(o.roomLabels);
    const exploded = s.cameraMode === 'exploded' ? Math.max(s.explode, 1) : s.explode;
    this.robot.setExplode(exploded);
    this.robot.model.setXray(s.xray || s.cameraMode === 'cutaway');
    this.robot.dustbinTarget = s.dustbinOpen ? 1 : 0;
    this.dock.panelsTarget = s.dockPanels;
    this.dock.model.setCutaway(s.dockCutaway || s.cameraMode === 'cutaway');
    this.editor.setTool(s.tool);
    if (!p || s.selection !== p.selection) {
      this.house.setHighlight(s.selection && s.selection.kind !== 'zone' ? s.selection.id : null);
      this.zones.sync(this.sim.layout, s.selection?.kind === 'zone' ? s.selection.id : null);
    }
    if (p && p.inspected && !s.inspected) {
      this.robot.model.highlight(null);
      this.dock.model.highlight(null);
    }
    this.labels.setTopic(s.eduEnabled ? s.eduTopic : null);
  }

  frame(dt: number, _steps: number): void {
    if (!this.sim) return;
    const t0 = performance.now();
    this.time += dt;
    const sim = this.sim;
    this.stage.checkResize();
    this.robot.update(sim, dt, sim.clock.time);
    this.dock.update(sim, dt, sim.clock.time);
    this.dirt?.update(dt);
    this.debris?.update(dt);
    this.sensors?.update(dt);
    this.plan?.update(dt, this.time);
    this.mapOverlay?.update(dt);
    this.rig.update(dt, this.robot.pose, sim.layout.dock);
    this.labels.update(sim, this.robot.model.root, this.dock.model.root, dt);
    this.stage.render();
    this.labels.render(this.stage.scene, this.stage.camera);
    this.lastFrameMs = performance.now() - t0;
    this.governor(dt);
  }

  /** Reduce render resolution / sensor-viz rate when the frame rate stays low; restore when it recovers. */
  private governor(dt: number): void {
    const fps = 1 / Math.max(1e-3, dt);
    this.fpsWindow.push(fps);
    if (this.fpsWindow.length > 30) this.fpsWindow.shift();
    const avg = this.fpsWindow.reduce((a, b) => a + b, 0) / this.fpsWindow.length;
    if (avg < 28) {
      this.lowFpsTime += dt;
      this.highFpsTime = 0;
    } else if (avg > 55) {
      this.highFpsTime += dt;
      this.lowFpsTime = 0;
    } else {
      this.lowFpsTime = 0;
      this.highFpsTime = 0;
    }
    if (this.lowFpsTime > 3 && this.adaptiveLevel < 3) {
      this.adaptiveLevel++;
      this.lowFpsTime = 0;
      this.applyAdaptive();
    } else if (this.highFpsTime > 6 && this.adaptiveLevel > 0) {
      this.adaptiveLevel--;
      this.highFpsTime = 0;
      this.applyAdaptive();
    }
  }

  private applyAdaptive(): void {
    this.stage.adaptiveScale = [1, 0.8, 0.65, 0.5][this.adaptiveLevel];
    if (this.sensors) this.sensors.rate = [20, 12, 8, 5][this.adaptiveLevel];
    this.stage.resize();
  }

  perfStats(fps: number, simMs: number, steps: number): PerfStats {
    const info = this.stage.renderer.info;
    return {
      fps,
      frameMs: this.lastFrameMs,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      simStepMs: simMs,
      stepsPerFrame: steps,
      adaptiveLevel: this.adaptiveLevel,
    };
  }

  focus(x: number, y: number): void {
    this.rig.focus(x, y);
  }

  screenshot(): string {
    return this.stage.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.resizeObs.disconnect();
    this.editor.dispose();
    this.dirt?.dispose();
    this.debris?.dispose();
    this.sensors?.dispose();
    this.plan?.dispose();
    this.mapOverlay?.dispose();
    this.zones.dispose();
    this.labels.dispose();
    this.robot.dispose();
    this.dock.dispose();
    this.house.dispose();
    this.rig.dispose();
    this.stage.dispose();
  }
}

