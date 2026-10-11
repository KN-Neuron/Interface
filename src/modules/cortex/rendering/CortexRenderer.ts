import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import type { CortexElectrode, CortexQuality } from "../models/cortex";

export interface CortexRendererOptions {
  electrodes: readonly CortexElectrode[];
  onLayoutChange?: (electrodes: readonly CortexElectrode[]) => void;
  onSelectionChange?: (index: number) => void;
}

const MAX_ELECTRODES = 64;
const MODEL_PATHS: Record<CortexQuality, string> = {
  low: "/modules/cortex/brain_low.glb",
  medium: "/modules/cortex/brain_medium.glb",
  high: "/modules/cortex/brain_high.glb",
};

const vertexShader = `
attribute vec4 eIndex;
attribute vec4 eDist2;
uniform float uActivity[64];
uniform float uRadius;
uniform float uDeform;
varying float vField;

void main() {
  float sig2 = 2.0 * uRadius * uRadius;
  float field = 0.0;

  for (int k = 0; k < 4; k++) {
    int index = int(eIndex[k] + 0.5);
    float weight = exp(-eDist2[k] / sig2);
    field = max(field, uActivity[index] * weight);
  }

  vField = field;

  float q = clamp((field - 0.18) / 0.82, 0.0, 1.0);
  vec3 displaced = position + normal * (uDeform * pow(q, 1.7));

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const fragmentShader = `
precision highp float;
varying float vField;

