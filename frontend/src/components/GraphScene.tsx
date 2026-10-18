import { Billboard } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  type Group,
  MathUtils,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SpriteMaterial,
  Vector3,
} from 'three';
import { type EvidenceIcon, type GraphEvidence, type GraphRequirement, ringLayout, type VerificationGraph } from '../lib/verificationGraph';
import { REQUIREMENT_STATUS } from './labels';
import { AMBER, iconTexture, MAX_DELTA, radialTexture } from './sceneKit';

// A work order's verification state in 3D, drawn from real data only: one node per
// requirement (outer ring, coloured by status), one per evidence file (inner ring), and a
// line wherever an observation ties evidence to a requirement. Nothing moves on its own
// except what the data says: ANALYZING nodes pulse, changed statuses fade to their new
// colour, new evidence flies in and its links fade up once the agent has used it.

export interface GraphHover {
  kind: 'requirement' | 'evidence';
  id: string;
  /** Anchor in canvas pixels. */
  x: number;
  y: number;
}

interface Props {
  graph: VerificationGraph;
  coreHex: string;
  animate: boolean;
  onHover: (hover: GraphHover | null) => void;
  onSelectRequirement: (id: string) => void;
  onOpenEvidence: (id: string) => void;
}

const REQUIREMENT_RADIUS = 2.4;
const EVIDENCE_RADIUS = 1.2;
const REQUIREMENT_SIZE = 0.2;
const EVIDENCE_SIZE = 0.16;
/** Drag limits: a slight turn, not a free orbit. */
const MAX_TURN = 0.8;
const MAX_TILT = 0.22;
/** Pointer travel (px) after which a press counts as a drag rather than a click. */
const CLICK_SLOP = 6;

/** Live node positions by id, written by the nodes and read by the links. */
type Positions = Map<string, Vector3>;

function ringPoint(angle: number, radius: number, target: Vector3) {
  return target.set(Math.sin(angle) * radius, 0, -Math.cos(angle) * radius);
}

export function GraphScene({ graph, coreHex, animate, onHover, onSelectRequirement, onOpenEvidence }: Props) {
  const invalidate = useThree((state) => state.invalidate);
  const group = useRef<Group>(null);
  const positions = useRef<Positions>(new Map());
  const colors = useRef(new Map<string, Color>());
  const arrived = useRef(new Set<string>());
  const dragged = useRef(0);
  // What was on screen when the scene opened appears in place; anything later flies in.
  const [initialEvidence] = useState(() => new Set(graph.evidence.map((e) => e.id)));
  const [initialLinks] = useState(() => new Set(graph.links.map(linkKey)));
  const textures = useMemo(
    () => Object.fromEntries((['photo', 'video', 'document', 'audio'] as const).map((k) => [k, iconTexture(k)])) as Record<EvidenceIcon, CanvasTexture>,
    [],
  );
  const glow = useMemo(() => radialTexture(), []);
  useEffect(
    () => () => {
      Object.values(textures).forEach((t) => t.dispose());
      glow.dispose();
    },
    [textures, glow],
  );

  // Under reduced motion frames are drawn on demand: draw one whenever the data changes.
  useEffect(() => invalidate(), [graph, coreHex, invalidate]);

  useDragTurn(group, animate, dragged);
  const requirementLayout = ringLayout(graph.requirements.length, REQUIREMENT_RADIUS, REQUIREMENT_SIZE);
  const evidenceLayout = ringLayout(graph.evidence.length, EVIDENCE_RADIUS, EVIDENCE_SIZE);
  const running = graph.requirements.some((r) => r.pulsing);

  const interaction = {
    onHover,
    clicked: (action: () => void) => () => {
      if (dragged.current <= CLICK_SLOP) action();
    },
  };

  return (
    <>
      <GraphCamera />
      <ambientLight intensity={0.6} />
      <pointLight position={[4, 6, 4]} intensity={60} />
      <pointLight position={[-5, -2, -4]} intensity={25} color="#5eead4" />

      <group ref={group}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[REQUIREMENT_RADIUS, 0.012, 8, 192]} />
          <meshBasicMaterial color="#3b4a69" />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[EVIDENCE_RADIUS, 0.006, 8, 128]} />
          <meshBasicMaterial color="#2a3550" />
        </mesh>
        <Core hex={coreHex} spinning={animate && running} />

        <Links
          graph={graph}
          positions={positions}
          colors={colors}
          arrived={arrived}
          initialLinks={initialLinks}
          animate={animate}
        />
        {graph.requirements.map((requirement, index) => (
          <RequirementNode
            key={requirement.id}
            node={requirement}
            angle={requirementLayout.angle(index)}
            size={requirementLayout.size}
            animate={animate}
            glow={glow}
            positions={positions}
            colors={colors}
            onHover={interaction.onHover}
            onClick={interaction.clicked(() => onSelectRequirement(requirement.id))}
          />
        ))}
        {graph.evidence.map((item, index) => (
          <EvidenceNode
            key={item.id}
            item={item}
            angle={evidenceLayout.angle(index)}
            size={evidenceLayout.size}
            flyIn={!initialEvidence.has(item.id)}
            animate={animate}
            texture={textures[item.icon]}
            positions={positions}
            arrived={arrived}
            onHover={interaction.onHover}
            onClick={interaction.clicked(() => onOpenEvidence(item.id))}
          />
        ))}
      </group>
    </>
  );
}

