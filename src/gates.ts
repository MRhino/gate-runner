import * as THREE from 'three';

// Gates: two archways side by side, each with metal pylons, a glowing header showing its value,
// and a shimmering energy field. Blue adds squad members, red takes them away.
// Walking through one makes the field flare and ripple outward; the other side powers down.

const GOOD = { field: new THREE.Color(0x2a9dff), edge: new THREE.Color(0x8fe3ff), css: '#7fd8ff', bg: '#0b3a6e' };
const BAD = { field: new THREE.Color(0xff2a4a), edge: new THREE.Color(0xff9aa8), css: '#ff8d9c', bg: '#6e0b1e' };

const fieldVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Edge glow + rising scanlines + drifting hex shimmer + a flare/ripple when passed through.
const fieldFrag = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uEdge; uniform float uTime; uniform float uFlare; uniform float uFade; uniform vec2 uHit;
  varying vec2 vUv;
  float hex(vec2 p) {
    p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5;
    p = abs(fract(p) - 0.5);
    return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
  }
  void main() {
    vec2 uv = vUv;
    float edge = pow(max(abs(uv.x - 0.5), abs(uv.y - 0.5) * 0.9) * 2.0, 6.0);
    float scan = 0.5 + 0.5 * sin(uv.y * 90.0 - uTime * 8.0);
    float bands = smoothstep(0.85, 1.0, sin(uv.y * 6.0 - uTime * 2.5));
    float h = smoothstep(0.08, 0.0, hex(uv * vec2(6.0, 9.0) + vec2(0.0, uTime * 0.3)));
    float d = distance(uv, uHit);
    float ripple = uFlare * smoothstep(0.08, 0.0, abs(d - (1.0 - uFlare) * 1.2));
    float a = 0.16 + edge * 0.7 + scan * 0.06 + bands * 0.12 + h * 0.12 + ripple * 0.9 + uFlare * 0.35;
    vec3 col = mix(uColor, uEdge, clamp(edge + ripple + h * 0.4, 0.0, 1.0));
    gl_FragColor = vec4(col * (1.0 + uFlare * 1.5), a * uFade);
  }
`;

function headerTexture(text: string, good: boolean) {
  const pal = good ? GOOD : BAD;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, pal.bg); grad.addColorStop(1, '#05060c');
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(6, 6, 500, 148, 24); g.fill();
  g.lineWidth = 6; g.strokeStyle = pal.css; g.stroke();
  // Person icon + value, e.g. "👤 +2" drawn as a simple glyph so it renders everywhere.
  g.fillStyle = pal.css;
  const ix = 150, iy = 80;
  g.beginPath(); g.arc(ix, iy - 22, 16, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.roundRect(ix - 24, iy, 48, 36, 14); g.fill();
  g.font = '900 104px system-ui, sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.shadowColor = pal.css; g.shadowBlur = 24;
  g.fillStyle = '#ffffff';
  g.fillText(text, 196, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const pylonGeo = new THREE.BoxGeometry(0.28, 2.9, 0.38);
const capGeo = new THREE.BoxGeometry(0.42, 0.18, 0.5);
const stripGeo = new THREE.BoxGeometry(0.06, 2.4, 0.06);
const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3e, metalness: 0.75, roughness: 0.35 });

export type GateHalf = { group: THREE.Group; field: THREE.ShaderMaterial; strips: THREE.MeshBasicMaterial; header: THREE.Mesh; flare: number; fade: number; chosen: boolean };

export function createGateRow(scene: THREE.Scene, spans: [number, number][], labels: string[], good: boolean[]) {
  const root = new THREE.Group();
  scene.add(root);
  const halves: GateHalf[] = spans.map(([a, b], i) => {
    const pal = good[i] ? GOOD : BAD;
    const w = b - a - 0.1;
    const cx = (a + b) / 2;
    const group = new THREE.Group();
    group.position.x = cx;
    // Pylons with glowing inset strips and caps.
    const strips = new THREE.MeshBasicMaterial({ color: pal.edge.clone().multiplyScalar(1.8) });
    for (const s of [-1, 1]) {
      const px = s * (w / 2 - 0.1);
      const p = new THREE.Mesh(pylonGeo, metalMat);
      p.position.set(px, 1.45, 0);
      p.castShadow = true;
      const cap = new THREE.Mesh(capGeo, metalMat);
      cap.position.set(px, 2.95, 0);
      const st = new THREE.Mesh(stripGeo, strips);
      st.position.set(px - s * 0.14, 1.4, 0);
      group.add(p, cap, st);
    }
    // Energy field.
    const field = new THREE.ShaderMaterial({
      vertexShader: fieldVert, fragmentShader: fieldFrag, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: pal.field }, uEdge: { value: pal.edge }, uTime: { value: Math.random() * 10 },
        uFlare: { value: 0 }, uFade: { value: 1 }, uHit: { value: new THREE.Vector2(0.5, 0.3) },
      },
    });
    const fieldMesh = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, 2.5), field);
    fieldMesh.position.y = 1.35;
    group.add(fieldMesh);
    // Header plate with the value.
    const header = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(w + 0.1, 3.4), Math.min(w + 0.1, 3.4) * 0.31),
      new THREE.MeshBasicMaterial({ map: headerTexture(labels[i], good[i]), transparent: true, side: THREE.DoubleSide }),
    );
    header.position.set(0, 3.35, 0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.3), metalMat);
    beam.position.y = 2.95;
    group.add(header, beam);
    root.add(group);
    return { group, field, strips, header, flare: 0, fade: 1, chosen: false };
  });

  return {
    root,
    halves,
    setZ(z: number) { root.position.z = z; },
    // Called when the player crosses: the chosen side flares and ripples from where you hit it.
    pass(index: number, hitU: number) {
      halves.forEach((h, i) => {
        if (i === index) { h.chosen = true; h.flare = 1; h.field.uniforms.uHit.value.set(hitU, 0.3); }
        else h.fade = 0.999; // starts powering down
      });
    },
    update(dt: number, t: number) {
      for (const h of halves) {
        h.field.uniforms.uTime.value = t;
        h.flare = Math.max(0, h.flare - dt * 1.6);
        if (h.fade < 1) h.fade = Math.max(0.15, h.fade - dt * 2.5);
        if (h.chosen) h.fade = Math.max(0.35, 1 - (1 - h.flare) * 0.65);
        h.field.uniforms.uFlare.value = h.flare;
        h.field.uniforms.uFade.value = h.fade;
        // Header bobs gently and pops when chosen.
        h.header.position.y = 3.35 + Math.sin(t * 2 + h.group.position.x) * 0.05;
        h.header.scale.setScalar(1 + h.flare * 0.35);
      }
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (m.geometry !== pylonGeo && m.geometry !== capGeo && m.geometry !== stripGeo) m.geometry.dispose();
        const mat = m.material as THREE.Material & { map?: THREE.Texture };
        if (mat !== metalMat) { mat.map?.dispose(); mat.dispose(); }
      });
    },
  };
}
export type GateRowVisual = ReturnType<typeof createGateRow>;
