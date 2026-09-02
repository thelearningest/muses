"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { VisualSpec } from "./game-package";

type GeneratedArtifactProps = {
  visual: VisualSpec;
  revealed: boolean;
  repaired: boolean;
};

const ACCENTS = {
  red: 0xb92520,
  yellow: 0xf0ca08,
  green: 0x315d4c,
};

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addSphere(
  parent: THREE.Object3D,
  radius: number,
  position: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildObject(group: THREE.Group, visual: VisualSpec, repaired: boolean) {
  const accent = new THREE.MeshStandardMaterial({ color: ACCENTS[visual.accent], roughness: 0.35, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171714, roughness: 0.32, metalness: 0.45 });
  const light = new THREE.MeshStandardMaterial({ color: 0xf2eee3, roughness: 0.88 });
  const offset = repaired ? 0.24 : 0;

  if (visual.form === "portal") {
    addBox(group, [0.42, 4.4, 0.55], [-1.75, 2.2, 0], dark);
    addBox(group, [0.42, 4.4, 0.55], [1.75, 2.2, 0], dark);
    addBox(group, [3.9, 0.42, 0.55], [0, 4.18, 0], dark);
    const panel = addBox(group, [3.05, 3.75, 0.3], [0, 2.08, 0.06], accent);
    panel.rotation.y = repaired ? -0.3 : 0;
    addBox(group, repaired ? [0.7, 1.35, 0.14] : [0.16, 1.5, 0.22], [0.9, 2.12, 0.35], repaired ? light : dark);
  } else if (visual.form === "console") {
    addBox(group, [4.6, 0.7, 2.8], [0, 0.55, 0], dark);
    const deck = addBox(group, [4.3, 0.28, 2.25], [0, 1.1, -0.1], accent);
    deck.rotation.x = -0.22;
    addBox(group, [2.25, 1.45, 0.22], [0, 2.05, -0.8], light);
    [-1.35, 0, 1.35].forEach((x, index) => addSphere(group, 0.25, [x, 1.3 + (repaired && index === 1 ? offset : 0), 0.55], index === 1 ? accent : light));
  } else if (visual.form === "assembly") {
    addBox(group, [5, 0.35, 3.5], [0, 0.18, 0], dark);
    addBox(group, [1.3, 1.3, 1.3], [-1.45 + offset, 0.95, 0.25], accent);
    addSphere(group, 0.78, [0.2, 0.98 + offset, -0.2], light);
    const tower = addBox(group, [1.05, 2.2, 1.05], [1.6 - offset, 1.28, 0.25], dark);
    tower.rotation.z = repaired ? 0 : 0.16;
  } else if (visual.form === "network") {
    const positions: [number, number, number][] = [[-1.8, 1.1, 0.3], [0, 2.6, -0.4], [1.8, 1.1, 0.3]];
    positions.forEach((position, index) => addSphere(group, index === 1 ? 0.72 : 0.58, position, index === 1 ? accent : light));
    addBox(group, [2.2, 0.16, 0.16], [-0.85, 1.86, 0], dark).rotation.z = 0.64;
    addBox(group, [2.2, 0.16, 0.16], [0.85, 1.86, 0], dark).rotation.z = -0.64;
    if (repaired) addBox(group, [3.6, 0.12, 0.12], [0, 1.08, 0.3], accent);
  } else if (visual.form === "sequence") {
    [-1.8, -0.6, 0.6, 1.8].forEach((x, index) => {
      addBox(group, [0.9, 0.65 + index * 0.48, 1.4], [x, 0.33 + index * 0.24, 0], index === (repaired ? 2 : 1) ? accent : light);
    });
  } else {
    addBox(group, [2.6, 3.6, 1.2], [0, 1.8, 0], dark);
    addBox(group, [2.15, 1.55, 0.16], [0, 2.35, 0.68], accent);
    addBox(group, [1.5, 0.32, 0.75], [0, 0.72, 0.82], repaired ? accent : light);
    addSphere(group, 0.18, [0.82, 1.25, 0.68], repaired ? light : accent);
  }

  return () => {
    [accent, dark, light].forEach((material) => material.dispose());
  };
}

function GeneratedDiagram({ visual, revealed, repaired }: GeneratedArtifactProps) {
  return (
    <div className={`generated-diagram generated-${visual.form} accent-${visual.accent}`} role="img" aria-label={`${visual.title}. ${repaired ? visual.repairLabel : visual.problemLabel}`}>
      <div className="generated-diagram-grid" aria-hidden="true" />
      <div className="generated-diagram-title"><span>Generated study object</span><strong>{visual.title}</strong></div>
      <div className="generated-elements">
        {visual.elements.map((element, index) => <span key={element} className={`generated-element element-${index + 1}`}>{element}</span>)}
      </div>
      {revealed && <p className={`generated-finding ${repaired ? "is-repaired" : ""}`}>{repaired ? visual.repairLabel : visual.problemLabel}</p>}
    </div>
  );
}

function GeneratedThreeD({ visual, revealed, repaired }: GeneratedArtifactProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      queueMicrotask(() => setFallback(true));
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe7e0d2);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(5.6, 3.8, 7.4);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.5;
    controls.maxDistance = 12;
    controls.target.set(0, 1.7, 0);

    scene.add(new THREE.HemisphereLight(0xfff8e8, 0x5b554c, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    scene.add(key);

    const group = new THREE.Group();
    scene.add(group);
    const disposeMaterials = buildObject(group, visual, repaired);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xf2eee3, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      disposeMaterials();
      floorMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [repaired, visual]);

  if (fallback) return <GeneratedDiagram visual={visual} revealed={revealed} repaired={repaired} />;

  return (
    <div className="generated-inspector">
      <div ref={mountRef} className="generated-inspector-canvas" role="img" aria-label={`Interactive 3D model: ${visual.title}`} />
      <div className="generated-inspector-guide"><span>Book-specific 3D</span><strong>{visual.title}</strong><small>Drag to rotate · scroll to zoom</small></div>
      <div className="generated-inspector-elements">{visual.elements.map((element) => <span key={element}>{element}</span>)}</div>
      {revealed && <p className={`generated-finding ${repaired ? "is-repaired" : ""}`}>{repaired ? visual.repairLabel : visual.problemLabel}</p>}
    </div>
  );
}

export function GeneratedArtifact(props: GeneratedArtifactProps) {
  return props.visual.mode === "3d" ? <GeneratedThreeD {...props} /> : <GeneratedDiagram {...props} />;
}