function linkKey(link: { evidenceId: string; requirementId: string }) {
  return `${link.evidenceId}|${link.requirementId}`;
}

/** Frames the rings for the canvas shape: narrow canvases step back. */
function GraphCamera() {
  useFrame(({ camera, size }) => {
    const aspect = size.width / Math.max(size.height, 1);
    const distance = aspect < 0.9 ? 13.4 : aspect < 1.3 ? 11.2 : aspect < 1.8 ? 9.8 : 9.2;
    camera.position.set(0, distance * 0.68, distance * 0.73);
    camera.lookAt(0, -0.45, 0);
  });
  return null;
}

/**
 * Drag turns the graph a little (and, with a mouse, tilts it). Listeners are on the canvas
 * with touch-action: pan-y, so a vertical swipe still scrolls the page on touch screens.
 */
function useDragTurn(group: RefObject<Group | null>, animate: boolean, dragged: RefObject<number>) {
  const { gl, invalidate } = useThree();
  const goal = useRef({ turn: 0, tilt: 0 });

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = 'pan-y';
    let start: { x: number; y: number; turn: number; tilt: number; mouse: boolean } | null = null;
    const onDown = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY, ...goal.current, mouse: event.pointerType === 'mouse' };
      dragged.current = 0;
    };
    const onMove = (event: PointerEvent) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      dragged.current = Math.max(dragged.current, Math.hypot(dx, dy));
      goal.current.turn = MathUtils.clamp(start.turn + dx * 0.008, -MAX_TURN, MAX_TURN);
      if (start.mouse) goal.current.tilt = MathUtils.clamp(start.tilt + dy * 0.004, -MAX_TILT, MAX_TILT);
      invalidate();
    };
    const onUp = () => (start = null);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gl, invalidate, dragged]);

  useFrame((_, rawDelta) => {
    const g = group.current;
    if (!g) return;
    const delta = Math.min(rawDelta, MAX_DELTA);
    const ease = (from: number, to: number) => (animate ? MathUtils.damp(from, to, 10, delta) : to);
    g.rotation.y = ease(g.rotation.y, goal.current.turn);
    g.rotation.x = ease(g.rotation.x, goal.current.tilt);
  });
}

/** Shared pointer handling: tooltip anchored `lift` above the node, pointer cursor. */
function useNodePointer(kind: GraphHover['kind'], id: string, lift: number, onHover: Props['onHover'], onClick: () => void) {
  const { camera, size, gl } = useThree();
  const anchor = useMemo(() => new Vector3(), []);
  return {
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      (event.eventObject as Object3D).getWorldPosition(anchor);
      anchor.y += lift;
      anchor.project(camera);
      onHover({ kind, id, x: (anchor.x * 0.5 + 0.5) * size.width, y: (-anchor.y * 0.5 + 0.5) * size.height });
      gl.domElement.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      onHover(null);
      gl.domElement.style.cursor = '';
    },
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onHover(null); // the page is about to scroll or open the viewer
      onClick();
    },
  };
}

