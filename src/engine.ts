import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LOOK_COLORS, type LookId, type Mode, type ShotId } from "./looks";

const DECK_R = 4;
const DECK_H = 1.2;
const RING_R = 5.05;
const RING_Y = 6.45;
const PORTAL_R = 11.15;
const PORTAL_A = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];
const STAIR_A = [Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4];

type ShotDef = {
  theta: number;
  phi: number;
  radius: number;
  target: [number, number, number];
  spin?: number;
};

const SHOT_DEF: Record<ShotId, ShotDef> = {
  platea: { theta: Math.PI, phi: 1.22, radius: 13.4, target: [0, 3.05, 1.4] },
  folla: { theta: Math.PI * 0.92, phi: 1.42, radius: 7.6, target: [0, 2.15, 2.2] },
  palco: { theta: Math.PI, phi: 1.46, radius: 8.4, target: [0, 2.15, 6.4] },
  anello: { theta: 0.55, phi: 0.72, radius: 10.5, target: [0, 2.4, 0] },
  drone: { theta: 0.4, phi: 0.86, radius: 24, target: [0, 2.2, 0], spin: 0.12 },
  sotto: { theta: 2.35, phi: 2.05, radius: 9.2, target: [0, 5.6, 1.2] },
};

const CINEMA: Array<ShotId | "spaccato"> = ["platea", "spaccato", "palco", "anello", "sotto", "drone", "folla"];

export type StageHooks = {
  onReady: (info: { crowd: number }) => void;
  onMode: (mode: Mode) => void;
  onShot: (id: ShotId) => void;
  onEnergy: (energy: number) => void;
};

export type StageHandle = {
  setLook: (id: LookId) => void;
  setShot: (id: ShotId) => void;
  setMode: (mode: Mode) => void;
  toggleAudio: () => Promise<boolean>;
  setMove: (x: number, y: number) => void;
  dispose: () => void;
};

