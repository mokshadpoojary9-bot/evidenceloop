import { Environment, Float, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AdditiveBlending,
  BackSide,
  Color,
  getConsoleFunction,
  type Group,
  type InstancedMesh,
  MathUtils,
  Matrix4,
  type Mesh,
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
import type { VerificationGraph } from '../lib/verificationGraph';
import { GraphScene, type GraphHover } from './GraphScene';
import { AMBER, BACKGROUND, iconTexture, MAX_DELTA, NV_GREEN, radialTexture, TAU } from './sceneKit';

// The evidence loop in 3D, loaded lazily by LoopVisual (which also decides when it may
// render at all). Two variants share the canvas setup and adaptive quality:
//   hero  — the landing page: evidence cards travelling through six stations.
//   graph — a work order: its requirements, evidence and links, live from real data.

interface Common {
  /** False under prefers-reduced-motion: nothing moves on its own. */
  animate: boolean;
  /** False while off-screen or the tab is hidden: no frames are rendered. */
  active: boolean;
  /** Accessible description of what the canvas shows. */
  label: string;
  /** The device measured too slow for 3D: switch to 2D for good. */
  onFallback: () => void;
  /** The WebGL context was lost (true) or restored (false). The scene stays mounted. */
  onContextChange: (lost: boolean) => void;
}

export type LoopSceneProps = Common &
  (
    | {
        variant: 'graph';
        graph: VerificationGraph;
        coreHex: string;
        onHover: (hover: GraphHover | null) => void;
        onSelectRequirement: (id: string) => void;
        onOpenEvidence: (id: string) => void;
      }
    | {
        variant: 'hero';
        motion: RefObject<HeroMotion>;
        activeStation: number;
        /** DOM labels, one per station, positioned over the canvas every frame. */
        labels: RefObject<(HTMLElement | null)[]>;
      }
  );


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
const QUALITY_STEPS = { hero: 3, graph: 1 } as const;
/** The lowest quality any scene reached this session; later scenes start there. */
let sessionQuality = 0;

export default function LoopScene(props: LoopSceneProps) {
  const { animate, active, label, onFallback, onContextChange } = props;
  const hero = props.variant === 'hero';
  const [quality, setQuality] = useState(() => Math.min(sessionQuality, QUALITY_STEPS[props.variant]));

  return (
    <Canvas
      dpr={quality >= 1 ? 1 : [1, 1.5]}
      frameloop={!active ? 'never' : animate ? 'always' : 'demand'}
      camera={hero ? { position: [0, 3.2, 9], fov: 38, near: 0.1, far: 60 } : { position: [0, 7, 7.5], fov: 30 }}
      gl={{ antialias: !hero, alpha: !hero, powerPreference: hero ? 'high-performance' : 'default' }}
      onCreated={({ gl }) => {
        // preventDefault() tells the browser we want the context back; three.js rebuilds
        // its GPU state on restore, so the same canvas simply resumes.
        gl.domElement.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          onContextChange(true);
        });
        gl.domElement.addEventListener('webglcontextrestored', () => onContextChange(false));
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
          onFallback={onFallback}
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
        <GraphScene
          graph={props.graph}
          coreHex={props.coreHex}
          animate={animate}
          onHover={props.onHover}
          onSelectRequirement={props.onSelectRequirement}
          onOpenEvidence={props.onOpenEvidence}
        />
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
