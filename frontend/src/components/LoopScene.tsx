import { Float, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, Mesh, MeshStandardMaterial } from 'three';

// The verification loop in 3D: one node per requirement on a ring, coloured by
// its status, with a tracer circling the loop. Loaded lazily (see LoopVisual).

export interface LoopNode {
  hex: string;
  pulsing: boolean;
}

interface Props {
  nodes: LoopNode[];
  /** Colour of the core — the overall verification state. */
  coreHex: string;
  animate: boolean;
}

const RADIUS = 2;

function Node({ node, index, total }: { node: LoopNode; index: number; total: number }) {
  const material = useRef<MeshStandardMaterial>(null);
  const mesh = useRef<Mesh>(null);
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;

  useFrame(({ clock }) => {
    if (!material.current || !mesh.current) return;
    const wave = node.pulsing ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5) : 0;
    material.current.emissiveIntensity = node.pulsing ? 0.5 + wave * 1.6 : 0.85;
    mesh.current.scale.setScalar(node.pulsing ? 1 + wave * 0.25 : 1);
  });

  return (
    <mesh ref={mesh} position={[Math.cos(angle) * RADIUS, 0, Math.sin(angle) * RADIUS]}>
      <sphereGeometry args={[0.19, 32, 32]} />
      <meshStandardMaterial ref={material} color={node.hex} emissive={node.hex} roughness={0.35} />
      <Html center position={[0, 0.42, 0]} className="pointer-events-none select-none">
        <span className="text-[10px] leading-none font-bold text-slate-300">{index + 1}</span>
      </Html>
    </mesh>
  );
}

function Tracer({ animate }: { animate: boolean }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (animate && group.current) group.current.rotation.y -= delta * 0.9;
  });
  return (
    <group ref={group}>
      <mesh position={[RADIUS, 0, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color="#e2fdf8" />
      </mesh>
    </group>
  );
}

export default function LoopScene({ nodes, coreHex, animate }: Props) {
  return (
    <Canvas camera={{ position: [0, 2.6, 5.2], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.6} />
      <pointLight position={[4, 6, 4]} intensity={60} />
      <pointLight position={[-5, -2, -4]} intensity={25} color="#5eead4" />

      <group rotation={[0.12, 0, 0.06]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[RADIUS, 0.018, 12, 160]} />
          <meshBasicMaterial color="#3b4a69" />
        </mesh>
        <Tracer animate={animate} />
        {nodes.map((node, index) => (
          <Node key={index} node={node} index={index} total={nodes.length} />
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
    </Canvas>
  );
}
