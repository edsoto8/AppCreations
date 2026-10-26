/**
 * Wires the viewer, environment, fox, animation and UI together.
 *
 * URL parameters (handy for screenshots and debugging):
 *   anim=idle|walk|run|sit|look|wag  preset=<lighting id>  forest=1  fur=0  wire=1
 *   quality=low|medium|high  cam=three|side|front|back|head|top|low  t=<seconds>  ui=0
 *   shot=1  (no animation loop; drive frames from tests via window.__fox.step)
 */
import { SkeletonHelper, Vector3, type LineBasicMaterial } from 'three';
import { AnimationController } from './animation/AnimationController';
import { FoxRig } from './animation/FoxRig';
import type { StateId } from './animation/states';
import { Viewer } from './core/Viewer';
import { CONTACT_LAYER } from './environment/ContactShadows';
import { DEFAULT_PRESET, LIGHTING_PRESETS } from './environment/LightingPresets';
import { Studio } from './environment/Studio';
import { FoxModel } from './fox/FoxModel';
import { loadFoxMesh } from './fox/loadFox';
import { ControlPanel, type FurQuality, type PanelState } from './ui/ControlPanel';

const SHELLS: Record<FurQuality, number> = { low: 10, medium: 18, high: 28 };
/** Voxel size of the sculpt; finer on desktop. */
const MESH_CELL = { desktop: 0.0036, mobile: 0.0046 };

const CAMERAS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  side: { pos: [1.75, 0.32, -0.12], target: [0, 0.28, -0.12] },
  front: { pos: [0.12, 0.42, 1.45], target: [0, 0.3, 0] },
  back: { pos: [-0.7, 0.55, -1.5], target: [0, 0.27, -0.2] },
  head: { pos: [0.42, 0.5, 0.78], target: [0, 0.45, 0.31] },
  headfront: { pos: [0.0, 0.47, 0.82], target: [0, 0.45, 0.32] },
  top: { pos: [0.01, 2.0, -0.12], target: [0, 0.2, -0.12] },
  low: { pos: [0.9, 0.08, 0.9], target: [0, 0.25, -0.1] },
};

export class App {
  private readonly params = new URLSearchParams(location.search);
  private readonly viewer: Viewer;
  private readonly studio: Studio;
  private fox?: FoxModel;
  private rig?: FoxRig;
  private controller?: AnimationController;
  private panel?: ControlPanel;
  private skeletonHelper?: SkeletonHelper;
  private disposed = false;
  private statsTimer = 0;
  private studioForest = false;
  /** Adaptive quality: measures frame rate after start-up and steps fur quality down if needed. */
  private readonly perf = { auto: true, warmup: 1.5, time: 0, frames: 0, checks: 0 };
  private state: PanelState;

  constructor(
    stage: HTMLElement,
    private readonly host: HTMLElement,
  ) {
    const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
    const p = this.params;
    this.state = {
      animation: (p.get('anim') as StateId) ?? 'idle',
      playing: p.get('pause') !== '1',
      speed: 1,
      wagLayer: false,
      fur: p.get('fur') !== '0',
      wireframe: p.get('wire') === '1',
      skeleton: false,
      forest: p.get('forest') === '1',
      autoRotate: false,
      quality: (p.get('quality') as FurQuality) ?? (mobile ? 'low' : 'high'),
      preset: p.get('preset') ?? DEFAULT_PRESET,
    };
    this.viewer = new Viewer(stage);
    this.studio = new Studio(this.viewer.renderer, this.viewer.scene);
    this.viewer.onBeforeRender(() => this.studio.beforeRender());

    const cam = CAMERAS[p.get('cam') ?? ''];
    if (cam) {
      this.viewer.camera.position.set(...cam.pos);
      this.viewer.controls.target.set(...cam.target);
      this.viewer.controls.update();
    }
  }

  async init(): Promise<void> {
    // Low quality (phones, or when asked) also sculpts a lighter mesh.
    const light = this.state.quality === 'low';
    const fill = document.getElementById('loader-fill')!;
    const stageLabel = document.getElementById('loader-stage')!;
    const data = await loadFoxMesh(light ? MESH_CELL.mobile : MESH_CELL.desktop, (f, stage) => {
      fill.style.width = `${Math.round(f * 100)}%`;
      stageLabel.textContent = stage;
    });
    if (this.disposed) return;

    const fox = new FoxModel(data, SHELLS[this.state.quality]);
    fox.body.layers.enable(CONTACT_LAYER);
    this.viewer.scene.add(fox.object);
    this.fox = fox;
    this.rig = new FoxRig(fox);
    this.controller = new AnimationController(this.rig);
    this.controller.onChange((id) => this.setState({ animation: id }));

    this.applyAll();
    this.viewer.onFrame((dt) => this.frame(dt));
    this.viewer.onAfterRender(() => this.updateStats());

    if (this.params.get('ui') !== '0') {
      this.createPanel(data.buildMs);
      // Centre the fox in the space left of the desktop panel (panel width + margin, halved).
      this.viewer.setViewShift(154);
    }

    // Pre-roll to the requested time so screenshots can capture any moment.
    const t = parseFloat(this.params.get('t') ?? '0');
    if (t > 0) for (let i = 0; i < Math.ceil(t * 30); i++) this.controller.update(1 / 30);

    document.getElementById('loader')?.classList.add('done');
    const w = window as unknown as { __fox: unknown };
    w.__fox = {
      ready: true,
      step: (frames: number, dt = 1 / 30) => {
        for (let i = 0; i < frames; i++) this.viewer.tick(dt);
      },
      play: (id: StateId) => this.controller?.play(id),
      /** Renders one frame and returns it as a PNG data URL (same task, so no preserveDrawingBuffer needed). */
      capture: (dt = 1 / 30) => {
        this.viewer.tick(dt);
        return this.viewer.renderer.domElement.toDataURL('image/png');
      },
      scene: this.viewer.scene,
      fox,
      info: () => ({ vertices: fox.vertexCount, triangles: fox.triangleCount, buildMs: data.buildMs, fps: this.viewer.fps }),
    };
    if (this.params.get('shot') === '1') this.viewer.tick(1 / 30);
    else this.viewer.start();
  }

