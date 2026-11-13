import * as THREE from 'three';
import '../styles.css';
import { AnimatedValue, Ease } from '../animation/Tween';
import { AudioManager } from '../audio/AudioManager';
import { LCDRenderer } from '../display/LCDRenderer';
import { ScreenTexture } from '../display/ScreenTexture';
import type { ButtonId } from '../games/GameInterface';
import { CARTRIDGES, getCartridge } from '../games/registry';
import { ConsoleSystem } from '../hardware/ConsoleSystem';
import { InputManager } from '../interaction/InputManager';
import { InteractionController, type Pick, type PickId } from '../interaction/InteractionController';
import { CartridgeRig } from '../models/CartridgeRig';
import { GameBoyModel } from '../models/GameBoyModel';
import { HALF_H } from '../models/Layout';
import { Materials } from '../models/Materials';
import { CameraController } from '../scene/CameraController';
import { LightingManager, type LightingPresetId } from '../scene/LightingManager';
import { SceneManager } from '../scene/SceneManager';
import { CartridgeLibrary } from '../ui/CartridgeLibrary';
import { h } from '../ui/dom';
import { HelpDialog } from '../ui/HelpDialog';
import { InfoPanel, type InfoAction } from '../ui/InfoPanel';
import { PART_INFO } from '../ui/PartInfo';
import { Popover } from '../ui/Popover';
import { ScreenOverlay } from '../ui/ScreenOverlay';
import { StudioPanel, type StudioToggles } from '../ui/StudioPanel';
import { Toast } from '../ui/Toast';
import { Toolbar } from '../ui/Toolbar';
import { installDebugApi } from './DebugApi';
import { Settings } from './Settings';

const FLOOR_Y = -HALF_H - 24;
/** Parts on the back of the console: the camera focuses on them from behind. */
const BACK_PARTS = new Set<PickId>(['back-shell', 'battery-cover', 'batteries', 'cartridge-bay', 'screws', 'cartridge']);

