import { Environment, Float, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  getConsoleFunction,
  type Group,
  type InstancedMesh,
  MathUtils,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  Object3D,
  setConsoleFunction,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  CARD_COUNT,
  cardAt,
  type CardPhase,
  EVIDENCE_KINDS,
  type HeroMotion,
  STATION_COUNT,
} from '../lib/evidenceLoop';
import { FrameGovernor } from '../lib/frameGovernor';

// The evidence loop in 3D, loaded lazily by LoopVisual (which also decides when it may
// render at all). Two variants share the canvas setup:
//   hero   — the landing page: evidence cards travelling through six stations.
//   status — a work order: one node per requirement, coloured by its status.

export interface LoopNode {
  hex: string;
  pulsing: boolean;
}

interface Common {
  /** False under prefers-reduced-motion: nothing moves on its own. */
  animate: boolean;
  /** False while off-screen or the tab is hidden: no frames are rendered. */
  active: boolean;
  /** Accessible description of what the canvas shows. */
  label: string;
  /** The scene can't continue: the WebGL context was lost, or the device is too slow. */
  onFallback: (reason: 'context-lost' | 'too-slow') => void;
}

export type LoopSceneProps = Common &
  (
    | { variant: 'status'; nodes: LoopNode[]; coreHex: string }
    | {
        variant: 'hero';
        motion: RefObject<HeroMotion>;
        activeStation: number;
        /** DOM labels, one per station, positioned over the canvas every frame. */
        labels: RefObject<(HTMLElement | null)[]>;
      }
  );

const TAU = Math.PI * 2;
const NV_GREEN = '#76b900';
const AMBER = '#f5a524';
const BACKGROUND = '#05070c';
const MAX_DELTA = 0.1; // a resumed tab must not make anything jump; slow devices still keep up

/**
 * Two known, harmless warnings that are not ours to fix:
 * - R3F 9 (latest release included) creates a THREE.Clock, which three r183+ reports as
 *   deprecated whenever a canvas mounts.
 * - On Windows, Chrome/Edge compile shaders through D3D, whose compiler adds precision notes
 *   ("warning X4122 …") to the log of shaders that linked fine; three prints that log.
 * Exactly these are dropped; everything else three logs goes to the console as before.
 */
function isKnownNoise(type: string, message: string, params: unknown[]) {
  if (type !== 'warn') return false;
  if (message.startsWith('THREE.Clock: This module has been deprecated')) return true;
  if (message === 'THREE.WebGLProgram: Program Info Log:' && typeof params[0] === 'string') {
    return params[0].split('\n').every((line) => line.trim() === '' || /: warning X\d+:/.test(line));
  }
  return false;
}
const forwardThreeLog = getConsoleFunction();
setConsoleFunction((type, message, ...params) => {
  if (isKnownNoise(type, message, params)) return;
  if (forwardThreeLog) return forwardThreeLog(type, message, ...params);
  const [first] = params as [{ isStackTrace?: boolean; getError: (m: string) => Error }?];
  if (first?.isStackTrace) console[type](first.getError(message));
  else console[type](message, ...params);
});

/**
 * Quality steps, from full to lowest. Hero: 1 = DPR 1, 2 = no bloom, 3 = fewer particles.
 * A work order's scene only has the first step.
 */
const QUALITY_STEPS = { hero: 3, status: 1 } as const;
/** The lowest quality any scene reached this session; later scenes start there. */
let sessionQuality = 0;