function RequirementNode({
  node,
  angle,
  size,
  animate,
  glow,
  positions,
  colors,
  onHover,
  onClick,
}: {
  node: GraphRequirement;
  angle: number;
  size: number;
  animate: boolean;
  glow: CanvasTexture;
  positions: RefObject<Positions>;
  colors: RefObject<Map<string, Color>>;
  onHover: Props['onHover'];
  onClick: () => void;
}) {
  const group = useRef<Group>(null);
  const ball = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const halo = useRef<SpriteMaterial>(null);
  const marker = useRef<Mesh>(null);
  const goal = useMemo(() => new Color(REQUIREMENT_STATUS[node.status].hex), [node.status]);
  const [state] = useState(() => ({ color: goal.clone(), position: ringPoint(angle, REQUIREMENT_RADIUS, new Vector3()) }));
  const target = useMemo(() => ringPoint(angle, REQUIREMENT_RADIUS, new Vector3()), [angle]);
  const pointer = useNodePointer('requirement', node.id, size + 0.3, onHover, onClick);
  const { id } = node;

  useEffect(() => {
    const livePositions = positions.current;
    const liveColors = colors.current;
    livePositions.set(id, state.position);
    liveColors.set(id, state.color);
    return () => {
      livePositions.delete(id);
      liveColors.delete(id);
    };
  }, [id, state, positions, colors]);

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);
    if (!group.current || !ball.current || !material.current || !halo.current) return;
    // A decision that arrives fades the node to its new colour; layout changes glide.
    state.color.lerp(goal, animate ? 1 - Math.exp(-3.5 * delta) : 1);
    state.position.lerp(target, animate ? 1 - Math.exp(-6 * delta) : 1);
    group.current.position.copy(state.position);

    const wave = node.pulsing && animate ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4.5) : 0;
    material.current.color.copy(state.color);
    material.current.emissive.copy(state.color);
    material.current.emissiveIntensity = node.pulsing ? 0.45 + wave * 1.3 : 0.6;
    ball.current.scale.setScalar(size * (1 + wave * 0.28));
    halo.current.color.copy(state.color);
    halo.current.opacity = node.pulsing ? 0.25 + wave * 0.5 : 0.32;
    if (marker.current && animate) marker.current.rotation.y += delta * 1.6;
  });

  // The number sits just outside the ring, so neighbours' labels never collide; the
  // open-request marker floats above the node.
  const label = ringPoint(angle, size + 0.26, new Vector3());

  return (
    <group ref={group}>
      <mesh ref={ball} {...pointer}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial ref={material} roughness={0.35} />
      </mesh>
      <sprite scale={[size * 5, size * 5, 1]}>
        <spriteMaterial ref={halo} map={glow} transparent depthWrite={false} blending={AdditiveBlending} />
      </sprite>
      <NodeNumber text={String(node.position)} position={[label.x, 0.06, label.z]} scale={Math.max(0.3, size * 1.7)} />
      {node.requested && (
        <mesh ref={marker} position={[0, size + 0.2, 0]}>
          <octahedronGeometry args={[Math.max(0.07, size * 0.5), 0]} />
          <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={0.9} />
        </mesh>
      )}
    </group>
  );
}