function main(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  const stage = h('div', { class: 'stage' });
  const ui = h('div', { class: 'ui' });
  app.append(stage, ui);

  // ---- Core systems -------------------------------------------------------------------------
  const settings = new Settings();
  const s = settings.values;
  const audio = new AudioManager();
  audio.setVolume(s.volume);
  audio.setMuted(s.muted);
  const machine = new ConsoleSystem({ speaker: audio, highScores: settings.highScores, volume: s.volume, contrast: s.contrast });
  const lcd = new LCDRenderer();
  lcd.setOption('pixelGrid', s.pixelGrid);
  lcd.setOption('ghosting', s.ghosting);

  // ---- 3D -------------------------------------------------------------------------------------
  const sceneMgr = new SceneManager(stage);
  const { scene, camera, renderer } = sceneMgr;
  const aniso = sceneMgr.maxAnisotropy;
  const mats = new Materials(aniso);
  const model = new GameBoyModel(mats, aniso);
  scene.add(model.root);
  const lighting = new LightingManager(renderer, scene, FLOOR_Y, stage);
  lighting.apply(s.lighting);
  const rig = new CartridgeRig(CARTRIDGES, mats, aniso, model, FLOOR_Y);
  scene.add(rig.group);
  const screenTex = new ScreenTexture(lcd, aniso);
  screenTex.attach(model.screen.material as THREE.MeshBasicMaterial);
  model.setVolume(s.volume);
  model.setContrast(s.contrast);
  mats.glass.visible = s.reflection;

  // ---- UI -------------------------------------------------------------------------------------
  const toast = new Toast(ui);
  const info = new InfoPanel(ui);
  const library = new CartridgeLibrary(ui, CARTRIDGES, (id) => toggleCartridge(id));
  const help = new HelpDialog(ui);
  const studioToggles: StudioToggles = {
    pixelGrid: s.pixelGrid,
    ghosting: s.ghosting,
    reflection: s.reflection,
    idleMotion: s.idleMotion,
    slowMotion: s.slowMotion,
    showFps: s.showFps,
  };
  const studio = new StudioPanel(ui, studioToggles, {
    lighting: (id) => setLighting(id),
    toggle: (key, value) => setToggle(key, value),
    volume: (v) => machine.volume.set(v),
    contrast: (v) => machine.contrast.set(v),
  });
  studio.setPreset(s.lighting);
  studio.setDials(s.volume, s.contrast);
  const overlay = new ScreenOverlay(ui, lcd.lcdCanvas, (b, down) => press(b, down, 'ui'), () => setOverlay(false));
  overlay.setReflection(s.reflection);
  const fpsEl = h('div', { class: 'fps', hidden: !s.showFps });
  const brand = h(
    'header',
    { class: 'brand' },
    h('h1', {}, 'Pocket Pixel'),
    h('p', {}, 'An interactive 1989-style handheld · three original games'),
  );
  const hint = h('div', { class: 'hint' });
  ui.append(brand, hint, fpsEl);

  const toolbar = new Toolbar(ui, [
    [{ id: 'power', icon: 'power', label: 'Power', key: 'P', onClick: () => togglePower() }],
    [
      { id: 'reset', icon: 'reset', label: 'Reset view', key: 'C', onClick: () => resetView() },
      { id: 'front', icon: 'front', label: 'Front', onClick: () => flyView('front') },
      { id: 'back', icon: 'back', label: 'Rear', onClick: () => flyView('back') },
    ],
    [{ id: 'library', icon: 'cartridge', label: 'Cartridges', key: 'L', onClick: () => togglePopover(library.popover, 'library') }],
    [
      { id: 'focus', icon: 'screen', label: 'Screen focus', key: 'F', onClick: () => setScreenFocus(!screenFocus) },
      { id: 'display', icon: 'display', label: '2D display', key: 'D', onClick: () => setOverlay(!overlay.visible) },
    ],
    [
      { id: 'explode', icon: 'explode', label: 'Exploded', key: 'E', onClick: () => setExploded(!exploded) },
      { id: 'xray', icon: 'xray', label: 'X-ray', key: 'T', onClick: () => setTransparent(!transparent) },
    ],
    [{ id: 'studio', icon: 'light', label: 'Studio', onClick: () => togglePopover(studio.popover, 'studio') }],
    [
      { id: 'mute', icon: s.muted ? 'mute' : 'sound', label: 'Sound', key: 'M', onClick: () => setMuted(!audio.isMuted) },
      { id: 'help', icon: 'help', label: 'Help', key: 'H', onClick: () => togglePopover(help.popover, 'help') },
    ],
  ]);
  for (const [id, pop] of [
    ['library', library.popover],
    ['studio', studio.popover],
    ['help', help.popover],
  ] as const) {
    pop.onClose(() => toolbar.setActive(id, false));
  }
  toolbar.setActive('mute', s.muted);

  // ---- Interaction ----------------------------------------------------------------------------
  // Must be created before CameraController so its listeners run before OrbitControls'.
  const interaction = new InteractionController(renderer.domElement, camera, [model.root, rig.group], {
    pressButton: (b, down) => press(b, down, 'pointer'),
    togglePower: () => togglePower(),
    turnDial: (which, detents) => {
      (which === 'volume' ? machine.volume : machine.contrast).step(detents);
      audio.playMechanical('wheel');
    },
    toggleBatteryCover: () => machine.setBatteryCover(!machine.batteryCoverOpen),
    clickCartridge: (id) => toggleCartridge(id),
    select: (pick) => selectPart(pick),
    focus: (pick) => focusPart(pick),
    hover: (pick, x, y) => toast.tooltip(pick ? partName(pick) : null, x, y),
  });
  const cameraCtl = new CameraController(camera, renderer.domElement);
  interaction.setOrbitEnabled = (enabled) => {
    cameraCtl.controls.enabled = enabled;
  };
  const input = new InputManager(machine.buttons, (code) => shortcut(code));

  // ---- State ----------------------------------------------------------------------------------
  let exploded = false;
  let transparent = false;
  let screenFocus = false;
  const powerLevel = new AnimatedValue(0);
  const idleAmount = new AnimatedValue(s.idleMotion ? 1 : 0);
  let lastCartId: string | null = null;
  let lastBacking = -1;

  // Audio may only start inside a user gesture.
  const unlock = (): void => {
    audio.unlock();
    if (audio.unlocked) {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  // ---- Wiring: hardware → model / audio / UI ----------------------------------------------------
  machine.buttons.onChange((b, down) => {
    model.setButton(b, down);
    audio.playMechanical(down ? 'press' : 'release');
  });
  machine.power.onChange((on) => {
    model.setPower(on);
    powerLevel.animateTo(on ? 1 : 0, on ? 0.35 : 0.7, on ? Ease.outCubic : Ease.inOutSine);
    audio.playMechanical('switch');
    toolbar.setActive('power', on);
    refreshLibrary();
    updateHint();
    if (on && !machine.cartridge) toast.show('No cartridge: the console will boot and wait.', 'warn');
    if (info.current === 'power-switch') selectPart({ part: 'power-switch', object: model.parts.get('power-switch')!, point: new THREE.Vector3() });
  });
  machine.volume.onChange((v) => {
    audio.setVolume(v);
    model.setVolume(v);
    settings.set('volume', v);
    studio.setDials(v, machine.contrast.value);
  });
  machine.contrast.onChange((v) => {
    model.setContrast(v);
    settings.set('contrast', v);
    studio.setDials(machine.volume.value, v);
  });
  machine.slot.onChange((cart) => {
    if (lastCartId && lastCartId !== cart?.id) rig.eject(lastCartId);
    if (cart) rig.insert(cart.id);
    lastCartId = cart?.id ?? null;
    settings.set('lastCartridge', lastCartId);
    refreshLibrary();
    updateHint();
  });
  machine.events.on('rejected', (msg) => {
    toast.show(msg, 'warn');
    audio.playMechanical('deny');
    if (lastCartId) rig.nudge(lastCartId);
  });
  machine.events.on('batteryCover', (open) => {
    model.setBatteryCover(open);
    audio.playMechanical('cover');
    if (info.current === 'battery-cover' || info.current === 'batteries') {
      selectPart({ part: 'battery-cover', object: model.parts.get('battery-cover')!, point: new THREE.Vector3() });
    }
  });
  rig.onSeated = () => {
    audio.playMechanical('cartIn');
    refreshLibrary();
  };
  rig.onUnseated = () => audio.playMechanical('cartOut');

  // Start with the last cartridge already in the slot (power off).
  const initial = s.lastCartridge ? getCartridge(s.lastCartridge) : undefined;
  if (initial) {
    machine.insertCartridge(initial);
    rig.insert(initial.id, true);
  }
  refreshLibrary();
  updateHint();

  // ---- Actions --------------------------------------------------------------------------------
  function press(b: ButtonId, down: boolean, source: 'pointer' | 'ui'): void {
    if (down) machine.buttons.press(b, source);
    else machine.buttons.release(b, source);
  }

  function tap(b: ButtonId): void {
    machine.buttons.press(b, 'ui');
    window.setTimeout(() => machine.buttons.release(b, 'ui'), 120);
  }

  function togglePower(): void {
    if (!machine.isOn && rig.busy) {
      toast.show('Let the cartridge finish moving first.', 'warn');
      return;
    }
    machine.togglePower();
  }

  function toggleCartridge(id: string): void {
    const cart = getCartridge(id);
    if (!cart) return;
    if (machine.isOn) {
      machine.ejectCartridge(); // refused while powered: emits a "rejected" message
      return;
    }
    if (machine.cartridge?.id === id) {
      machine.ejectCartridge();
      return;
    }
    if (machine.cartridge) machine.ejectCartridge();
    machine.insertCartridge(cart);
  }

  function setLighting(id: LightingPresetId): void {
    lighting.apply(id);
    studio.setPreset(id);
    settings.set('lighting', id);
  }

  function setToggle(key: keyof StudioToggles, value: boolean): void {
    studioToggles[key] = value;
    studio.setToggle(key, value);
    settings.set(key, value);
    switch (key) {
      case 'pixelGrid':
        lcd.setOption('pixelGrid', value);
        break;
      case 'ghosting':
        lcd.setOption('ghosting', value);
        break;
      case 'reflection':
        mats.glass.visible = value;
        overlay.setReflection(value);
        break;
      case 'idleMotion':
        idleAmount.animateTo(value ? 1 : 0, 1.2, Ease.inOutSine);
        break;
      case 'showFps':
        fpsEl.hidden = !value;
        break;
      case 'slowMotion':
        break;
    }
  }

  function setMuted(muted: boolean): void {
    audio.setMuted(muted);
    settings.set('muted', muted);
    toolbar.setIcon('mute', muted ? 'mute' : 'sound');
    toolbar.setActive('mute', muted);
    toast.show(muted ? 'Sound muted' : 'Sound on');
  }

  function togglePopover(pop: Popover, id: string): void {
    const open = pop.toggle();
    toolbar.setActive(id, open);
    if (open) refreshLibrary();
  }

  function resetView(): void {
    if (screenFocus) setScreenFocus(false, false);
    cameraCtl.view(exploded ? 'exploded' : 'home');
  }

  function flyView(name: 'front' | 'back'): void {
    if (screenFocus) setScreenFocus(false, false);
    cameraCtl.view(name);
  }

  function setScreenFocus(on: boolean, moveCamera = true): void {
    screenFocus = on;
    toolbar.setActive('focus', on);
    if (on) {
      if (exploded) setExploded(false);
      model.root.updateMatrixWorld(true);
      const center = model.screenWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(model.root.getWorldQuaternion(new THREE.Quaternion()));
      cameraCtl.focusScreen(center, normal);
      if (!machine.isOn) toast.show('Switch the power on to play: P or click the switch on top.');
    } else if (moveCamera) {
      cameraCtl.view('home');
    }
  }

  function setOverlay(on: boolean): void {
    overlay.setVisible(on);
    toolbar.setActive('display', on);
  }

  function setExploded(on: boolean): void {
    exploded = on;
    toolbar.setActive('explode', on);
    model.setExploded(on, studioToggles.slowMotion);
    if (on && screenFocus) setScreenFocus(false, false);
    cameraCtl.view(on ? 'exploded' : 'home', on ? 1.4 : 1.2);
    if (on && machine.batteryCoverOpen) machine.setBatteryCover(false);
  }

  function setTransparent(on: boolean): void {
    transparent = on;
    toolbar.setActive('xray', on);
    model.setTransparent(on);
  }

  function partName(pick: Pick): string {
    if (pick.part === 'cartridge' && pick.cartridgeId) return getCartridge(pick.cartridgeId)?.title ?? 'Cartridge';
    return PART_INFO[pick.part].name;
  }

  function focusPart(pick: Pick): void {
    if (pick.part === 'screen' || pick.part === 'lens' || pick.part === 'led') {
      setScreenFocus(true);
      return;
    }
    const q = model.root.getWorldQuaternion(new THREE.Quaternion());
    const normal = BACK_PARTS.has(pick.part)
      ? new THREE.Vector3(0.25, 0.25, -1).applyQuaternion(q)
      : pick.part === 'power-switch'
        ? new THREE.Vector3(-0.3, 1, 0.5).applyQuaternion(q)
        : pick.part === 'volume-wheel'
          ? new THREE.Vector3(1, 0.1, 0.4).applyQuaternion(q)
          : pick.part === 'contrast-wheel' || pick.part === 'link-port' || pick.part === 'dc-jack'
            ? new THREE.Vector3(-1, 0.1, 0.4).applyQuaternion(q)
            : pick.part === 'phones-jack'
              ? new THREE.Vector3(0.2, -0.6, 1).applyQuaternion(q)
              : undefined;
    const target = pick.part === 'cartridge' || pick.part === 'front-shell' || pick.part === 'back-shell' ? pick.object : pick.object;
    cameraCtl.focusObject(target, normal, pick.part === 'front-shell' || pick.part === 'back-shell' ? 1.6 : 3.2);
  }

  function selectPart(pick: Pick | null): void {
    if (!pick) {
      return;
    }
    const focus: InfoAction = { label: 'Focus camera', onClick: () => focusPart(pick) };
    const actions: InfoAction[] = [];
    let infoKey: string = pick.part;
    let data = PART_INFO[pick.part];
    let kicker = 'Component';
    const gameButton: Partial<Record<PickId, ButtonId>> = {
      dpad: 'up',
      'button-a': 'a',
      'button-b': 'b',
      'button-start': 'start',
      'button-select': 'select',
    };
    switch (pick.part) {
      case 'power-switch':
        actions.push({ label: machine.isOn ? 'Switch off' : 'Switch on', primary: true, onClick: () => togglePower() });
        break;
      case 'volume-wheel':
      case 'contrast-wheel': {
        const dial = pick.part === 'volume-wheel' ? machine.volume : machine.contrast;
        actions.push(
          { label: 'Turn down', onClick: () => dial.step(-2) },
          { label: 'Turn up', primary: true, onClick: () => dial.step(2) },
        );
        break;
      }
      case 'battery-cover':
      case 'batteries':
        actions.push({ label: machine.batteryCoverOpen ? 'Close the door' : 'Open the door', primary: true, onClick: () => machine.setBatteryCover(!machine.batteryCoverOpen) });
        break;
      case 'screen':
      case 'lens':
      case 'led':
        actions.push(
          { label: 'Screen focus', primary: true, onClick: () => setScreenFocus(true) },
          { label: 'Enlarged 2D display', onClick: () => setOverlay(true) },
        );
        break;
      case 'cartridge':
      case 'cartridge-bay': {
        const cart = pick.cartridgeId ? getCartridge(pick.cartridgeId) : machine.cartridge;
        if (cart) {
          infoKey = `cartridge:${cart.id}`;
          kicker = 'Cartridge';
          data = {
            name: cart.title,
            description: cart.description,
            function: cart.controls.map(([k, v]) => `${k}: ${v}`).join(' · '),
          };
          const inserted = machine.cartridge?.id === cart.id;
          actions.push({ label: inserted ? 'Remove' : 'Insert', primary: true, disabled: machine.isOn, onClick: () => toggleCartridge(cart.id) });
        }
        actions.push({ label: 'Cartridge library', onClick: () => togglePopover(library.popover, 'library') });
        break;
      }
      case 'lcd-board':
      case 'cpu-board':
      case 'membrane':
      case 'speaker':
      case 'screws':
      case 'front-shell':
      case 'back-shell':
        actions.push({ label: exploded ? 'Assemble' : 'Exploded view', onClick: () => setExploded(!exploded) });
        actions.push({ label: transparent ? 'Solid shell' : 'X-ray shell', onClick: () => setTransparent(!transparent) });
        break;
      default: {
        const b = gameButton[pick.part];
        if (b) actions.push({ label: 'Press', primary: true, onClick: () => tap(b) });
      }
    }
    actions.push(focus);
    info.show(infoKey, data, actions, undefined, kicker);
  }

  function refreshLibrary(): void {
    library.render({
      insertedId: machine.cartridge?.id ?? null,
      powerOn: machine.isOn,
      busy: rig.busy,
      highScore: (id) => settings.highScores.get(id),
    });
  }

  function updateHint(): void {
    hint.textContent = !machine.cartridge
      ? 'Open Cartridges (L) or click a cartridge on the table to insert it.'
      : machine.isOn
        ? `${machine.cartridge.title} · Arrows, Z = A, X = B, Enter = START, Shift = SELECT`
        : `${machine.cartridge.title} inserted · Slide the power switch on top, or press P`;
  }

  function shortcut(code: string): boolean {
    switch (code) {
      case 'KeyP':
        togglePower();
        return true;
      case 'KeyF':
        setScreenFocus(!screenFocus);
        return true;
      case 'KeyD':
        setOverlay(!overlay.visible);
        return true;
      case 'KeyC':
        resetView();
        return true;
      case 'KeyE':
        setExploded(!exploded);
        return true;
      case 'KeyT':
        setTransparent(!transparent);
        return true;
      case 'KeyL':
        togglePopover(library.popover, 'library');
        return true;
      case 'KeyM':
        setMuted(!audio.isMuted);
        return true;
      case 'KeyH':
      case 'Slash':
        togglePopover(help.popover, 'help');
        return true;
      case 'Escape':
        if (overlay.visible) setOverlay(false);
        else if (document.querySelector('.popover:not([hidden])')) Popover.closeAll();
        else if (info.current) info.hide();
        else if (screenFocus) setScreenFocus(false);
        return true;
      default:
        return false;
    }
  }

  // ---- Frame loop -----------------------------------------------------------------------------
  let fpsTimer = 0;
  let rigWasBusy = rig.busy;
  sceneMgr.onFrame((dt, elapsed) => {
    machine.update(dt);
    powerLevel.update(dt);
    lcd.render(machine.framebuffer, dt, powerLevel.value, machine.contrast.value);
    model.setScreenGlow(lighting.theme === 'dark' ? 0.7 : 0.86);
    const bg = lcd.backgroundRgb();
    const packed = (bg[0] << 16) | (bg[1] << 8) | bg[2];
    if (packed !== lastBacking) {
      lastBacking = packed;
      model.setLcdBackingColor(bg[0], bg[1], bg[2]);
    }
    screenTex.sync();
    overlay.draw(lcd.frameVersion);

    // Optional handheld presentation: slow, deterministic sway.
    idleAmount.update(dt);
    const a = idleAmount.value;
    model.root.rotation.set(Math.sin(elapsed * 0.37) * 0.035 * a, Math.sin(elapsed * 0.5) * 0.08 * a, Math.sin(elapsed * 0.29) * 0.015 * a);
    model.root.position.y = Math.sin(elapsed * 0.8) * 2.2 * a;

    model.update(dt);
    rig.update(dt);
    if (rig.busy !== rigWasBusy) {
      rigWasBusy = rig.busy;
      refreshLibrary();
    }
    cameraCtl.update(dt);

    fpsTimer += dt;
    if (studioToggles.showFps && fpsTimer > 0.5) {
      fpsTimer = 0;
      fpsEl.textContent = `${sceneMgr.fps.toFixed(0)} fps · ${renderer.info.render.calls} draws`;
    }
  });
  sceneMgr.start();

  installDebugApi({
    machine,
    lcd,
    camera: cameraCtl,
    model,
    rig,
    sceneMgr,
    actions: { togglePower, toggleCartridge, setExploded, setTransparent, setScreenFocus, setOverlay, setLighting, tap },
    state: () => ({ exploded, transparent, screenFocus, overlay: overlay.visible }),
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      input.dispose();
      interaction.dispose();
      cameraCtl.dispose();
      rig.dispose();
      model.dispose();
      mats.dispose();
      screenTex.dispose();
      lighting.dispose();
      sceneMgr.dispose();
      audio.dispose();
      app.replaceChildren();
    });
  }
}

main();