export default function LoopScene(props: LoopSceneProps) {
  const { animate, active, label, onFallback } = props;
  const hero = props.variant === 'hero';
  const [quality, setQuality] = useState(() => Math.min(sessionQuality, QUALITY_STEPS[props.variant]));

  return (
    <Canvas
      dpr={quality >= 1 ? 1 : [1, 1.5]}
      frameloop={!active ? 'never' : animate ? 'always' : 'demand'}
      camera={hero ? { position: [0, 3.2, 9], fov: 38, near: 0.1, far: 60 } : { position: [0, 2.6, 5.2], fov: 42 }}
      gl={{ antialias: !hero, alpha: !hero, powerPreference: hero ? 'high-performance' : 'default' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault();
            onFallback('context-lost');
          },
          { once: true },
        );
      }}
    >
      <CanvasLabel label={label} quality={quality} />
      {/* Under reduced motion frames are rendered on demand only, so there is no rate to measure. */}
      {animate && (
        <Governor
          maxLevel={QUALITY_STEPS[props.variant]}
          startLevel={quality}
          onDegrade={(level) => {
            sessionQuality = Math.max(sessionQuality, level);
            setQuality(level);
          }}
          onFallback={() => onFallback('too-slow')}
        />
      )}
      {props.variant === 'hero' ? (
        <HeroLoop
          quality={quality}
          animate={animate}
          motion={props.motion}
          activeStation={props.activeStation}
          labels={props.labels}
        />
      ) : (
        <StatusLoop nodes={props.nodes} coreHex={props.coreHex} animate={animate} />
      )}
    </Canvas>
  );
}

/**
 * The canvas element itself carries the description, so it is announced as one image.
 * data-quality (0 = full) shows how far adaptive quality has stepped down.
 */
function CanvasLabel({ label, quality }: { label: string; quality: number }) {
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    canvas.dataset.quality = String(quality);
  }, [canvas, label, quality]);
  return null;
}

/** Measures real frame rates: too slow at start-up → 2D; slow later → lower quality, one way. */
function Governor({
  maxLevel,
  startLevel,
  onDegrade,
  onFallback,
}: {
  maxLevel: number;
  startLevel: number;
  onDegrade: (level: number) => void;
  onFallback: () => void;
}) {
  const [governor] = useState(() => new FrameGovernor(maxLevel, startLevel));
  useFrame((_, delta) => {
    const verdict = governor.tick(delta);
    if (verdict === 'fallback') onFallback();
    else if (verdict === 'degrade') onDegrade(governor.quality);
  });
  return null;
}

// ---------------------------------------------------------------- hero

const RADIUS = 3;
const INNER_RADIUS = 2.1;
/** Station units per second. */
const SPEED = 0.42;
/** Under reduced motion the cards hold this arrangement: amber, green and re-checked cards all visible. */
const FROZEN_TIME = 3;
const CAMERA_BASE = -0.42;

/** Station k sits at angle k/6 of a turn; u is a (fractional) station index. */
function ringPoint(u: number, radius: number, target: Vector3) {
  const angle = (u / STATION_COUNT) * TAU;
  return target.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
}

function HeroLoop({
  quality,
  animate,
  motion,
  activeStation,
  labels,
}: {
  quality: number;
  animate: boolean;
  motion: RefObject<HeroMotion>;
  activeStation: number;
  labels: RefObject<(HTMLElement | null)[]>;
}) {
  return (
    <>
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[BACKGROUND, 11, 24]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 8, 6]} intensity={1.2} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 5, -6]} scale={[12, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} color={NV_GREEN} position={[-6, 1, 3]} scale={[4, 6, 1]} />
        <Lightformer form="ring" intensity={0.8} position={[6, 2, 4]} scale={3} />
      </Environment>

      <HeroCamera animate={animate} motion={motion} />

      <Float speed={animate ? 1.1 : 0} rotationIntensity={0.12} floatIntensity={0.25} floatingRange={[-0.08, 0.08]}>
        <group rotation={[0.04, 0, 0]}>
          <Ring />
          <Stations activeStation={activeStation} labels={labels} animate={animate} />
          <Cards animate={animate} />
        </group>
      </Float>
      <Particles animate={animate} count={quality >= 3 ? PARTICLE_COUNT_LOW : PARTICLE_COUNT} />

      <EffectComposer multisampling={4} enableNormalPass={false}>
        {quality < 2 && <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.95} luminanceSmoothing={0.25} radius={0.72} />}
        <Vignette offset={0.28} darkness={0.55} />
      </EffectComposer>
    </>
  );
}