const SIMPLE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LED_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const LED_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying float vDist;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uFlash;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform vec3 uArch;
  uniform vec3 uFog;

  float sdSeg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  float vDist2(vec2 p) {
    float l = sdSeg(p, vec2(-0.30, 0.48), vec2(0.0, -0.44));
    float r = sdSeg(p, vec2(0.30, 0.48), vec2(0.0, -0.44));
    return min(l, r);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float archAt(vec2 p, float ox) {
    vec2 q = p - vec2(ox, 0.02);
    float ax = abs(q.x);
    float cap = length(vec2(q.x * 1.05, max(q.y - 0.08, 0.0))) - 0.105;
    float d = cap;
    d = max(d, q.y - 0.46);
    d = max(d, -q.y - 0.42);
    d = max(d, ax - 0.105);
    float pane = smoothstep(0.025, -0.01, d);
    float lead = smoothstep(0.045, 0.01, abs(d));
    float mullion = smoothstep(0.012, 0.0, abs(q.x)) * pane;
    return pane * 0.72 + lead * 0.85 + mullion * 0.4;
  }

  float bolt(vec2 p, float y0, float speed, float scale) {
    float y = y0 + sin(p.x * 16.0 + uTime * speed) * 0.02 + sin(p.x * 42.0 - uTime * speed * 1.7) * 0.008;
    float d = abs(p.y - y);
    float line = smoothstep(0.014 * scale, 0.0, d);
    float brk = step(0.42, fract(p.x * 2.4 + uTime * 0.7 + y0 * 3.0));
    return line * brk;
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(0.96, 1.18);
    float vd = vDist2(p);
    float body = smoothstep(0.09, 0.025, vd);
    float core = smoothstep(0.028, 0.0, vd);
    float hot = smoothstep(0.012, 0.0, vd);

    float aL = archAt(p, -0.30);
    float aC = archAt(p, 0.0);
    float aR = archAt(p, 0.30);
    vec3 archCol = uArch * aC + mix(uArch, vec3(0.15, 0.28, 0.55), 0.55) * aL + mix(uArch, vec3(0.55, 0.08, 0.16), 0.35) * aR;

    float near = smoothstep(0.22, 0.02, vd);
    float bolts = bolt(p, 0.05, 8.0, 1.0) + bolt(p, -0.12, 11.0, 0.8) + bolt(p, 0.18, 6.0, 1.15);
    bolts *= near;
    bolts += uFlash * bolt(p, sin(uTime * 3.0) * 0.08, 18.0, 1.4) * 1.6;

    float n = noise(vec2(p.x * 6.0, p.y * 2.0 + uTime * 1.4));
    float sheen = smoothstep(0.55, 0.9, n) * body;

    vec3 col = vec3(0.012, 0.014, 0.02);
    col += archCol * 0.55;
    col += uEdge * body * (1.15 + uEnergy * 0.35);
    col += uCore * core * (1.6 + uEnergy * 0.9);
    col += vec3(1.0) * hot * (0.85 + uFlash);
    col += mix(uCore, vec3(1.0), 0.65) * bolts * (1.3 + uEnergy);
    col += uCore * sheen * 0.35;

    float scan = 0.86 + 0.14 * sin(vUv.y * 210.0);
    col *= scan;
    float pix = smoothstep(0.55, 0.95, fract(vUv.x * 120.0));
    col *= 1.0 - pix * 0.08;

    col *= smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
    col *= smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.97, vUv.y);

    float fogF = 1.0 - exp(-0.0045 * vDist);
    col = mix(col, uFog, clamp(fogF, 0.0, 0.55));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vView;
  uniform vec3 uColor;
  uniform float uIntensity;
  void main() {
    float ndv = abs(dot(normalize(vN), normalize(vView)));
    float core = pow(ndv, 1.35);
    float along = vUv.y;
    float lengthwise = mix(0.05, 1.0, pow(along, 0.55));
    float tip = smoothstep(0.0, 0.12, along);
    float brightness = core * lengthwise * tip * uIntensity;
    gl_FragColor = vec4(uColor, brightness);
  }
`;

const SKIRT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uA;
  uniform vec3 uB;
  void main() {
    float seg = fract(vUv.x * 42.0 - uTime * 0.35);
    float on = smoothstep(0.08, 0.16, seg) * smoothstep(0.62, 0.48, seg);
    float band = smoothstep(0.08, 0.2, vUv.y) * smoothstep(0.92, 0.78, vUv.y);
    float pick = step(0.5, fract(vUv.x * 6.0 + uTime * 0.15));
    vec3 col = mix(uA, uB, pick);
    float bolt = smoothstep(0.62, 0.92, fract(vUv.x * 8.0 + uTime * 1.4 + vUv.y));
    col = mix(col, vec3(1.0), bolt * 0.65);
    float pulse = 0.45 + 0.55 * uEnergy;
    gl_FragColor = vec4(col * on * band * (1.4 + pulse), 1.0);
  }
`;

const BOOTH_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  void main() {
    float y = abs(vUv.y - 0.5);
    float band = smoothstep(0.42, 0.28, y);
    float x = vUv.x * 6.2832;
    float wave = sin(x * 3.0 - uTime * 6.0) * 0.5 + 0.5;
    float streak = smoothstep(0.72, 1.0, wave);
    vec3 col = mix(uEdge, uCore, streak) * band;
    col += vec3(1.0) * streak * band * (0.35 + uEnergy);
    float logo = smoothstep(0.08, 0.02, length(vec2(fract(vUv.x) - 0.5, vUv.y - 0.5) * vec2(1.0, 2.2)));
    col += uCore * logo * 0.4;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vP;
  uniform vec3 uTop;
  uniform vec3 uBot;
  void main() {
    vec3 n = normalize(vP);
    float h = clamp(n.y, 0.0, 1.0);
    vec3 col = mix(uBot, uTop, pow(h, 0.65));
    float s = fract(sin(dot(n.xy, vec2(127.1, 311.7))) * 43758.5);
    col += vec3(s) * step(0.992, s) * h * 0.7;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vP;
  void main() {
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function wrapAng(d: number) {
  const t = Math.PI * 2;
  let x = ((d % t) + t) % t;
  if (x > Math.PI) x -= t;
  return x;
}

function makePerson() {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  };
  const head = new THREE.SphereGeometry(0.12, 8, 6);
  head.translate(0, 1.42, 0);
  const merged = mergeGeometries([
    box(0.11, 0.72, 0.13, -0.08, 0.36, 0),
    box(0.11, 0.72, 0.13, 0.08, 0.36, 0),
    box(0.34, 0.52, 0.18, 0, 0.96, 0),
    box(0.09, 0.46, 0.1, -0.22, 0.98, 0),
    box(0.09, 0.46, 0.1, 0.22, 0.98, 0),
    head,
  ]);
  if (!merged) throw new Error("person");
  return merged;
}

function wordTexture() {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 512;
  const g = c.getContext("2d");
  if (!g) throw new Error("2d");
  const draw = () => {
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 18;
    g.strokeRect(36, 78, c.width - 72, c.height - 156);
    g.font = "600 280px Oswald, sans-serif";
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("VOLTAGE", c.width / 2, c.height / 2 + 8);
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  document.fonts?.ready.then(() => {
    draw();
    tex.needsUpdate = true;
  });
  return tex;
}

function floorTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d");
  if (!g) throw new Error("2d");
  g.fillStyle = "#0c0e13";
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = "rgba(190,210,230,0.045)";
  g.lineWidth = 2;
  for (let r = 48; r < 500; r += 34) {
    g.beginPath();
    g.arc(512, 512, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    g.beginPath();
    g.moveTo(512, 512);
    g.lineTo(512 + Math.cos(a) * 500, 512 + Math.sin(a) * 500);
    g.stroke();
  }
  const img = g.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 16) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] = Math.max(0, img.data[i]! + n);
    img.data[i + 1] = Math.max(0, img.data[i + 1]! + n);
    img.data[i + 2] = Math.max(0, img.data[i + 2]! + n);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function dustTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) throw new Error("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

class ShowClick {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private data = new Uint8Array(128);
  private next = 0;
  private step = 0;
  playing = false;

  private ensure() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
  }

  async toggle() {
    this.ensure();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") await ctx.resume();
    this.playing = !this.playing;
    const now = ctx.currentTime;
    this.master!.gain.cancelScheduledValues(now);
    this.master!.gain.setTargetAtTime(this.playing ? 0.42 : 0, now, 0.05);
    if (this.playing) this.next = now + 0.05;
    return this.playing;
  }

  level() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteFrequencyData(this.data);
    let low = 0;
    for (let i = 1; i < 7; i++) low += this.data[i] ?? 0;
    return low / (6 * 255);
  }

  tick() {
    if (!this.playing || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const eighth = 60 / 138 / 2;
    while (this.next < ctx.currentTime + 0.12) {
      const t = this.next;
      const s = this.step;
      this.kick(t);
      if (s % 2 === 1) this.bass(t);
      if (s % 2 === 0) this.hat(t);
      if (s % 4 === 2) this.stab(t, s);
      this.step = (s + 1) % 16;
      this.next += eighth;
    }
  }

  private env(t: number, a: number, d: number, peak: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(this.master!);
    return g;
  }

  private kick(t: number) {
    const o = this.ctx!.createOscillator();
    const g = this.env(t, 0.005, 0.18, 0.95);
    o.type = "sine";
    o.frequency.setValueAtTime(148, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.22);
  }

  private bass(t: number) {
    const o = this.ctx!.createOscillator();
    const f = this.ctx!.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 240;
    const g = this.env(t, 0.01, 0.16, 0.28);
    o.type = "sawtooth";
    o.frequency.value = 55;
    o.connect(f);
    f.connect(g);
    o.start(t);
    o.stop(t + 0.2);
  }

  private hat(t: number) {
    const len = 0.04;
    const buf = this.ctx!.createBuffer(1, Math.floor(this.ctx!.sampleRate * len), this.ctx!.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    const f = this.ctx!.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6000;
    const g = this.env(t, 0.002, 0.04, 0.18);
    src.connect(f);
    f.connect(g);
    src.start(t);
  }

  private stab(t: number, step: number) {
    const notes = [220, 261.6, 329.6, 392];
    const o = this.ctx!.createOscillator();
    const f = this.ctx!.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.18);
    const g = this.env(t, 0.005, 0.2, 0.12);
    o.type = "sawtooth";
    o.frequency.value = notes[Math.floor(step / 4) % notes.length]!;
    o.connect(f);
    f.connect(g);
    o.start(t);
    o.stop(t + 0.24);
  }

  dispose() {
    void this.ctx?.close();
  }
}

function strut(ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number) {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = Math.max(0.001, dir.length());
  const geo = new THREE.CylinderGeometry(radius, radius, len, 5, 1);
  const mid = new THREE.Vector3(ax + bx, ay + by, az + bz).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
  geo.applyQuaternion(q);
  geo.translate(mid.x, mid.y, mid.z);
  return geo;
}

export function mountAnello(canvas: HTMLCanvasElement, hooks: StageHooks): StageHandle {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = window.matchMedia("(max-width: 800px)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(0x07080c, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#07080c");
  scene.fog = new THREE.FogExp2("#07080c", 0.016);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.08, 160);
  camera.rotation.order = "YXZ";

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color("#10182c") },
      uBot: { value: new THREE.Color("#07080c") },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(90, 28, 16), skyMat));

  const metal = new THREE.MeshStandardMaterial({
    color: "#a7b0ba",
    metalness: 0.92,
    roughness: 0.34,
  });
  const black = new THREE.MeshStandardMaterial({
    color: "#12141a",
    metalness: 0.55,
    roughness: 0.46,
  });
  const stone = new THREE.MeshStandardMaterial({
    color: "#1a1d24",
    metalness: 0.04,
    roughness: 0.94,
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: "#141820",
    metalness: 0.45,
    roughness: 0.42,
  });

  const ground = new THREE.Mesh(new THREE.CircleGeometry(21, 72), new THREE.MeshStandardMaterial({
    color: "#101218",
    map: floorTexture(),
    roughness: 0.86,
    metalness: 0.08,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ao = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 48),
    new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.45, depthWrite: false }),
  );
  ao.rotation.x = -Math.PI / 2;
  ao.position.y = 0.015;
  scene.add(ao);

  const bays = 14;
  const wallR = 18.2;
  for (let i = 0; i < bays; i++) {
    const a = (i / bays) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * wallR, 0, Math.cos(a) * wallR);
    g.lookAt(0, 0, 0);
    const tower = i % 7 === 0;
    const h = tower ? 11.5 : 6.8;
    const pillarH = tower ? h : 4.4;
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.42, pillarH, 0.55), stone);
    left.position.set(-1.15, pillarH / 2, 0);
    left.castShadow = true;
    left.receiveShadow = true;
    const right = left.clone();
    right.position.x = 1.15;
    g.add(left, right);
    if (!tower) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 8, 18, Math.PI), stone);
      arch.position.set(0, 4.35, 0);
      arch.rotation.z = Math.PI;
      arch.rotation.y = Math.PI;
      arch.castShadow = true;
      g.add(arch);
    } else {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.45, 0.7), stone);
      cap.position.y = h - 0.3;
      cap.castShadow = true;
      g.add(cap);
      const slit = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, 1.4),
        new THREE.MeshBasicMaterial({ color: "#ffb080" }),
      );
      slit.position.set(0, 6.2, 0.36);
      g.add(slit);
    }
    scene.add(g);
  }

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R, DECK_R + 0.08, DECK_H, 72), deckMat);
  deck.position.y = DECK_H / 2;
  deck.castShadow = true;
  deck.receiveShadow = true;
  scene.add(deck);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(DECK_R + 0.02, 0.04, 8, 72), metal);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = DECK_H;
  lip.castShadow = true;
  scene.add(lip);

  for (const a of STAIR_A) {
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const r = DECK_R + 1.45 - s * 0.38;
      const h = ((s + 1) / steps) * DECK_H;
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.35, h, 0.42), deckMat);
      step.position.set(Math.sin(a) * r, h / 2, Math.cos(a) * r);
      step.rotation.y = -a;
      step.castShadow = true;
      step.receiveShadow = true;
      scene.add(step);
    }
  }

  const skirtUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uA: { value: new THREE.Color("#ff2944") },
    uB: { value: new THREE.Color("#c6f2ff") },
  };
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_R + 0.09, DECK_R + 0.09, 0.78, 80, 1, true),
    new THREE.ShaderMaterial({
      uniforms: skirtUniforms,
      vertexShader: SIMPLE_VERT,
      fragmentShader: SKIRT_FRAG,
      side: THREE.DoubleSide,
    }),
  );
  skirt.position.y = 0.72;
  scene.add(skirt);

  const pit = new THREE.Mesh(
    new THREE.TorusGeometry(5.55, 0.035, 8, 90),
    new THREE.MeshBasicMaterial({ color: "#8ee7ff" }),
  );
  pit.rotation.x = Math.PI / 2;
  pit.position.y = 0.03;
  scene.add(pit);

  const booth = new THREE.Group();
  const boothBody = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.32, 0.92, 10), black);
  boothBody.position.y = DECK_H + 0.46;
  boothBody.castShadow = true;
  booth.add(boothBody);
  const boothLedUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uCore: { value: new THREE.Color("#e7f6ff") },
    uEdge: { value: new THREE.Color("#3c7dff") },
  };
  const boothLed = new THREE.Mesh(
    new THREE.CylinderGeometry(1.34, 1.34, 0.42, 24, 1, true),
    new THREE.ShaderMaterial({
      uniforms: boothLedUniforms,
      vertexShader: SIMPLE_VERT,
      fragmentShader: BOOTH_FRAG,
      side: THREE.DoubleSide,
    }),
  );
  boothLed.position.y = DECK_H + 0.48;
  booth.add(boothLed);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.28, 0.06, 10), deckMat);
  top.position.y = DECK_H + 0.95;
  booth.add(top);
  for (const x of [-0.46, 0.46]) {
    const deckCdj = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.32), black);
    deckCdj.position.set(x, DECK_H + 1.0, 0.15);
    booth.add(deckCdj);
    const jog = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 20),
      new THREE.MeshBasicMaterial({ color: "#9fdfff" }),
    );
    jog.rotation.x = -Math.PI / 2;
    jog.position.set(x, DECK_H + 1.04, 0.15);
    jog.name = "jog";
    booth.add(jog);
  }
  const mixer = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.28), black);
  mixer.position.set(0, DECK_H + 1.01, -0.05);
  booth.add(mixer);
  scene.add(booth);

  const dj = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: "#0e1014", roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: "#c9a38a", roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.42, 4, 8), cloth);
  torso.position.y = DECK_H + 1.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
  head.position.y = DECK_H + 2.05;
  const phones = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 14), black);
  phones.position.y = DECK_H + 2.08;
  phones.rotation.x = Math.PI / 2;
  dj.add(torso, head, phones);
  scene.add(dj);

  const ringRoot = new THREE.Group();
  scene.add(ringRoot);
  addRing(ringRoot, RING_R, RING_Y, metal);
  addRing(ringRoot, PORTAL_R, 7.55, metal);

  const postGeos: THREE.BufferGeometry[] = [];
  for (const a of PORTAL_A) {
    const s = 0.16;
    const corners = [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
    ];
    const y0 = DECK_H;
    const y1 = RING_Y;
    const r0 = DECK_R + 0.2;
    const r1 = RING_R;
    for (const [ox, oz] of corners) {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      postGeos.push(
        strut(
          sa * r0 + ox * ca,
          y0,
          ca * r0 - ox * sa,
          sa * r1 + ox * ca,
          y1,
          ca * r1 - ox * sa,
          0.03,
        ),
      );
    }
  }
  const posts = new THREE.Mesh(mergeGeometries(postGeos)!, metal);
  posts.castShadow = true;
  scene.add(posts);

  const ledUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uFlash: { value: 0 },
    uCore: { value: new THREE.Color("#e7f6ff") },
    uEdge: { value: new THREE.Color("#3c7dff") },
    uArch: { value: new THREE.Color("#a01840") },
    uFog: { value: new THREE.Color("#070910") },
  };
  const ledMat = new THREE.ShaderMaterial({
    uniforms: ledUniforms,
    vertexShader: LED_VERT,
    fragmentShader: LED_FRAG,
  });
  const beamUniforms = {
    uColor: { value: new THREE.Color("#eaf4ff") },
    uIntensity: { value: 1 },
  };
  const beamMat = new THREE.ShaderMaterial({
    uniforms: beamUniforms,
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const moverUniforms = {
    uColor: { value: new THREE.Color("#3c7dff") },
    uIntensity: { value: 1 },
  };
  const moverMat = new THREE.ShaderMaterial({
    uniforms: moverUniforms,
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.CylinderGeometry(0.03, 0.18, 1, 7, 1, true);
  beamGeo.translate(0, -0.5, 0);
  const moverGeo = new THREE.CylinderGeometry(0.018, 0.07, 1, 6, 1, true);
  moverGeo.translate(0, -0.5, 0);

  const barMatA = new THREE.MeshStandardMaterial({
    color: "#0c0e12",
    emissive: "#ff2944",
    emissiveIntensity: 1.4,
    roughness: 0.35,
    metalness: 0.2,
  });
  const barMatB = barMatA.clone();
  barMatB.emissive = new THREE.Color("#c6f2ff");
  const blinderMat = new THREE.MeshStandardMaterial({
    color: "#1a1c20",
    emissive: "#fff4e8",
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const wordMap = wordTexture();
  const wordMat = new THREE.MeshBasicMaterial({
    map: wordMap,
    transparent: true,
    alphaTest: 0.15,
    color: "#e7f6ff",
    side: THREE.DoubleSide,
  });

  const heads: { yoke: THREE.Group; head: THREE.Group; base: number }[] = [];
  const barCount = mobile ? 6 : 8;

  for (const a of PORTAL_A) {
    const portal = new THREE.Group();
    portal.position.set(Math.sin(a) * PORTAL_R, 0, Math.cos(a) * PORTAL_R);
    portal.lookAt(0, 0, 0);
    const hw = 2.35;
    const y0 = 1.55;
    const y1 = 6.55;
    const frame: THREE.BufferGeometry[] = [];
    const z = 0;
    const t = 0.07;
    frame.push(strut(-hw, y0, z, hw, y0, z, t));
    frame.push(strut(-hw, y1, z, hw, y1, z, t));
    frame.push(strut(-hw, y0, z, -hw, y1, z, t));
    frame.push(strut(hw, y0, z, hw, y1, z, t));
    frame.push(strut(-hw, y0, -0.28, hw, y0, -0.28, t * 0.8));
    frame.push(strut(-hw, y1, -0.28, hw, y1, -0.28, t * 0.8));
    frame.push(strut(-hw, y0, -0.28, -hw, y1, -0.28, t * 0.8));
    frame.push(strut(hw, y0, -0.28, hw, y1, -0.28, t * 0.8));
    frame.push(strut(-hw, y0, z, -hw, y0, -0.28, t * 0.7));
    frame.push(strut(hw, y0, z, hw, y0, -0.28, t * 0.7));
    frame.push(strut(-hw, y1, z, -hw, y1, -0.28, t * 0.7));
    frame.push(strut(hw, y1, z, hw, y1, -0.28, t * 0.7));
    const diagN = 4;
    for (let i = 0; i < diagN; i++) {
      const yA = y0 + ((y1 - y0) * i) / diagN;
      const yB = y0 + ((y1 - y0) * (i + 1)) / diagN;
      frame.push(strut(-hw, yA, z, -hw, yB, -0.28, 0.035));
      frame.push(strut(hw, yB, z, hw, yA, -0.28, 0.035));
    }
    const frameMesh = new THREE.Mesh(mergeGeometries(frame)!, metal);
    frameMesh.castShadow = true;
    portal.add(frameMesh);

    const ledTop = y1 - 1.05;
    const ledBottom = y0 + 0.2;
    const ledH = ledTop - ledBottom;
    const led = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.28, ledH), ledMat);
    led.position.set(0, (ledTop + ledBottom) / 2, 0.12);
    portal.add(led);
    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.1, ledH + 0.16), black);
    bezel.position.set(0, (ledTop + ledBottom) / 2, 0.04);
    portal.add(bezel);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.72), wordMat);
    sign.position.set(0, y1 - 0.48, 0.18);
    portal.add(sign);

    const bx = hw + 0.82;
    const wing: THREE.BufferGeometry[] = [
      strut(bx, y0, 0.12, bx, y1, 0.12, 0.045),
      strut(-bx, y0, 0.12, -bx, y1, 0.12, 0.045),
      strut(hw, y1, 0, bx, y1, 0.12, 0.04),
      strut(-hw, y1, 0, -bx, y1, 0.12, 0.04),
      strut(hw, y0, 0, bx, y0, 0.12, 0.04),
      strut(-hw, y0, 0, -bx, y0, 0.12, 0.04),
    ];
    const wingMesh = new THREE.Mesh(mergeGeometries(wing)!, metal);
    wingMesh.castShadow = true;
    portal.add(wingMesh);

    const barGeo = new RoundedBoxGeometry(1.28, 0.3, 0.14, 2, 0.07);
    const span = y1 - y0 - 0.8;
    for (let i = 0; i < barCount; i++) {
      const y = y0 + 0.45 + (span * i) / Math.max(1, barCount - 1);
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(barGeo, i % 2 === 0 ? barMatA : barMatB);
        bar.position.set(side * (hw + 0.78), y, 0.16);
        portal.add(bar);
      }
    }
    for (let i = 0; i < 6; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.12), blinderMat);
      bl.position.set(-1.25 + i * 0.5, y1 - 0.28, 0.22);
      portal.add(bl);
    }
    for (let i = 0; i < (mobile ? 3 : 5); i++) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      const x = -1.6 + i * 0.8;
      beam.position.set(x, y1 - 0.05, 0.7);
      beam.scale.y = 5.15;
      portal.add(beam);
    }
    scene.add(portal);
  }

  const down = new THREE.Vector3(0, -1, 0);
  const staticBeams = mobile ? 10 : 16;
  for (let i = 0; i < staticBeams; i++) {
    const a = (i / staticBeams) * Math.PI * 2;
    const origin = new THREE.Vector3(Math.sin(a) * (RING_R - 0.05), RING_Y - 0.15, Math.cos(a) * (RING_R - 0.05));
    const target = new THREE.Vector3(Math.sin(a) * 1.6, DECK_H + 0.05, Math.cos(a) * 1.6);
    const dir = target.clone().sub(origin);
    const len = dir.length();
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(origin);
    beam.quaternion.setFromUnitVectors(down, dir.normalize());
    beam.scale.y = len;
    scene.add(beam);
  }

  const moverCount = mobile ? 6 : 10;
  for (let i = 0; i < moverCount; i++) {
    const a = (i / moverCount) * Math.PI * 2 + 0.2;
    const fixture = new THREE.Group();
    fixture.position.set(Math.sin(a) * RING_R, RING_Y - 0.28, Math.cos(a) * RING_R);
    const yoke = new THREE.Group();
    const head = new THREE.Group();
    yoke.add(head);
    fixture.add(yoke);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.28), black);
    head.add(housing);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    lens.position.y = -0.1;
    lens.name = "lens";
    head.add(lens);
    const beam = new THREE.Mesh(moverGeo, moverMat);
    beam.position.y = -0.1;
    beam.scale.y = 6.2;
    head.add(beam);
    scene.add(fixture);
    heads.push({ yoke, head, base: a });
  }

  const crowdN = mobile ? 320 : 680;
  const person = makePerson();
  const crowdMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.86, metalness: 0.02 });
  const crowd = new THREE.InstancedMesh(person, crowdMat, crowdN);
  crowd.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const phases = new Float32Array(crowdN);
  const radii = new Float32Array(crowdN);
  const angs = new Float32Array(crowdN);
  const scales = new Float32Array(crowdN);
  const palette = [0x14161c, 0x1c2028, 0x241c20, 0x10141c, 0x2a3038, 0x3a1820, 0xd7d2c8, 0xe1063a];
  let placed = 0;
  let guard = 0;
  while (placed < crowdN && guard < crowdN * 8) {
    guard++;
    const ang = Math.random() * Math.PI * 2;
    let aisle = false;
    for (const s of STAIR_A) {
      if (Math.abs(wrapAng(ang - s)) < 0.11) aisle = true;
    }
    if (aisle && Math.random() < 0.82) continue;
    const r = 6.15 + Math.random() ** 0.72 * 3.7;
    radii[placed] = r;
    angs[placed] = ang;
    phases[placed] = Math.random() * Math.PI * 2;
    scales[placed] = 1.05 + Math.random() * 0.18;
    const roll = Math.random();
    const hex = roll > 0.97 ? palette[7]! : roll > 0.93 ? palette[6]! : palette[(Math.random() * 6) | 0]!;
    crowd.setColorAt(placed, new THREE.Color(hex));
    placed++;
  }
  crowd.count = placed;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  scene.add(crowd);

  const lineMat = new THREE.MeshStandardMaterial({ color: "#0c0e12", roughness: 0.5, metalness: 0.4 });
  for (const a of STAIR_A) {
    const hang = new THREE.Group();
    hang.position.set(Math.sin(a) * 8.1, 6.15, Math.cos(a) * 8.1);
    hang.lookAt(0, 2.2, 0);
    for (let i = 0; i < 6; i++) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.48), lineMat);
      cab.position.z = -0.15 - i * 0.34;
      cab.position.y = -i * 0.05;
      hang.add(cab);
    }
    scene.add(hang);
  }

  const dustCount = mobile ? 180 : 420;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 10;
    dustPos[i * 3] = Math.sin(a) * r;
    dustPos[i * 3 + 1] = Math.random() * 7;
    dustPos[i * 3 + 2] = Math.cos(a) * r;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      map: dustTexture(),
      color: "#d5e8ff",
      size: 0.055,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  scene.add(dust);

  const hemi = new THREE.HemisphereLight("#243044", "#07080c", 0.55);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight("#d5e4ff", 1.35);
  moon.position.set(12, 22, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.near = 2;
  moon.shadow.camera.far = 48;
  moon.shadow.camera.left = -16;
  moon.shadow.camera.right = 16;
  moon.shadow.camera.top = 16;
  moon.shadow.camera.bottom = -16;
  moon.shadow.bias = -0.0004;
  scene.add(moon);
  const wash: THREE.PointLight[] = [];
  for (const a of PORTAL_A) {
    const p = new THREE.PointLight("#3d78ff", 18, 16, 2);
    p.position.set(Math.sin(a) * (PORTAL_R - 1.4), 3.4, Math.cos(a) * (PORTAL_R - 1.4));
    scene.add(p);
    wash.push(p);
  }
  const key = new THREE.PointLight("#f4f7ff", 26, 14, 2);
  key.position.set(0, 6.2, 0);
  scene.add(key);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), mobile ? 0.38 : 0.5, 0.42, 0.78);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const click = new ShowClick();
  const targetCol = {
    beam: new THREE.Color(LOOK_COLORS.finale.beam),
    core: new THREE.Color(LOOK_COLORS.finale.core),
    edge: new THREE.Color(LOOK_COLORS.finale.edge),
    arch: new THREE.Color(LOOK_COLORS.finale.arch),
    barA: new THREE.Color(LOOK_COLORS.finale.barA),
    barB: new THREE.Color(LOOK_COLORS.finale.barB),
    fog: new THREE.Color(LOOK_COLORS.finale.fog),
    wash: new THREE.Color(LOOK_COLORS.finale.wash),
    sky: new THREE.Color(LOOK_COLORS.finale.sky),
    bars: LOOK_COLORS.finale.bars,
    exposure: LOOK_COLORS.finale.exposure,
  };
  let lookBars = targetCol.bars;
  let lookExposure = targetCol.exposure;

  const desired = { theta: SHOT_DEF.platea.theta, phi: SHOT_DEF.platea.phi, radius: SHOT_DEF.platea.radius };
  const current = { ...desired };
  const target = new THREE.Vector3(...SHOT_DEF.platea.target);
  const targetTo = target.clone();
  let spin = 0;
  let mode: Mode = "orbita";
  let shot: ShotId = "platea";
  let cinemaT = 0;
  let cinemaI = 0;

  const walk = { x: 0, y: 1.65, z: -8.4, yaw: Math.PI, pitch: -0.04 };
  const keys = new Set<string>();
  let forced: Set<string> | null = null;
  const stick = { x: 0, y: 0 };
  let energy = 0.25;
  let flash = 0;
  let prevLow = 0;
  const vel = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  }
  resize();

  function applyShot(id: ShotId) {
    const def = SHOT_DEF[id] ?? SHOT_DEF.platea;
    shot = SHOT_DEF[id] ? id : "platea";
    desired.theta = def.theta;
    desired.phi = def.phi;
    desired.radius = def.radius;
    targetTo.set(def.target[0], def.target[1], def.target[2]);
    spin = def.spin ?? 0;
    hooks.onShot(shot);
  }
  applyShot("platea");

  function setLook(id: LookId) {
    const c = LOOK_COLORS[id];
    if (!c) return;
    targetCol.beam.set(c.beam);
    targetCol.core.set(c.core);
    targetCol.edge.set(c.edge);
    targetCol.arch.set(c.arch);
    targetCol.barA.set(c.barA);
    targetCol.barB.set(c.barB);
    targetCol.fog.set(c.fog);
    targetCol.wash.set(c.wash);
    targetCol.sky.set(c.sky);
    targetCol.bars = c.bars;
    targetCol.exposure = c.exposure;
  }

  const held = () => forced ?? keys;

  function surfaceY(x: number, z: number) {
    const r = Math.hypot(x, z);
    if (r <= DECK_R - 0.08) return DECK_H;
    const ang = Math.atan2(x, z);
    for (const s of STAIR_A) {
      if (Math.abs(wrapAng(ang - s)) < 0.2 && r <= DECK_R + 1.7 && r >= DECK_R - 0.15) {
        const tt = THREE.MathUtils.clamp((DECK_R + 1.65 - r) / 1.75, 0, 1);
        return tt * DECK_H;
      }
    }
    if (r < DECK_R + 0.12) return -1;
    return 0;
  }

  function collide(pos: THREE.Vector3) {
    let r = Math.hypot(pos.x, pos.z);
    if (r > 16.6) {
      pos.x *= 16.6 / r;
      pos.z *= 16.6 / r;
      r = 16.6;
    }
    for (const a of PORTAL_A) {
      const cx = Math.sin(a) * PORTAL_R;
      const cz = Math.cos(a) * PORTAL_R;
      const rx = Math.sin(a);
      const rz = Math.cos(a);
      const tx = Math.cos(a);
      const tz = -Math.sin(a);
      const radial = (pos.x - cx) * rx + (pos.z - cz) * rz;
      const tang = (pos.x - cx) * tx + (pos.z - cz) * tz;
      const halfW = 3.35;
      const halfD = 0.85;
      if (Math.abs(tang) < halfW && Math.abs(radial) < halfD) {
        const penT = halfW - Math.abs(tang);
        const penR = halfD - Math.abs(radial);
        if (penT < penR) {
          const sign = tang >= 0 ? 1 : -1;
          pos.x += tx * (halfW * sign - tang);
          pos.z += tz * (halfW * sign - tang);
        } else {
          const sign = radial >= 0 ? 1 : -1;
          pos.x += rx * (halfD * sign - radial);
          pos.z += rz * (halfD * sign - radial);
        }
      }
    }
    const sy = surfaceY(pos.x, pos.z);
    if (sy < 0) {
      const rr = Math.hypot(pos.x, pos.z) || 0.001;
      const push = DECK_R + 0.16;
      if (rr < push) {
        pos.x *= push / rr;
        pos.z *= push / rr;
      }
      return 0;
    }
    return sy;
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === "Space") {
      e.preventDefault();
      void click.toggle();
    }
    if (["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"].includes(e.code)) {
      const order: LookId[] = ["ignition", "finale", "strisce", "viola", "ambra"];
      setLook(order[Number(e.code.slice(5)) - 1]!);
    }
    if (e.code === "Escape" && mode === "cammina") {
      mode = "orbita";
      hooks.onMode(mode);
      applyShot(shot);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinch: number | null = null;

  const localPoint = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    dragging = true;
    const p = localPoint(ev);
    lastX = p.x;
    lastY = p.y;
    canvas.setPointerCapture(ev.pointerId);
    if (mode === "cinema") {
      mode = "orbita";
      spin = 0;
      hooks.onMode("orbita");
    }
  };
  const onPointerMove = (ev: PointerEvent) => {
    const touches = ev.pointerType === "touch";
    if (!dragging) return;
    const p = localPoint(ev);
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    lastX = p.x;
    lastY = p.y;
    if (mode === "cammina") {
      walk.yaw -= dx * 0.0045;
      walk.pitch -= dy * 0.0032;
      walk.pitch = THREE.MathUtils.clamp(walk.pitch, -1.05, 1.05);
      return;
    }
    if (touches && pinch !== null) return;
    desired.theta -= dx * 0.005;
    desired.phi -= dy * 0.0035;
    desired.phi = THREE.MathUtils.clamp(desired.phi, 0.28, 2.15);
    current.theta = desired.theta;
    current.phi = desired.phi;
    spin = 0;
  };
  const onPointerUp = (ev: PointerEvent) => {
    dragging = false;
    pinch = null;
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
  };
  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    if (mode === "cammina") return;
    desired.radius = THREE.MathUtils.clamp(desired.radius * Math.exp(ev.deltaY * 0.0011), 2.4, 36);
    spin = 0;
  };
  const onTouchStart = (ev: TouchEvent) => {
    if (ev.touches.length === 2) {
      const a = ev.touches[0]!;
      const b = ev.touches[1]!;
      pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  };
  const onTouchMove = (ev: TouchEvent) => {
    if (ev.touches.length === 2 && pinch !== null && mode !== "cammina") {
      const a = ev.touches[0]!;
      const b = ev.touches[1]!;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = pinch / Math.max(1, d);
      desired.radius = THREE.MathUtils.clamp(desired.radius * ratio, 2.4, 36);
      pinch = d;
    }
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: true });
  canvas.addEventListener("touchmove", onTouchMove, { passive: true });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const timer = new THREE.Timer();
  timer.connect(document);
  const lookAt = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    click.tick();
    const low = click.level();
    const bpm = 138;
    const beat = reduced ? 0.4 : Math.pow(Math.max(0, Math.sin(t * Math.PI * (bpm / 60))), 14);
    const targetE = click.playing ? low : 0.28 + beat * 0.72;
    energy += (targetE - energy) * (1 - Math.exp(-dt * 8));
    if ((click.playing ? low : beat) > (click.playing ? 0.55 : 0.65) && (click.playing ? low : beat) > prevLow + 0.08) {
      flash = 1;
    }
    prevLow = click.playing ? low : beat;
    flash *= Math.exp(-dt * 7);
    hooks.onEnergy(energy);

    const k = 1 - Math.exp(-dt * 2.4);
    beamUniforms.uColor.value.lerp(targetCol.beam, k);
    moverUniforms.uColor.value.lerp(targetCol.edge, k);
    ledUniforms.uCore.value.lerp(targetCol.core, k);
    ledUniforms.uEdge.value.lerp(targetCol.edge, k);
    ledUniforms.uArch.value.lerp(targetCol.arch, k);
    ledUniforms.uFog.value.lerp(targetCol.fog, k);
    skirtUniforms.uA.value.lerp(targetCol.barA, k);
    skirtUniforms.uB.value.lerp(targetCol.barB, k);
    boothLedUniforms.uCore.value.lerp(targetCol.core, k);
    boothLedUniforms.uEdge.value.lerp(targetCol.edge, k);
    barMatA.emissive.lerp(targetCol.barA, k);
    barMatB.emissive.lerp(targetCol.barB, k);
    wordMat.color.lerp(targetCol.core, k);
    (pit.material as THREE.MeshBasicMaterial).color.lerp(targetCol.edge, k);
    skyMat.uniforms.uTop.value.lerp(targetCol.sky, k);
    skyMat.uniforms.uBot.value.lerp(targetCol.fog, k);
    scene.fog?.color.lerp(targetCol.fog, k);
    if (scene.background instanceof THREE.Color) scene.background.lerp(targetCol.fog, k);
    for (const p of wash) p.color.lerp(targetCol.wash, k);
    lookBars += (targetCol.bars - lookBars) * k;
    lookExposure += (targetCol.exposure - lookExposure) * k;
    renderer.toneMappingExposure = lookExposure;
    barMatA.emissiveIntensity = lookBars * (1.1 + energy * 1.6 + flash * 0.8);
    barMatB.emissiveIntensity = lookBars * (0.9 + energy * 1.4 + flash * 0.5);
    blinderMat.emissiveIntensity = 0.25 + energy * 0.45 + flash * 6.5;
    beamUniforms.uIntensity.value = 0.72 + energy * 0.85 + flash * 0.65;
    moverUniforms.uIntensity.value = 0.55 + energy * 1.1 + flash * 0.4;
    ledUniforms.uTime.value = t;
    ledUniforms.uEnergy.value = energy;
    ledUniforms.uFlash.value = flash;
    skirtUniforms.uTime.value = t;
    skirtUniforms.uEnergy.value = energy;
    boothLedUniforms.uTime.value = t;
    boothLedUniforms.uEnergy.value = energy;

    if (!reduced) {
      for (const h of heads) {
        h.yoke.rotation.y = Math.sin(t * 0.45 + h.base) * 0.7;
        h.head.rotation.x = -0.15 + Math.sin(t * 0.72 + h.base * 2) * 0.42;
      }
      booth.traverse((obj) => {
        if (obj.name === "jog") obj.rotation.z = t * 1.6;
      });
      dj.position.y = Math.sin(t * (2 + energy * 4)) * 0.03;
      dj.rotation.y = Math.sin(t * 0.6) * 0.25;
    }

    for (let i = 0; i < crowd.count; i++) {
      const bob = reduced ? 0 : Math.sin(t * (6.2 + energy * 3) + phases[i]!) * (0.025 + energy * 0.07);
      const ang = angs[i]!;
      const r = radii[i]!;
      dummy.position.set(Math.sin(ang) * r, bob, Math.cos(ang) * r);
      dummy.rotation.set(0, Math.atan2(-Math.sin(ang), -Math.cos(ang)), Math.sin(t * 6 + phases[i]!) * 0.03 * energy);
      const sc = scales[i]!;
      dummy.scale.set(sc, sc * (1 + bob * 0.15), sc);
      dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
    }
    crowd.instanceMatrix.needsUpdate = true;

    const arr = dustGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dustCount; i++) {
      let y = (arr.getY(i) + dt * (0.18 + energy * 0.35)) % 7.2;
      arr.setY(i, y);
    }
    arr.needsUpdate = true;

    if (mode === "cinema" && !reduced) {
      cinemaT += dt;
      if (cinemaT > 6.5) {
        cinemaT = 0;
        cinemaI = (cinemaI + 1) % CINEMA.length;
        const next = CINEMA[cinemaI]!;
        if (next === "spaccato") {
          desired.theta = Math.PI * 0.72;
          desired.phi = 1.18;
          desired.radius = 16.5;
          targetTo.set(0, 3.1, 0);
          spin = 0.05;
          hooks.onShot("platea");
        } else {
          applyShot(next);
        }
      }
    }

    if (mode === "cammina") {
      const downKeys = held();
      let moveF = stick.y;
      let moveR = stick.x;
      if (downKeys.has("KeyW") || downKeys.has("ArrowUp")) moveF += 1;
      if (downKeys.has("KeyS") || downKeys.has("ArrowDown")) moveF -= 1;
      if (downKeys.has("KeyD") || downKeys.has("ArrowRight")) moveR += 1;
      if (downKeys.has("KeyA") || downKeys.has("ArrowLeft")) moveR -= 1;
      moveF = THREE.MathUtils.clamp(moveF, -1, 1);
      moveR = THREE.MathUtils.clamp(moveR, -1, 1);
      const speed = (downKeys.has("ShiftLeft") || downKeys.has("ShiftRight") ? 7.4 : 4.1) * (reduced ? 0.6 : 1);
      forward.set(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
      right.set(Math.cos(walk.yaw), 0, -Math.sin(walk.yaw));
      vel.set(0, 0, 0);
      vel.addScaledVector(forward, moveF * speed);
      vel.addScaledVector(right, moveR * speed);
      walk.x += vel.x * dt;
      walk.z += vel.z * dt;
      const probe = new THREE.Vector3(walk.x, 0, walk.z);
      const sy = collide(probe);
      walk.x = probe.x;
      walk.z = probe.z;
      walk.y = sy + 1.65;
      camera.position.set(walk.x, walk.y, walk.z);
      camera.rotation.y = walk.yaw;
      camera.rotation.x = walk.pitch;
      camera.rotation.z = 0;
    } else {
      if (spin && !dragging) {
        desired.theta += dt * spin;
        current.theta = desired.theta;
      }
      const damp = 1 - Math.exp(-dt * (dragging ? 18 : 3.2));
      current.theta += wrapAng(desired.theta - current.theta) * damp;
      current.phi += (desired.phi - current.phi) * damp;
      current.radius += (desired.radius - current.radius) * damp;
      target.lerp(targetTo, damp);
      const sp = Math.sin(current.phi);
      camPos.set(
        target.x + current.radius * sp * Math.sin(current.theta),
        target.y + current.radius * Math.cos(current.phi),
        target.z + current.radius * sp * Math.cos(current.theta),
      );
      camPos.y = Math.max(0.35, camPos.y);
      camera.position.copy(camPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.rotation.z = 0;
    }

    composer.render();
  }

  renderer.setAnimationLoop(frame);
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  hooks.onReady({ crowd: crowd.count });

  const probe = {
    getYaw: () => walk.yaw,
    getSpeed: () => Math.hypot(vel.x, vel.z),
    getPos: () => ({ x: walk.x, z: walk.z, y: walk.y }),
    setKeys: (codes: string[]) => {
      forced = new Set(codes);
      if (codes.length) {
        mode = "cammina";
        hooks.onMode("cammina");
      }
    },
    setYaw: (y: number) => {
      walk.yaw = y;
    },
    clearForced: () => {
      forced = null;
    },
  };
  if (import.meta.env.DEV) {
    (window as unknown as { __controlsTest?: typeof probe }).__controlsTest = probe;
  }

  return {
    setLook,
    setShot: (id) => {
      forced = null;
      if (mode !== "orbita") {
        mode = "orbita";
        hooks.onMode("orbita");
      }
      applyShot(id);
    },
    setMode: (next) => {
      forced = null;
      mode = next;
      hooks.onMode(next);
      if (next === "cammina") {
        walk.x = 0;
        walk.z = -8.2;
        walk.yaw = Math.PI;
        walk.pitch = -0.06;
        spin = 0;
      } else if (next === "cinema") {
        cinemaT = 0;
        cinemaI = 0;
        applyShot("platea");
      } else {
        applyShot(shot);
      }
    },
    toggleAudio: () => click.toggle(),
    setMove: (x, y) => {
      stick.x = x;
      stick.y = y;
    },
    dispose: () => {
      renderer.setAnimationLoop(null);
      timer.disconnect();
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      click.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}

function addRing(parent: THREE.Object3D, radius: number, y: number, metal: THREE.Material) {
  const s = 0.18;
  const tube = 0.03;
  for (const [ox, oy] of [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ] as const) {
    const geo = new THREE.TorusGeometry(radius + ox, tube, 6, 80);
    const mesh = new THREE.Mesh(geo, metal);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = y + oy;
    mesh.castShadow = true;
    parent.add(mesh);
  }
  const N = 48;
  const vGeo = new THREE.CylinderGeometry(tube * 0.85, tube * 0.85, s * 2, 4);
  const inst = new THREE.InstancedMesh(vGeo, metal, N * 4);
  const dummy = new THREE.Object3D();
  const corners = [-s, s];
  let idx = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    for (const ox of corners) {
      for (const oz of [0]) {
        const r = radius + ox;
        dummy.position.set(Math.sin(a) * r, y, Math.cos(a) * r + oz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(idx++, dummy.matrix);
      }
    }
    // second pair offset tangentially so the section reads as a square
    for (const ox of corners) {
      const r = radius + ox * 0.15;
      dummy.position.set(Math.sin(a) * r + Math.cos(a) * s, y, Math.cos(a) * r - Math.sin(a) * s);
      dummy.updateMatrix();
      inst.setMatrixAt(idx++, dummy.matrix);
    }
  }
  inst.count = idx;
  inst.castShadow = true;
  parent.add(inst);
}
