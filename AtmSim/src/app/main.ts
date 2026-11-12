import '../ui/styles.css';
import * as THREE from 'three';
import { EventBus } from '../core/events';
import { AnimClock } from '../animations/AnimClock';
import { WebAudioSfx } from '../audio/WebAudioSfx';
import { SceneManager } from '../scene/SceneManager';
import { ViewModes } from '../scene/ViewModes';
import { buildLobby } from '../scene/environment';
import { buildAtm } from '../models/buildAtm';
import { MechanismAnimator } from '../animations/MechanismAnimator';
import { FlowArrows } from '../animations/FlowArrows';
import { AtmSystem } from './AtmSystem';
import { UiCustomerPort } from './UiCustomerPort';
import { AtmScreenRenderer } from '../ui/AtmScreenRenderer';
import { Interaction } from '../interactions/Interaction';
import { Timeline } from '../ui/Timeline';
import { NetworkViz } from '../ui/NetworkViz';
import { Ui } from '../ui/Ui';
import { TroubleshootController } from '../ui/panels/troubleshootPanel';
import { componentInfo } from '../knowledge/components';
import { installTestHooks } from './testHooks';
import type { Ctx, NotePath } from '../ui/context';
import type { KeypadKey, CassetteId } from '../core/types';
import { CASSETTE_IDS } from '../core/types';

/**
 * Browser entry point: builds the 3D scene, the domain simulation and the UI, and connects them
 * through the ports (clock, mechanism driver, customer) and the event bus.
 */