/**
 * Scroll turns the camera around the loop so each station comes forward in turn; the
 * pointer adds a small parallax. Both are damped. Under reduced motion the camera is fixed.
 */
function HeroCamera({ animate, motion }: { animate: boolean; motion: RefObject<HeroMotion> }) {
  const state = useRef<{ azimuth: number; x: number; y: number } | null>(null);
  const target = useMemo(() => new Vector3(0, -0.15, 0), []);

  useFrame(({ camera, size }, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);
    const input = motion.current;
    const goal = {
      azimuth: CAMERA_BASE + (animate ? input.progress * ((STATION_COUNT - 1) / STATION_COUNT) * TAU : 0),
      x: animate ? input.pointerX * 0.45 : 0,
      y: animate ? -input.pointerY * 0.3 : 0,
    };
    const current = (state.current ??= { ...goal });
    current.azimuth = MathUtils.damp(current.azimuth, goal.azimuth, 2.4, delta);
    current.x = MathUtils.damp(current.x, goal.x, 3, delta);
    current.y = MathUtils.damp(current.y, goal.y, 3, delta);

    // Narrow (portrait) screens step back so the whole ring stays in frame.
    const aspect = size.width / Math.max(size.height, 1);
    const distance = aspect < 0.8 ? 13.5 : aspect < 1.2 ? 11 : 9;
    const height = 3.3 + current.y;
    camera.position.set(
      Math.sin(current.azimuth) * distance + Math.cos(current.azimuth) * current.x,
      height,
      Math.cos(current.azimuth) * distance - Math.sin(current.azimuth) * current.x,
    );
    camera.lookAt(target);
  });
  return null;
}

