"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type ViewName = "overview" | "handle" | "motion";

type InspectorRig = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
};

const VIEWS: Record<ViewName, { position: [number, number, number]; target: [number, number, number] }> = {
  overview: { position: [5.7, 3.5, 7.2], target: [0, 2, 0] },
  handle: { position: [2.2, 2.55, 3.4], target: [0.82, 2.25, 0] },
  motion: { position: [-5.4, 3.1, 5.1], target: [0, 2, 0] },
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

function addCylinder(
  parent: THREE.Object3D,
  radius: number,
  length: number,
  position: [number, number, number],
  material: THREE.Material,
  rotation: [number, number, number] = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function GateInspector3D({ revealed, repaired }: { revealed: boolean; repaired: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<InspectorRig | null>(null);
  const [activeView, setActiveView] = useState<ViewName>("overview");
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      queueMicrotask(() => setFallback(true));
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe7e0d2);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(...VIEWS.overview.position);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.tabIndex = -1;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 11;
    controls.minPolarAngle = 0.42;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.target.set(...VIEWS.overview.target);

    rigRef.current = { camera, controls };

    scene.add(new THREE.HemisphereLight(0xfff7df, 0x5b554c, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(4.5, 7, 5.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xf0ca08, 1.1);
    fillLight.position.set(-4, 3, 2);
    scene.add(fillLight);

    const red = new THREE.MeshStandardMaterial({ color: 0x9f211c, roughness: 0.33, metalness: 0.05 });
    const redDark = new THREE.MeshStandardMaterial({ color: 0x6f1714, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x11110f, roughness: 0.25, metalness: 0.7 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xf0ca08, roughness: 0.24, metalness: 0.72 });
    const wall = new THREE.MeshStandardMaterial({ color: 0xf2eee3, roughness: 0.94 });

    const exhibit = new THREE.Group();
    scene.add(exhibit);

    addBox(exhibit, [5.9, 4.9, 0.35], [0, 2.35, -0.48], wall);
    addBox(exhibit, [0.35, 4.8, 0.48], [-1.83, 2.35, -0.08], black);
    addBox(exhibit, [0.35, 4.8, 0.48], [1.83, 2.35, -0.08], black);
    addBox(exhibit, [4, 0.35, 0.48], [0, 4.58, -0.08], black);

    const doorPivot = new THREE.Group();
    doorPivot.position.set(-1.62, 0.22, 0);
    doorPivot.rotation.y = repaired ? -0.28 : 0;
    exhibit.add(doorPivot);

    const door = new THREE.Group();
    door.position.set(1.62, 0, 0);
    doorPivot.add(door);
    addBox(door, [3.24, 4.18, 0.24], [0, 2.12, 0], red);
    addBox(door, [2.78, 0.12, 0.07], [0, 3.65, 0.16], redDark);
    addBox(door, [2.78, 0.12, 0.07], [0, 2.62, 0.16], redDark);
    addBox(door, [2.78, 0.12, 0.07], [0, 1.58, 0.16], redDark);
    addBox(door, [2.78, 0.12, 0.07], [0, 0.55, 0.16], redDark);
    addBox(door, [0.12, 3.55, 0.07], [-1.06, 2.1, 0.16], redDark);
    addBox(door, [0.12, 3.55, 0.07], [1.06, 2.1, 0.16], redDark);

    if (repaired) {
      addBox(door, [0.72, 1.32, 0.1], [0.82, 2.12, 0.2], brass);
    } else {
      addCylinder(door, 0.075, 1.35, [0.82, 2.18, 0.36], black);
      addCylinder(door, 0.055, 0.27, [0.82, 2.78, 0.25], black, [Math.PI / 2, 0, 0]);
      addCylinder(door, 0.055, 0.27, [0.82, 1.58, 0.25], black, [Math.PI / 2, 0, 0]);
    }

    if (revealed && !repaired) {
      const cueRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.45, 0.035, 14, 48),
        new THREE.MeshBasicMaterial({ color: 0xf0ca08 }),
      );
      cueRing.position.set(0.82, 2.18, 0.47);
      door.add(cueRing);
    }

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), wall);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
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
      frame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      rigRef.current = null;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [repaired, revealed]);

  const selectView = (view: ViewName) => {
    setActiveView(view);
    const rig = rigRef.current;
    if (!rig) return;
    rig.camera.position.set(...VIEWS[view].position);
    rig.controls.target.set(...VIEWS[view].target);
    rig.controls.update();
  };

  if (fallback) {
    return (
      <div
        className="gate-inspector-fallback"
        role="img"
        aria-label="A lacquer-red gate with an inviting black pull handle and ambiguous hardware."
      />
    );
  }

  return (
    <div className="gate-inspector">
      <div
        className="gate-inspector-canvas"
        ref={mountRef}
        role="img"
        aria-label={
          repaired
            ? "An interactive three-dimensional red gate repaired with a broad push plate."
            : "An interactive three-dimensional red gate with a large pull handle even though it opens by pushing."
        }
      />
      <div className="gate-inspector-guide">
        <span>Interactive 3D</span>
        <strong>Drag to rotate · pinch or scroll to zoom</strong>
      </div>
      <div className="gate-inspector-views" aria-label="Gate inspection views">
        <button
          type="button"
          className={activeView === "overview" ? "is-active" : ""}
          aria-pressed={activeView === "overview"}
          onClick={() => selectView("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={activeView === "handle" ? "is-active" : ""}
          aria-pressed={activeView === "handle"}
          onClick={() => selectView("handle")}
        >
          Handle cue
        </button>
        <button
          type="button"
          className={activeView === "motion" ? "is-active" : ""}
          aria-pressed={activeView === "motion"}
          onClick={() => selectView("motion")}
        >
          Push motion
        </button>
      </div>
      {revealed && !repaired && (
        <span className="gate-inspector-finding">The hardware says pull. The hinge requires push.</span>
      )}
      {repaired && <span className="gate-inspector-finding is-repaired">Push plate fitted · gate opens inward</span>}
    </div>
  );
}