void main() {
  float q = clamp((vField - 0.18) / 0.82, 0.0, 1.0);

  // Instrument palette: resting tissue, phosphor trace, signal orange.
  vec3 base = vec3(0.16, 0.24, 0.23);
  vec3 trace = vec3(0.56, 0.85, 0.75);
  vec3 hot = vec3(0.97, 0.40, 0.03);

  vec3 color = q < 0.45
    ? mix(base, trace, q / 0.45)
    : mix(trace, hot, (q - 0.45) / 0.55);

  gl_FragColor = vec4(color, 0.94);
}
`;

function cloneElectrodes(electrodes: readonly CortexElectrode[]): CortexElectrode[] {
  return electrodes.slice(0, MAX_ELECTRODES).map((electrode) => ({
    label: electrode.label,
    position: [...electrode.position] as [number, number, number],
  }));
}

/**
 * Three.js runtime extracted from the original BrainDance project and adapted
 * to a React/Tauri module container.
 *
 * The important old behavior is preserved:
 * - three render layers,
 * - nearest-electrode vertex influence,
 * - activity shader,
 * - mesh deformation,
 * - horizontal + vertical FOV camera fitting,
 * - resize recovery,
 * - OrbitControls,
 * - TransformControls electrode editing.
 */
export class CortexRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly brainRoot = new THREE.Group();
  private readonly transformControls: TransformControls;
  private readonly transformHelper: THREE.Object3D;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private readonly activity = new Float32Array(MAX_ELECTRODES);
  private readonly targetActivity = new Float32Array(MAX_ELECTRODES);

  private readonly uniforms = {
    uActivity: { value: this.activity },
    uRadius: { value: 0.38 },
    uDeform: { value: 0.2 },
  };

  private brainModel: THREE.Group | null = null;
  private brainBase: THREE.Object3D | null = null;
  private brainWire: THREE.Object3D | null = null;

  /**
   * The wireframe overlay draws every edge of the brain mesh (~750k lines on
   * the medium model). ANGLE/Direct3D emulates WebGL lines slowly, which made
   * rotation stutter in WebView2, so the overlay is not drawn.
   */
  private wireVisible = false;
  private brainEEG: THREE.Object3D | null = null;

  private brainCenter = new THREE.Vector3();
  private brainSize = new THREE.Vector3(1, 1, 1);
  private hasBrainBounds = false;

  private electrodes: CortexElectrode[];
  private markers: THREE.Mesh[] = [];
  private labels: CSS2DObject[] = [];
  private selectedIndex = -1;
  private editMode = false;
  private labelsVisible = true;

  private readonly guidesGroup = new THREE.Group();
  private readonly selectGuide = new THREE.Group();
  private readonly scalpMesh: THREE.Mesh;

  private disposed = false;
  private loadGeneration = 0;
  private resizeGeneration = 0;
  private lastFrameAt = performance.now();

  constructor(
    private readonly container: HTMLElement,
    private readonly options: CortexRendererOptions,
  ) {
    this.electrodes = cloneElectrodes(options.electrodes);

    this.container.classList.add("cortex-three-host");

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });

    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.domElement.className = "cortex-three-canvas";
    this.container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "cortex-label-layer";
    this.container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color(0x000000);
    this.scene.add(this.brainRoot);

    // Brain model axes: +X right, +Y anterior (nose), +Z superior (top of
    // the head). Orbiting around Z turns the head like a turntable; with the
    // default Y-up, horizontal drags rolled the head over its nose axis.
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0, 0.55, 5.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.48, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.8;
    this.controls.enablePan = false;

    this.scalpMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 28),
      new THREE.MeshBasicMaterial({
        color: 0x5d9283,
        wireframe: true,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    this.scalpMesh.scale.set(1.82, 1.92, 1.62);
    this.scalpMesh.position.set(0, 0.12, 0.08);
    this.brainRoot.add(this.scalpMesh);

    this.createGuides();
    this.brainRoot.add(this.guidesGroup);
    this.brainRoot.add(this.selectGuide);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode("translate");
    this.transformHelper = this.transformControls.getHelper();
    this.scene.add(this.transformHelper);

    this.transformControls.addEventListener("dragging-changed", (event) => {
      this.controls.enabled = !event.value;
    });

    this.transformControls.addEventListener("objectChange", () => {
      this.updateSelectedFromMarker();
      this.updateSelectionGuide();
    });

    this.transformControls.addEventListener("mouseUp", () => {
      this.updateSelectedFromMarker();
      this.emitLayoutChange();
      this.rebuildInfluence();
    });

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);

    this.makeMarkers();
    this.setEditMode(false);

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleResize();
    });
    this.resizeObserver.observe(this.container);

    this.renderer.setAnimationLoop(this.renderFrame);
    this.scheduleResize();
  }

  async loadQuality(quality: CortexQuality): Promise<void> {
    const generation = ++this.loadGeneration;
    const gltf = await this.loader.loadAsync(MODEL_PATHS[quality]);

    if (this.disposed || generation !== this.loadGeneration) {
      this.disposeObject(gltf.scene);
      return;
    }

    this.removeBrainModel();

    const source = gltf.scene;
    source.position.set(0, 0, 0);
    source.scale.set(1, 1, 1);
    source.updateMatrixWorld(true);

    source.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.computeVertexNormals();
      }
    });

    const model = new THREE.Group();
    this.brainBase = this.cloneLayer(source, () => this.createBaseMaterial(), false);
    this.brainWire = this.cloneLayer(source, () => this.createWireMaterial(), false);
    this.brainWire.visible = this.wireVisible;
    this.brainEEG = this.cloneLayer(source, () => this.createEEGMaterial(), true);

    model.add(this.brainBase, this.brainWire, this.brainEEG);
    this.brainModel = model;
    this.brainRoot.add(model);

    this.fitCameraToBrain();
    this.updateViewport(false);
  }

  setActivityByLabel(activityByLabel: Readonly<Record<string, number>>): void {
    for (let index = 0; index < MAX_ELECTRODES; index += 1) {
      this.targetActivity[index] = 0;
    }

    this.electrodes.slice(0, MAX_ELECTRODES).forEach((electrode, index) => {
      this.targetActivity[index] = Math.max(0, Math.min(1, activityByLabel[electrode.label] ?? 0));
    });
  }

  setHotspotRadius(radius: number): void {
    this.uniforms.uRadius.value = Math.max(0.05, radius);
  }

  setDeformation(deformation: number): void {
    this.uniforms.uDeform.value = Math.max(0, deformation);
  }

  setEditMode(enabled: boolean): void {
    this.editMode = enabled;
    this.applyEditVisuals();

    if (enabled && this.selectedIndex < 0 && this.markers.length > 0) {
      this.selectElectrode(0);
    }
  }

  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    this.applyEditVisuals();
  }

  getElectrodes(): CortexElectrode[] {
    return cloneElectrodes(this.electrodes);
  }

  setElectrodes(electrodes: readonly CortexElectrode[]): void {
    this.electrodes = cloneElectrodes(electrodes);
    this.selectedIndex = -1;
    this.makeMarkers();
    this.rebuildInfluence();
    this.emitLayoutChange();
  }

  selectElectrode(index: number): void {
    if (index < 0 || index >= this.markers.length) {
      return;
    }

    this.markers.forEach((marker) => {
      const material = marker.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.color.set(0x8ed9c0);
      }
    });

    this.selectedIndex = index;
    const selected = this.markers[index];
    const material = selected.material;

    if (material instanceof THREE.MeshBasicMaterial) {
      material.color.set(0xf76707);
    }

    this.transformControls.attach(selected);
    this.updateSelectionGuide();
    this.options.onSelectionChange?.(index);
  }

  updateElectrode(index: number, electrode: CortexElectrode): void {
    if (index < 0 || index >= this.electrodes.length) {
      return;
    }

    this.electrodes[index] = {
      label: electrode.label,
      position: [...electrode.position] as [number, number, number],
    };

    const marker = this.markers[index];
    marker.position.fromArray(electrode.position);

    const label = this.labels[index];
    label.position.copy(marker.position).add(new THREE.Vector3(0, 0.08, 0));
    label.element.textContent = electrode.label;

    this.updateSelectionGuide();
    this.rebuildInfluence();
    this.emitLayoutChange();
  }

  addElectrode(): void {
    if (this.electrodes.length >= MAX_ELECTRODES) {
      return;
    }

    this.electrodes.push({
      label: `E${this.electrodes.length + 1}`,
      position: [0, 1.8, 0],
    });

    this.makeMarkers();
    this.selectElectrode(this.electrodes.length - 1);
    this.rebuildInfluence();
    this.emitLayoutChange();
  }

  deleteSelectedElectrode(): void {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.electrodes.length) {
      return;
    }

    const deletedIndex = this.selectedIndex;
    this.electrodes.splice(deletedIndex, 1);
    this.selectedIndex = -1;
    this.makeMarkers();

    if (this.electrodes.length > 0) {
      this.selectElectrode(Math.min(deletedIndex, this.electrodes.length - 1));
    }

    this.rebuildInfluence();
    this.emitLayoutChange();
  }

  refitCamera(): void {
    this.fitCameraToBrain(false);
    this.updateViewport(false);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.loadGeneration += 1;
    this.resizeGeneration += 1;

    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);

    this.transformControls.detach();
    this.transformControls.dispose();
    this.controls.dispose();

    this.removeMarkers();
    this.removeBrainModel();

    this.disposeObject(this.scalpMesh);
    this.disposeObject(this.guidesGroup);
    this.disposeObject(this.selectGuide);

    this.renderer.dispose();

    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  private readonly renderFrame = (now: number): void => {
    if (this.disposed) {
      return;
    }

    const deltaSeconds = Math.min(0.05, Math.max(0, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;

    const tau = 0.1;
    const alpha = 1 - Math.exp(-deltaSeconds / tau);

    for (let index = 0; index < MAX_ELECTRODES; index += 1) {
      this.activity[index] += (this.targetActivity[index] - this.activity[index]) * alpha;
    }

    if (this.hasBrainBounds) {
      this.controls.target.copy(this.brainCenter);
    }

    this.controls.update();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);

    // CSS2D labels touch the DOM for every electrode. They are only visible
    // in edit mode, so skip the per-frame DOM work otherwise.
    if (this.editMode && this.labelsVisible) {
      this.labelRenderer.render(this.scene, this.camera);
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.editMode) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.markers, false)[0];

    if (hit) {
      const index = Number(hit.object.userData.cortexElectrodeIndex);
      if (Number.isInteger(index)) {
        this.selectElectrode(index);
      }
    }
  };

  private createEEGMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  private createBaseMaterial(): THREE.Material {
    return new THREE.MeshNormalMaterial({
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });
  }

  private createWireMaterial(): THREE.Material {
    return new THREE.MeshBasicMaterial({
      color: 0x8ed9c0,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  private cloneLayer(
    source: THREE.Object3D,
    materialFactory: () => THREE.Material,
    needsInfluence: boolean,
  ): THREE.Object3D {
    const root = source.clone(true);

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      object.geometry = object.geometry.clone();
      object.geometry.computeVertexNormals();

      if (needsInfluence) {
        this.precomputeInfluence(object.geometry);
      }

      object.material = materialFactory();
      object.frustumCulled = false;
    });

    return root;
  }

  private precomputeInfluence(geometry: THREE.BufferGeometry): void {
    const positions = geometry.getAttribute("position");

    if (!positions) {
      return;
    }

    const vertexCount = positions.count;
    const indices = new Float32Array(vertexCount * 4);
    const distances = new Float32Array(vertexCount * 4);
    const usableElectrodes = this.electrodes.slice(0, MAX_ELECTRODES);

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const nearest: Array<[number, number]> = [];

      for (let electrodeIndex = 0; electrodeIndex < usableElectrodes.length; electrodeIndex += 1) {
        const electrode = usableElectrodes[electrodeIndex];
        const dx = positions.getX(vertex) - electrode.position[0];
        const dy = positions.getY(vertex) - electrode.position[1];
        const dz = positions.getZ(vertex) - electrode.position[2];
        nearest.push([dx * dx + dy * dy + dz * dz, electrodeIndex]);
      }

      nearest.sort((left, right) => left[0] - right[0]);

      for (let slot = 0; slot < 4; slot += 1) {
        const nearestEntry = nearest[slot] ?? [999, 0];
        distances[vertex * 4 + slot] = nearestEntry[0];
        indices[vertex * 4 + slot] = nearestEntry[1];
      }
    }

    geometry.setAttribute("eIndex", new THREE.BufferAttribute(indices, 4));
    geometry.setAttribute("eDist2", new THREE.BufferAttribute(distances, 4));
  }

  private rebuildInfluence(): void {
    if (!this.brainEEG) {
      return;
    }

    this.brainEEG.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        this.precomputeInfluence(object.geometry);
      }
    });
  }

  /**
   * Preserves the key BrainDance resize fix: fit using BOTH horizontal and
   * vertical FOV. This is important when the KNeuron module viewport changes
   * aspect ratio as shell panels collapse or the desktop window is resized.
   */
  /**
   * Fits the camera distance to the brain and the current viewport.
   *
   * keepDirection = true preserves the user's orbit (used on resize, e.g.
   * while dragging a panel edge); false resets to the top view.
   */
  private fitCameraToBrain(keepDirection = false): void {
    if (!this.brainModel || !this.brainBase) {
      return;
    }

    this.brainRoot.updateMatrixWorld(true);
    this.brainModel.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(this.brainBase);

    if (box.isEmpty()) {
      throw new Error("Brain bounding box is empty.");
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    this.brainCenter.copy(center);
    this.brainSize.copy(size);
    this.hasBrainBounds = true;

    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const distanceY = size.y / 2 / Math.tan(verticalFov / 2);
    const distanceX = size.x / 2 / Math.tan(horizontalFov / 2);
    const depthAllowance = size.z / 2;
    const distance = (Math.max(distanceX, distanceY) + depthAllowance) * 1.18;

    // Start in the top (scalp-map) view with the nose pointing up. A tiny
    // offset towards the back keeps the camera off the orbit pole, where the
    // view direction would be undefined.
    const poleOffset = distance * 0.001;
    const largestSide = Math.max(size.x, size.y, size.z);

    const direction = this.camera.position.clone().sub(this.controls.target);

    this.controls.target.copy(center);

    if (keepDirection && direction.lengthSq() > 0) {
      this.camera.position.copy(center).addScaledVector(direction.normalize(), distance);
    } else {
      this.camera.position.set(center.x, center.y - poleOffset, center.z + distance);
    }

    this.camera.lookAt(center);
    // Near/far must cover every orbit angle, not only the top view.
    this.camera.near = Math.max(0.01, distance - largestSide * 1.5);
    this.camera.far = Math.max(100, distance + largestSide * 4);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private scheduleResize(): void {
    const generation = ++this.resizeGeneration;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.disposed && generation === this.resizeGeneration) {
          this.updateViewport(true);
        }
      });
    });
  }

  private updateViewport(refit: boolean): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.labelRenderer.setSize(width, height);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    if (refit && this.hasBrainBounds) {
      this.fitCameraToBrain(true);
    }

    this.controls.update();
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  private createGuides(): void {
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
    });

    const line = (start: THREE.Vector3, end: THREE.Vector3): THREE.Line => {
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), material);
    };

    this.guidesGroup.add(
      line(new THREE.Vector3(-2.3, 0, 0), new THREE.Vector3(2.3, 0, 0)),
      line(new THREE.Vector3(0, -2.3, 0), new THREE.Vector3(0, 2.3, 0)),
      line(new THREE.Vector3(0, 0, -2.3), new THREE.Vector3(0, 0, 2.3)),
    );
  }

  private makeMarkers(): void {
    this.removeMarkers();

    this.electrodes.slice(0, MAX_ELECTRODES).forEach((electrode, index) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0x8ed9c0 }),
      );

      marker.position.fromArray(electrode.position);
      marker.userData.cortexElectrodeIndex = index;
      this.brainRoot.add(marker);
      this.markers.push(marker);

      const element = document.createElement("div");
      element.className = "cortex-electrode-label";
      element.textContent = electrode.label;

      const label = new CSS2DObject(element);
      label.position.copy(marker.position).add(new THREE.Vector3(0, 0.08, 0));
      this.brainRoot.add(label);
      this.labels.push(label);
    });

    this.applyEditVisuals();
  }

  private removeMarkers(): void {
    this.transformControls.detach();

    for (const marker of this.markers) {
      this.brainRoot.remove(marker);
      this.disposeObject(marker);
    }

    for (const label of this.labels) {
      this.brainRoot.remove(label);
      label.element.remove();
    }

    this.markers = [];
    this.labels = [];
  }

  private applyEditVisuals(): void {
    this.markers.forEach((marker) => {
      marker.visible = this.editMode;
    });

    this.labels.forEach((label) => {
      label.visible = this.editMode && this.labelsVisible;
    });

    // Apply label visibility immediately; renderFrame skips hidden labels.
    this.labelRenderer.render(this.scene, this.camera);

    this.guidesGroup.visible = this.editMode;
    this.selectGuide.visible = this.editMode;
    this.scalpMesh.visible = this.editMode;
    this.transformHelper.visible = this.editMode && this.selectedIndex >= 0;

    if (!this.editMode) {
      this.transformControls.detach();
    } else if (this.selectedIndex >= 0 && this.markers[this.selectedIndex]) {
      this.transformControls.attach(this.markers[this.selectedIndex]);
    }
  }

  private updateSelectedFromMarker(): void {
    if (this.selectedIndex < 0) {
      return;
    }

    const marker = this.markers[this.selectedIndex];

    if (!marker) {
      return;
    }

    this.electrodes[this.selectedIndex] = {
      ...this.electrodes[this.selectedIndex],
      position: [marker.position.x, marker.position.y, marker.position.z],
    };

    const label = this.labels[this.selectedIndex];
    label.position.copy(marker.position).add(new THREE.Vector3(0, 0.08, 0));
  }

  private updateSelectionGuide(): void {
    while (this.selectGuide.children.length > 0) {
      const child = this.selectGuide.children[0];
      this.selectGuide.remove(child);
      this.disposeObject(child);
    }

    if (!this.editMode || this.selectedIndex < 0) {
      return;
    }

    const marker = this.markers[this.selectedIndex];

    if (!marker) {
      return;
    }

    const point = marker.position;

    const createLine = (start: THREE.Vector3, end: THREE.Vector3, color: number): THREE.Line => {
      return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start, end]),
        new THREE.LineBasicMaterial({ color }),
      );
    };

    this.selectGuide.add(
      createLine(
        new THREE.Vector3(-2.2, point.y, point.z),
        new THREE.Vector3(2.2, point.y, point.z),
        0xff5555,
      ),
      createLine(
        new THREE.Vector3(point.x, -2.2, point.z),
        new THREE.Vector3(point.x, 2.2, point.z),
        0x55ff77,
      ),
      createLine(
        new THREE.Vector3(point.x, point.y, -2.2),
        new THREE.Vector3(point.x, point.y, 2.2),
        0x5599ff,
      ),
    );
  }

  private emitLayoutChange(): void {
    this.options.onLayoutChange?.(this.getElectrodes());
  }

  private removeBrainModel(): void {
    if (!this.brainModel) {
      return;
    }

    this.brainRoot.remove(this.brainModel);
    this.disposeObject(this.brainModel);

    this.brainModel = null;
    this.brainBase = null;
    this.brainWire = null;
    this.brainEEG = null;
    this.hasBrainBounds = false;
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.geometry?.dispose();

      const materials = Array.isArray(child.material) ? child.material : [child.material];

      for (const material of materials) {
        material?.dispose();
      }
    });
  }
}