function Ring() {
  const glow = useMemo(() => radialTexture(), []);
  useEffect(() => () => glow.dispose(), [glow]);

  return (
    <group>
      {/* The loop: a thin, bright core line that blooms, inside a faint halo. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RADIUS, 0.014, 12, 256]} />
        <meshBasicMaterial color={new Color(NV_GREEN).multiplyScalar(3.4)} toneMapped={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RADIUS, 0.09, 16, 256]} />
        <meshBasicMaterial color={NV_GREEN} transparent opacity={0.07} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
      {/* The inner lane evidence takes when it loops back to be re-analyzed. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[INNER_RADIUS, 0.006, 8, 200]} />
        <meshBasicMaterial color={new Color(AMBER).multiplyScalar(0.55)} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      {/* A soft pool of light under the ring, for depth. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]}>
        <planeGeometry args={[11, 11]} />
        <meshBasicMaterial map={glow} color={NV_GREEN} transparent opacity={0.35} depthWrite={false} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
}

function Stations({
  activeStation,
  labels,
  animate,
}: {
  activeStation: number;
  labels: RefObject<(HTMLElement | null)[]>;
  animate: boolean;
}) {
  const nodes = useRef<(Mesh | null)[]>([]);
  const scratch = useMemo(() => ({ world: new Vector3(), flat: new Vector3(), facing: new Vector3() }), []);

  useFrame(({ camera, size }, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);
    const { world, flat, facing } = scratch;
    facing.set(camera.position.x, 0, camera.position.z).normalize();
    for (let k = 0; k < STATION_COUNT; k++) {
      const node = nodes.current[k];
      if (!node) continue;
      const goal = k === activeStation ? 1.55 : 1;
      node.scale.setScalar(animate ? MathUtils.damp(node.scale.x, goal, 6, delta) : goal);

      // Pin the DOM label just above its station; stations behind the loop are dimmed.
      const el = labels.current[k];
      if (!el) continue;
      node.getWorldPosition(world);
      const front = flat.copy(world).setY(0).normalize().dot(facing);
      world.y += 0.42;
      world.project(camera);
      const x = (world.x * 0.5 + 0.5) * size.width;
      const y = (-world.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      el.style.opacity = (k === activeStation ? 1 : 0.3 + 0.5 * MathUtils.smoothstep(front, -0.7, 0.5)).toFixed(2);
    }
  });

  return (
    <>
      {Array.from({ length: STATION_COUNT }, (_, k) => {
        const position = ringPoint(k, RADIUS, new Vector3());
        const hex = k === 4 ? AMBER : NV_GREEN;
        const bright = k === activeStation ? 3.6 : 2.2;
        return (
          <group key={k} position={position}>
            <mesh ref={(mesh) => void (nodes.current[k] = mesh)}>
              <sphereGeometry args={[0.075, 24, 24]} />
              <meshBasicMaterial color={new Color(hex).multiplyScalar(bright)} toneMapped={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.2, 0.008, 8, 48]} />
              <meshBasicMaterial color={new Color(hex).multiplyScalar(k === activeStation ? 2 : 0.8)} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

const PHASE_COLORS: Record<CardPhase, Color> = {
  pending: new Color('#cbd5e1'),
  proven: new Color(NV_GREEN),
  needs: new Color(AMBER),
  recheck: new Color('#7dd3fc'),
};
const CARD_BODY = new Color('#0b111c');
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/**
 * Evidence cards — rounded glass panels with a glowing rim and an icon — drawn with
 * instancing: one mesh for all bodies, one for all rims, one per icon kind.
 */
function Cards({ animate }: { animate: boolean }) {
  const bodies = useRef<InstancedMesh>(null);
  const rims = useRef<InstancedMesh>(null);
  const photoIcons = useRef<InstancedMesh>(null);
  const videoIcons = useRef<InstancedMesh>(null);
  const documentIcons = useRef<InstancedMesh>(null);
  const clock = useRef(FROZEN_TIME);

  const geometry = useMemo(() => new RoundedBoxGeometry(0.66, 0.48, 0.05, 4, 0.07), []);
  const textures = useMemo(() => EVIDENCE_KINDS.map(iconTexture), []);
  const colors = useMemo(() => Array.from({ length: CARD_COUNT }, () => PHASE_COLORS.pending.clone()), []);
  const scratch = useMemo(() => ({ dummy: new Object3D(), point: new Vector3(), color: new Color() }), []);

  useEffect(
    () => () => {
      geometry.dispose();
      textures.forEach((texture) => texture.dispose());
    },
    [geometry, textures],
  );

  // Instance colours must exist before the first render so the shaders include them.
  useLayoutEffect(() => {
    for (let i = 0; i < CARD_COUNT; i++) {
      bodies.current?.setColorAt(i, CARD_BODY);
      rims.current?.setColorAt(i, PHASE_COLORS.pending);
    }
  }, []);

  useFrame(({ camera }, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);
    const body = bodies.current;
    const rim = rims.current;
    const icons = [photoIcons.current, videoIcons.current, documentIcons.current];
    if (!body || !rim || icons.some((mesh) => !mesh)) return;
    if (animate) clock.current += delta * SPEED;
    const { dummy, point, color } = scratch;

    for (let i = 0; i < CARD_COUNT; i++) {
      const { frame, kind } = cardAt(clock.current, i);

      if (!frame || frame.scale < 0.001) {
        body.setMatrixAt(i, HIDDEN);
        rim.setMatrixAt(i, HIDDEN);
        icons.forEach((mesh) => mesh!.setMatrixAt(i, HIDDEN));
        continue;
      }

      ringPoint(frame.u, MathUtils.lerp(RADIUS, INNER_RADIUS, frame.lane), point);
      dummy.position.set(point.x, 0.36 + frame.lift, point.z);
      dummy.lookAt(camera.position);
      dummy.scale.setScalar(frame.scale);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);

      dummy.scale.setScalar(frame.scale * 1.06);
      dummy.updateMatrix();
      rim.setMatrixAt(i, dummy.matrix);

      dummy.scale.setScalar(frame.scale);
      dummy.translateZ(0.03 * frame.scale);
      dummy.updateMatrix();
      icons.forEach((mesh, k) => mesh!.setMatrixAt(i, EVIDENCE_KINDS[k] === kind ? dummy.matrix : HIDDEN));

      // Colour eases toward the phase: green when proven, amber when more evidence is needed.
      const goal = PHASE_COLORS[frame.phase];
      colors[i]!.lerp(goal, animate ? 1 - Math.exp(-7 * delta) : 1);
      rim.setColorAt(i, color.copy(colors[i]!).multiplyScalar(frame.phase === 'pending' ? 1.1 : 3));
      body.setColorAt(i, color.copy(CARD_BODY).lerp(colors[i]!, 0.16));
    }

    for (const mesh of [body, rim, ...icons]) mesh!.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (rim.instanceColor) rim.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bodies} args={[geometry, undefined, CARD_COUNT]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.25} metalness={0.6} envMapIntensity={1.1} />
      </instancedMesh>
      <instancedMesh ref={rims} args={[geometry, undefined, CARD_COUNT]} frustumCulled={false}>
        <meshBasicMaterial side={BackSide} toneMapped={false} />
      </instancedMesh>
      {[photoIcons, videoIcons, documentIcons].map((ref, k) => (
        <instancedMesh key={EVIDENCE_KINDS[k]} ref={ref} args={[undefined, undefined, CARD_COUNT]} frustumCulled={false}>
          <planeGeometry args={[0.24, 0.24]} />
          <meshBasicMaterial map={textures[k]} transparent depthWrite={false} toneMapped={false} />
        </instancedMesh>
      ))}
    </>
  );
}

const PARTICLE_COUNT = 260;
const PARTICLE_COUNT_LOW = 90;

/** Drifting specks for depth: one instanced mesh, placed once, rotated slowly as a whole. */
function Particles({ animate, count }: { animate: boolean; count: number }) {
  const group = useRef<Group>(null);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const dummy = new Object3D();
    const tint = new Color();
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = random() * TAU;
      // A shell around the ring, inside the camera's orbit, so no speck passes close to the lens.
      const radius = 4.2 + random() * 3.6;
      dummy.position.set(Math.cos(angle) * radius, -2.5 + random() * 6, Math.sin(angle) * radius);
      dummy.scale.setScalar(0.006 + random() * 0.018);
      dummy.updateMatrix();
      target.setMatrixAt(i, dummy.matrix);
      target.setColorAt(i, tint.set(random() < 0.7 ? NV_GREEN : '#e2e8f0').multiplyScalar(0.6 + random() * 1.2));
    }
    target.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((_, rawDelta) => {
    if (animate && group.current) group.current.rotation.y += Math.min(rawDelta, MAX_DELTA) * 0.018;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[undefined, undefined, PARTICLE_COUNT]} count={count} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0.6} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/** A white radial falloff, tinted by the material colour. */
function radialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

/** Line icons for the cards, drawn once on a canvas: a photo, a video, a document. */
function iconTexture(kind: (typeof EVIDENCE_KINDS)[number]) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d');
  if (c) {
    c.strokeStyle = '#f1f5f9';
    c.fillStyle = '#f1f5f9';
    c.lineWidth = 7;
    c.lineJoin = c.lineCap = 'round';
    c.beginPath();
    if (kind === 'photo') {
      c.roundRect(14, 26, 100, 76, 12);
      c.stroke();
      c.beginPath();
      c.moveTo(24, 92);
      c.lineTo(52, 60);
      c.lineTo(72, 80);
      c.lineTo(86, 66);
      c.lineTo(104, 92);
      c.stroke();
      c.beginPath();
      c.arc(88, 46, 8, 0, TAU);
      c.fill();
    } else if (kind === 'video') {
      c.roundRect(14, 26, 100, 76, 12);
      c.stroke();
      c.beginPath();
      c.moveTo(54, 46);
      c.lineTo(82, 64);
      c.lineTo(54, 82);
      c.closePath();
      c.fill();
    } else {
      c.moveTo(34, 14);
      c.lineTo(78, 14);
      c.lineTo(98, 34);
      c.lineTo(98, 114);
      c.lineTo(34, 114);
      c.closePath();
      c.stroke();
      for (const y of [52, 70, 88]) {
        c.beginPath();
        c.moveTo(48, y);
        c.lineTo(84, y);
        c.stroke();
      }
    }
  }
  return new CanvasTexture(canvas);
}