function boot(): void {
  const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Building the ATM…';
  document.getElementById('viewport')!.appendChild(loading);

  const bus = new EventBus();
  const clock = new AnimClock(bus);
  const sfx = new WebAudioSfx();
  const stage = new SceneManager(canvas);

  const lobby = buildLobby();
  stage.scene.add(lobby.group);
  for (const l of lobby.lights) if (!l.parent) stage.scene.add(l);

  const model = buildAtm();
  stage.scene.add(model.root);
  if (!model.props.card.parent) stage.scene.add(model.props.card);

  const mech = new MechanismAnimator({ model, scene: stage.scene, clock, sfx });
  const flow = new FlowArrows(model, stage.scene);
  const port = new UiCustomerPort(clock);
  const sys = new AtmSystem({ bus, clock, mech, customer: port });

  const screen = new AtmScreenRenderer(() => clock.now());
  screen.attach(model.screenMesh);
  screen.show(sys.app.screen);
  bus.on('screen.changed', ({ screen: s }) => screen.show(s));

  const views = new ViewModes(stage, model, sfx);
  const net = new NetworkViz(bus, clock, () => sys.config.hostHopLatencyMs);

  const routes = ['dispense', 'reject', 'retract', 'deposit'] as const;
  const arrows: NotePath = {
    visible: false,
    setVisible(on: boolean) {
      this.visible = on;
      for (const r of routes) flow.show(r, on);
    },
    toggleAll() {
      this.setVisible(!this.visible);
    },
  };

  const ui = new Ui();
  const troubleshoot = new TroubleshootController();
  const ctx: Ctx = {
    sys, bus, clock, stage, views, model, mech, arrows, sfx, port, screen, net, ui, troubleshoot,
    resetAll() {
      clock.cancelAll();
      clock.setPaused(false);
      port.reset();
      mech.reset();
      ui.tours?.stop(false);
      sys.reset();
      views.reset();
      arrows.setVisible(false);
      troubleshoot.selected = null;
      ui.select(null);
      screen.show(sys.app.screen);
      syncFills();
      ui.setMode('customer');
      ui.toast('Simulator reset to the initial training state', 'ok');
    },
  };
  troubleshoot.attach(ctx);
  ui.init(ctx);

  // Customer lead-through lights and beeps requested by the ATM application.
  bus.on('atm.cue', ({ cue, on }) => {
    const led = { 'card-light': model.leds.card, 'cash-light': model.leds.cash, 'receipt-light': model.leds.receipt, 'deposit-light': model.leds.deposit } as const;
    if (cue === 'beep') sfx.play('beep');
    else if (cue === 'error-beep') sfx.play('error');
    else led[cue]?.set(on === false ? 'off' : 'blink', 0x35e0c8);
  });

  // Cassette / bin fill levels follow the inventory.
  const syncFills = () => {
    const snap = sys.inventory.snapshot();
    for (const c of snap.cassettes) model.setFill(c.id as CassetteId, c.capacity ? c.physical / c.capacity : 0);
    const count = (d: Partial<Record<number, number>>) => Object.values(d).reduce((a: number, b) => a + (b ?? 0), 0);
    model.setFill('reject', Math.min(1, count(snap.reject) / 150));
    model.setFill('retract', Math.min(1, count(snap.retract) / 150));
    model.setFill('deposit', Math.min(1, count(snap.deposit) / 300));
    const status = sys.devices.all().some((d) => d.status === 'FAULT' || d.status === 'OFFLINE') ? 0xff3344 : snap.lowCash ? 0xffb020 : 0x22dd77;
    model.leds.status.set(sys.operator.active ? 'blink' : 'on', sys.operator.active ? 0xffb020 : status);
  };
  bus.on('inventory.changed', syncFills);
  bus.on('device.changed', syncFills);
  bus.on('reset', syncFills);
  syncFills();
  void CASSETTE_IDS;

  // 3D interaction.
  const interaction = new Interaction(stage, model, {
    onKey: (key) => pressKey(key, false),
    onScreenUv: (uv) => {
      sfx.unlock();
      const id = screen.hitTest(uv);
      if (id) {
        sfx.play('click');
        sys.app.input({ kind: 'touch', target: id });
      }
    },
    onSelect: (id) => ui.select(id),
    onCard: (method) => ui.insertCard(method),
    onProp: (prop) => {
      sfx.unlock();
      if (prop === 'cash' && port.collectCash()) ui.toast('Cash collected', 'ok');
      else if (prop === 'card-ejected' && port.takeCard()) ui.toast('Card taken');
      else if (prop === 'receipt') mech.takeReceipt();
    },
    describe: (id) => {
      const info = componentInfo(id);
      return `<b>${info.name}</b><br>${info.purpose}<br><span style="color:#8b9ab3">Click for details</span>`;
    },
    cardUsable: () => ui.cardUsable(),
  });
  interaction.getTransient = () => mech.getInteractive();

  function pressKey(key: KeypadKey, fromKeyboard: boolean): void {
    sfx.unlock();
    sfx.play('key');
    const mesh = model.keys.get(key);
    if (mesh && fromKeyboard) interaction.pressKey(mesh);
    sys.app.input({ kind: 'key', key });
  }
  (window as unknown as { atmPressKey: typeof pressKey }).atmPressKey = pressKey;

  // Physical keyboard mirrors the 3D keypad.
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    let key: KeypadKey | undefined;
    if (/^[0-9]$/.test(e.key)) key = e.key as KeypadKey;
    else if (e.key === 'Enter') key = 'ENTER';
    else if (e.key === 'Backspace') key = 'CLEAR';
    else if (e.key === 'Escape') key = 'CANCEL';
    else if (e.key === ' ' && document.activeElement === canvas) {
      clock.setPaused(!clock.paused);
      e.preventDefault();
      return;
    }
    if (key) {
      pressKey(key, true);
      e.preventDefault();
    }
  });
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  new Timeline(document.getElementById('timeline')!, bus, clock);

  // Frame loop: sim clock (speed/pause/step) drives the mechanism; visuals update in real time.
  stage.onFrame((dt) => {
    clock.update(dt);
    const sec = dt / 1000;
    model.update(sec);
    mech.update(sec);
    flow.update(sec);
    interaction.update();
    screen.tick();
  });
  stage.start();
  const f = model.anchors.focus.front;
  stage.camera.position.copy(f.position).add(new THREE.Vector3(0.9, 0.5, 1.4));
  stage.controls.target.copy(f.target);
  void stage.focus(f.position, f.target, 2.0);
  loading.remove();

  // Expose for debugging and browser tests.
  (window as unknown as { atm: Ctx }).atm = ctx;
  installTestHooks(ctx);
}

boot();