  private createPanel(buildMs: number): void {
    const c = this.controller!;
    this.panel = new ControlPanel(
      this.host,
      this.state,
      c.states.map((s) => ({ id: s.id, label: s.label })),
      LIGHTING_PRESETS,
      {
        onAnimation: (id) => c.play(id),
        onPlayPause: () => this.setState({ playing: !this.state.playing }),
        onSpeed: (v) => this.setState({ speed: v }),
        onToggle: (key, on) => this.setState({ [key]: on }),
        onQuality: (q) => {
          this.perf.auto = false;
          this.setState({ quality: q });
        },
        onPreset: (id) => this.setState({ preset: id }),
        onResetCamera: () => this.viewer.resetCamera(),
        onFullscreen: () => void this.viewer.toggleFullscreen().catch(() => undefined),
      },
    );
    console.info(`Fox sculpted in ${buildMs.toFixed(0)} ms`);
  }

  private setState(patch: Partial<PanelState>): void {
    this.state = { ...this.state, ...patch };
    this.applyAll();
    this.panel?.update(this.state);
  }

  /** Pushes the UI state into the scene. Cheap and idempotent. */
  private applyAll(): void {
    const s = this.state;
    const fox = this.fox, c = this.controller;
    if (!fox || !c) return;
    c.play(s.animation);
    c.playing = s.playing;
    c.speed = s.speed;
    c.setWagLayer(s.wagLayer);
    if (fox.shellCount !== SHELLS[s.quality]) fox.setShellCount(SHELLS[s.quality]);
    fox.setFurVisible(s.fur);
    fox.setWireframe(s.wireframe);
    this.setSkeleton(s.skeleton);
    if (this.studio.preset.id !== s.preset || this.studioForest !== s.forest) {
      this.studioForest = s.forest;
      this.studio.setForest(s.forest);
      this.studio.applyPreset(LIGHTING_PRESETS.find((p) => p.id === s.preset) ?? LIGHTING_PRESETS[0]);
    }
    this.viewer.controls.autoRotate = s.autoRotate;
    this.viewer.controls.autoRotateSpeed = 0.8;
  }

  private setSkeleton(on: boolean): void {
    if (on && !this.skeletonHelper && this.fox) {
      this.skeletonHelper = new SkeletonHelper(this.fox.body);
      (this.skeletonHelper.material as LineBasicMaterial).depthTest = false;
      this.skeletonHelper.renderOrder = 999;
      this.viewer.scene.add(this.skeletonHelper);
    } else if (!on && this.skeletonHelper) {
      this.skeletonHelper.removeFromParent();
      this.skeletonHelper.dispose();
      this.skeletonHelper = undefined;
    }
  }

  private readonly wind = new Vector3();

  private frame(dt: number): void {
    const c = this.controller!, fox = this.fox!;
    c.update(dt);
    const travel = c.groundSpeed * dt;
    this.studio.update(travel);
    // Running pushes the fur back.
    const sp = Math.min(c.groundSpeed, 2.5);
    this.wind.set(0, 0.05 * sp, -0.12 * sp);
    fox.furUniforms.uWind.value.lerp(this.wind, Math.min(1, dt * 5));

    this.statsTimer -= dt;
    this.adaptQuality(dt);
  }

  private adaptQuality(dt: number): void {
    const p = this.perf;
    if (!p.auto || p.checks >= 2 || this.params.has('quality') || this.params.get('shot') === '1') return;
    if (p.warmup > 0) {
      p.warmup -= dt;
      return;
    }
    p.time += dt;
    p.frames++;
    if (p.time < 2.5) return;
    const fps = p.frames / p.time;
    p.time = 0;
    p.frames = 0;
    p.checks++;
    p.warmup = 1;
    if (fps >= 40 || this.state.quality === 'low') return;
    const next: FurQuality = this.state.quality === 'high' ? 'medium' : 'low';
    console.info(`Fur quality lowered to ${next} (${fps.toFixed(0)} fps)`);
    this.setState({ quality: next });
  }

  private updateStats(): void {
    if (this.statsTimer > 0 || !this.panel) return;
    this.statsTimer = 0.5;
    const info = this.viewer.renderer.info.render;
    this.panel.setStats(`${Math.round(this.viewer.fps)} fps\n${(info.triangles / 1e6).toFixed(1)}M tris`);
  }

  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.setSkeleton(false);
    this.fox?.dispose();
    this.studio.dispose();
    this.viewer.dispose();
  }
}