// ---------------------------------------------------------------- status

const STATUS_RADIUS = 2;

function StatusLoop({ nodes, coreHex, animate }: { nodes: LoopNode[]; coreHex: string; animate: boolean }) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[4, 6, 4]} intensity={60} />
      <pointLight position={[-5, -2, -4]} intensity={25} color="#5eead4" />

      <group rotation={[0.12, 0, 0.06]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[STATUS_RADIUS, 0.018, 12, 160]} />
          <meshBasicMaterial color="#3b4a69" />
        </mesh>
        <Tracer animate={animate} />
        {nodes.map((node, index) => (
          <StatusNode key={index} node={node} index={index} total={nodes.length} />
        ))}

        <Float speed={animate ? 2 : 0} rotationIntensity={0.8} floatIntensity={0.6}>
          <mesh>
            <icosahedronGeometry args={[0.62, 1]} />
            <meshStandardMaterial color={coreHex} emissive={coreHex} emissiveIntensity={0.5} wireframe />
          </mesh>
          <mesh>
            <icosahedronGeometry args={[0.36, 0]} />
            <meshStandardMaterial color={coreHex} emissive={coreHex} emissiveIntensity={0.9} roughness={0.2} />
          </mesh>
        </Float>
      </group>

      <OrbitControls enableZoom={false} enablePan={false} autoRotate={animate} autoRotateSpeed={0.7} />
    </>
  );
}

