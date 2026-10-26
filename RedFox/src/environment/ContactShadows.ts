/**
 * Soft contact shadows: the fox's depth is rendered from below into a small target, blurred and
 * laid on the ground. Complements the key light's shadow map with grounded ambient occlusion.
 */
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

export const CONTACT_LAYER = 1;

export class ContactShadows {
  readonly group = new Group();
  private readonly rt: WebGLRenderTarget;
  private readonly rtBlur: WebGLRenderTarget;
  private readonly camera: OrthographicCamera;
  private readonly plane: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly blurPlane: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly depthMaterial: MeshDepthMaterial;
  private readonly hBlur: ShaderMaterial;
  private readonly vBlur: ShaderMaterial;
  private readonly geometry: PlaneGeometry;

  constructor(
    size = 1.8,
    height = 0.45,
    resolution = 512,
    private readonly blur = 2.6,
  ) {
    this.rt = new WebGLRenderTarget(resolution, resolution);
    this.rt.texture.generateMipmaps = false;
    this.rtBlur = new WebGLRenderTarget(resolution, resolution);
    this.rtBlur.texture.generateMipmaps = false;

    this.geometry = new PlaneGeometry(size, size).rotateX(Math.PI / 2);
    this.plane = new Mesh(
      this.geometry,
      new MeshBasicMaterial({ map: this.rt.texture, opacity: 0.85, transparent: true, depthWrite: false }),
    );
    this.plane.renderOrder = 1;
    this.plane.position.y = 0.0015;
    // The render target is seen from below, so flip it to read correctly from above.
    this.plane.scale.y = -1;
    this.group.add(this.plane);


    this.camera = new OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
    this.camera.rotation.x = Math.PI / 2;
    this.camera.layers.set(CONTACT_LAYER);
    this.group.add(this.camera);

    this.depthMaterial = new MeshDepthMaterial();
    this.depthMaterial.userData.darkness = { value: 1.2 };
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = this.depthMaterial.userData.darkness;
      shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace(
        'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );',
      )}`;
    };
    this.depthMaterial.depthTest = false;
    this.depthMaterial.depthWrite = false;

    this.hBlur = new ShaderMaterial(HorizontalBlurShader);
    this.hBlur.depthTest = false;
    this.vBlur = new ShaderMaterial(VerticalBlurShader);
    this.vBlur.depthTest = false;
    this.blurPlane = new Mesh(this.geometry, this.hBlur);
    this.blurPlane.visible = false;
    this.group.add(this.blurPlane);
  }

  set opacity(v: number) {
    this.plane.material.opacity = v;
  }

  render(renderer: WebGLRenderer, scene: Scene): void {
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);

    this.plane.visible = false;
    scene.background = null;
    scene.overrideMaterial = this.depthMaterial;
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, this.camera);
    scene.overrideMaterial = prevOverride;

    this.blurPass(renderer, this.blur);
    this.blurPass(renderer, this.blur * 0.4);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(this.clearColor, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    scene.background = prevBackground;
    this.plane.visible = true;
  }

  private readonly clearColor = new Color();

  private blurPass(renderer: WebGLRenderer, amount: number): void {
    const res = this.rt.width;
    this.blurPlane.visible = true;
    // Blur camera renders the blur plane only; temporarily enable its default layer.
    this.camera.layers.enable(0);
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.rt.texture;
    this.hBlur.uniforms.h.value = amount / res;
    renderer.setRenderTarget(this.rtBlur);
    renderer.render(this.blurPlane, this.camera);

    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture;
    this.vBlur.uniforms.v.value = amount / res;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.blurPlane, this.camera);
    this.camera.layers.set(CONTACT_LAYER);
    this.blurPlane.visible = false;
  }

  dispose(): void {
    this.rt.dispose();
    this.rtBlur.dispose();
    this.geometry.dispose();
    this.plane.material.dispose();
    this.depthMaterial.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
    this.group.removeFromParent();
  }
}