function EvidenceNode({
  item,
  angle,
  size,
  flyIn,
  animate,
  texture,
  positions,
  arrived,
  onHover,
  onClick,
}: {
  item: GraphEvidence;
  angle: number;
  size: number;
  flyIn: boolean;
  animate: boolean;
  texture: CanvasTexture;
  positions: RefObject<Positions>;
  arrived: RefObject<Set<string>>;
  onHover: Props['onHover'];
  onClick: () => void;
}) {
  const group = useRef<Group>(null);
  const target = useMemo(() => ringPoint(angle, EVIDENCE_RADIUS, new Vector3()), [angle]);
  // New evidence starts outside and above the rings and flies to its place.
  const [position] = useState(() => {
    const start = ringPoint(angle, EVIDENCE_RADIUS, new Vector3());
    return flyIn && animate ? start.multiplyScalar(3.4).setY(2.6) : start;
  });
  const pointer = useNodePointer('evidence', item.id, size, onHover, onClick);
  const { id } = item;

  useEffect(() => {
    const livePositions = positions.current;
    const liveArrived = arrived.current;
    livePositions.set(id, position);
    return () => {
      livePositions.delete(id);
      liveArrived.delete(id);
    };
  }, [id, position, positions, arrived]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);
    position.lerp(target, animate ? 1 - Math.exp(-3.2 * delta) : 1);
    if (position.distanceTo(target) < 0.05) arrived.current.add(id);
    group.current?.position.copy(position);
  });

  return (
    <group ref={group}>
      <Billboard>
        <mesh scale={size} {...pointer}>
          <circleGeometry args={[1, 32]} />
          <meshBasicMaterial color="#0b111c" />
        </mesh>
        <mesh scale={size}>
          <ringGeometry args={[0.86, 1, 40]} />
          <meshBasicMaterial color="#94a3b8" />
        </mesh>
        <mesh scale={size * 1.05} position={[0, 0, 0.002]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

/**
 * Evidence → requirement lines, one segment each, in the requirement's live colour:
 * bright for a direct observation, dim for an inference. New links fade up once their
 * evidence has landed.
 */
function Links({
  graph,
  positions,
  colors,
  arrived,
  initialLinks,
  animate,
}: {
  graph: VerificationGraph;
  positions: RefObject<Positions>;
  colors: RefObject<Map<string, Color>>;
  arrived: RefObject<Set<string>>;
  initialLinks: Set<string>;
  animate: boolean;
}) {
  const count = graph.links.length;
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(count, 1) * 6), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(Math.max(count, 1) * 6), 3));
    return g;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const fade = useRef(new Map<string, number>());

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, MAX_DELTA);
    const position = geometry.getAttribute('position') as BufferAttribute;
    const color = geometry.getAttribute('color') as BufferAttribute;
    graph.links.forEach((link, i) => {
      const from = positions.current.get(link.evidenceId);
      const to = positions.current.get(link.requirementId);
      const tint = colors.current.get(link.requirementId);
      const key = linkKey(link);
      let f = fade.current.get(key) ?? (initialLinks.has(key) || !animate ? 1 : 0);
      if (f < 1 && arrived.current.has(link.evidenceId)) f = Math.min(1, f + delta * 1.4);
      fade.current.set(key, f);
      if (!from || !to || !tint) {
        position.array.fill(0, i * 6, i * 6 + 6);
        return;
      }
      position.setXYZ(i * 2, from.x, from.y, from.z);
      position.setXYZ(i * 2 + 1, to.x, to.y, to.z);
      const strength = (link.direct ? 1.1 : 0.3) * f;
      color.setXYZ(i * 2, tint.r * strength * 0.7, tint.g * strength * 0.7, tint.b * strength * 0.7);
      color.setXYZ(i * 2 + 1, tint.r * strength, tint.g * strength, tint.b * strength);
    });
    geometry.setDrawRange(0, count * 2);
    position.needsUpdate = true;
    color.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </lineSegments>
  );
}

/** The work order's overall state at the centre; it turns while a run is in progress. */
function Core({ hex, spinning }: { hex: string; spinning: boolean }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (spinning && group.current) group.current.rotation.y += Math.min(delta, MAX_DELTA) * 0.8;
  });
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[0.46, 1]} />
        <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={0.5} wireframe />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={0.9} roughness={0.2} />
      </mesh>
    </group>
  );
}

/**
 * The requirement number, drawn on a canvas texture and shown as a sprite. (drei's <Html>
 * mounts a separate React root per label, which React 19 warns about on unmount.)
 */
function NodeNumber({ text, position, scale }: { text: string; position: [number, number, number]; scale: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.font = 'bold 80px Inter, system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      // A dark outline keeps the number legible over lines and glow.
      context.lineWidth = 14;
      context.lineJoin = 'round';
      context.strokeStyle = 'rgba(5,7,12,0.9)';
      context.strokeText(text, 64, 68);
      context.fillStyle = '#f1f5f9';
      context.fillText(text, 64, 68);
    }
    return new CanvasTexture(canvas);
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={[scale, scale, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}