function StatusNode({ node, index, total }: { node: LoopNode; index: number; total: number }) {
  const material = useRef<MeshStandardMaterial>(null);
  const mesh = useRef<Mesh>(null);
  const angle = (index / total) * TAU - Math.PI / 2;

  useFrame(({ clock }) => {
    if (!material.current || !mesh.current) return;
    const wave = node.pulsing ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5) : 0;
    material.current.emissiveIntensity = node.pulsing ? 0.5 + wave * 1.6 : 0.85;
    mesh.current.scale.setScalar(node.pulsing ? 1 + wave * 0.25 : 1);
  });

  return (
    <mesh ref={mesh} position={[Math.cos(angle) * STATUS_RADIUS, 0, Math.sin(angle) * STATUS_RADIUS]}>
      <sphereGeometry args={[0.19, 32, 32]} />
      <meshStandardMaterial ref={material} color={node.hex} emissive={node.hex} roughness={0.35} />
      <NodeNumber text={String(index + 1)} />
    </mesh>
  );
}

/**
 * The node number, drawn on a canvas texture and shown as a sprite. (drei's <Html>
 * mounts a separate React root per label, which React 19 warns about on unmount.)
 */
function NodeNumber({ text }: { text: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) {
      context.font = 'bold 40px Inter, system-ui, sans-serif';
      context.fillStyle = '#cbd5e1';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 32, 34);
    }
    return new CanvasTexture(canvas);
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={[0, 0.42, 0]} scale={[0.26, 0.26, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

function Tracer({ animate }: { animate: boolean }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (animate && group.current) group.current.rotation.y -= Math.min(delta, MAX_DELTA) * 0.9;
  });
  return (
    <group ref={group}>
      <mesh position={[STATUS_RADIUS, 0, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color="#e2fdf8" />
      </mesh>
    </group>
  );
}
