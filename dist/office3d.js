/* Cena 3D do escritório — WebGL real, Three.js vendorizado em /vendor (sem CDN).
   O ambiente é procedural e os funcionários usam um personagem articulado produzido no Blender.
   A cena é montada uma única vez; eventos do servidor apenas mudam estado,
   clipes, cor, brilho e etiquetas. */
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { officeMotion } from './office-motion.js';

const deg = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;

const C = {
  floor: 0x9aa878, floorEdge: 0x77855b, slab: 0x2c3528, aisle: 0xb4bd96,
  rug: 0xd6ccab, rugEdge: 0xbfb896,
  deskTop: 0xf4ecdb, deskEdge: 0xdfd3b9, deskLeg: 0xc9bc9f,
  divider: 0x35563f, dividerTop: 0x28402f, dividerPost: 0x1e3325,
  chair: 0x3a444d, chairMetal: 0x272d33,
  monitor: 0x272e34, keyboard: 0xeae2d3, mouse: 0xded5c4,
  mug: 0xefe9dc, paper: 0xfbf7ee, book: 0xb8705a,
  pot: 0xc98e64, potDark: 0xa9714e, leaf: 0x4e7c45, leafSoft: 0x6f9c52, stem: 0x3d5f38,
  trousers: 0x3c4450, shoe: 0x2a2f37, wood: 0xb08355, woodDark: 0x8a6440,
  sofa: 0x4b5b64, sofaSoft: 0x5b6d76, cooler: 0xe3e9ea, water: 0x8fd0e0,
  lampShade: 0xf6e6c4, metal: 0x6f7a80
};

const STATUS = {
  running:   { ring: 0x8ff0b8, screen: 'running',   glow: 1.25 },
  queued:    { ring: 0x9ec7e8, screen: 'queued',    glow: 0.55 },
  attention: { ring: 0xf0c07a, screen: 'attention', glow: 0.75 },
  resting:   { ring: 0xb4a6d8, screen: 'resting',   glow: 0.12 },
  configure: { ring: 0xf29a86, screen: 'configure', glow: 0.45 },
  available: { ring: 0x9fb3c6, screen: 'available', glow: 0.3 }
};

/* Aparência de cada pessoa. A ordem das mesas segue a ordem dos funcionários. */
const LOOKS = {
  manager:   { skin: 0xf3c9a6, hair: 0x4a3123, style: 'short',  extra: 'mug' },
  architect: { skin: 0xf6d3b2, hair: 0x2f2430, style: 'bun',    extra: 'tablet' },
  frontend:  { skin: 0xc98c62, hair: 0x231c18, style: 'curly',  extra: 'headphones' },
  backend:   { skin: 0xe0aa80, hair: 0x2b211c, style: 'long',   extra: 'plant' },
  qa:        { skin: 0xf2c49c, hair: 0x5a3a22, style: 'cap',    extra: 'papers' },
  delivery:  { skin: 0xb3764f, hair: 0x2a2320, style: 'short',  extra: 'glasses' }
};
const DEFAULT_LOOK = { skin: 0xf0c49f, hair: 0x33271f, style: 'short', extra: 'mug' };

/* ---------- geometrias e materiais compartilhados ---------- */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 30, 22),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: new THREE.ConeGeometry(0.5, 1, 20),
  ico: new THREE.IcosahedronGeometry(0.5, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  ring: new THREE.RingGeometry(0.74, 0.9, 44),
  torso: new THREE.CapsuleGeometry(0.27, 0.14, 6, 20),
  arm: new THREE.CapsuleGeometry(0.095, 0.46, 4, 14),
  leg: new THREE.CapsuleGeometry(0.125, 0.26, 4, 14),
  pony: new THREE.CapsuleGeometry(0.12, 0.3, 4, 12),
  pot: new THREE.CylinderGeometry(0.5, 0.36, 0.42, 22),
  lens: new THREE.TorusGeometry(0.1, 0.022, 8, 22),
  band: new THREE.TorusGeometry(0.44, 0.035, 8, 26, Math.PI),
  cap: new THREE.SphereGeometry(0.5, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2)
};

const materials = new Map();
function mat(color, options = {}) {
  const key = `${color}|${options.roughness ?? 0.8}|${options.metalness ?? 0}|${options.emissive ?? 0}|${options.opacity ?? 1}`;
  let found = materials.get(key);
  if (!found) {
    found = new THREE.MeshStandardMaterial({
      color, roughness: options.roughness ?? 0.8, metalness: options.metalness ?? 0,
      emissive: options.emissive ?? 0x000000, emissiveIntensity: options.emissiveIntensity ?? 1,
      transparent: (options.opacity ?? 1) < 1, opacity: options.opacity ?? 1
    });
    materials.set(key, found);
  }
  return found;
}
function part(geometry, material, { pos, scale, rot, cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  return mesh;
}
const group = (...children) => { const g = new THREE.Group(); for (const child of children) g.add(child); return g; };

/* Telas: textura de interface abstrata, sem texto, gerada localmente. */
function screenTexture(kind, anisotropy) {
  const tint = { running: '#7fd3ff', queued: '#9ec7e8', attention: '#f0c07a', resting: '#8b7cb1', configure: '#f29a86', available: '#58788a' }[kind];
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 152;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d161e'; ctx.fillRect(0, 0, 256, 152);
  ctx.fillStyle = '#16242f'; ctx.fillRect(9, 9, 238, 134);
  ctx.fillStyle = tint;
  ctx.globalAlpha = 0.92; ctx.fillRect(9, 9, 238, 13);
  ctx.globalAlpha = 0.2; ctx.fillRect(152, 30, 95, 104);
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 7; i++) ctx.fillRect(20, 34 + i * 14, 34 + ((i * 53) % 106), 6);
  ctx.globalAlpha = 0.34;
  for (let i = 0; i < 4; i++) ctx.fillRect(162, 42 + i * 22, 74, 10);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/* ---------- peças do cenário ---------- */
function buildFloor() {
  const g = new THREE.Group();
  g.add(part(G.box, mat(C.slab, { roughness: 0.95 }), { pos: [0, -0.45, 0], scale: [20.4, 0.9, 17.4], cast: false }));
  g.add(part(G.box, mat(C.floorEdge, { roughness: 0.9 }), { pos: [0, -0.04, 0], scale: [20, 0.16, 17], cast: false }));
  g.add(part(G.plane, mat(C.floor, { roughness: 0.96 }), { pos: [0, 0.045, 0], scale: [19.7, 16.7, 1], rot: [-Math.PI / 2, 0, 0], cast: false }));
  g.add(part(G.plane, mat(C.aisle, { roughness: 0.94 }), { pos: [0, 0.055, 0], scale: [19.7, 3.1, 1], rot: [-Math.PI / 2, 0, 0], cast: false }));
  for (const [x, z, w, d] of [[-5.4, 6.6, 6.8, 4.6], [3.2, -6.6, 5.8, 4.6]]) {
    g.add(part(G.plane, mat(C.rugEdge, { roughness: 0.98 }), { pos: [x, 0.06, z], scale: [w, d, 1], rot: [-Math.PI / 2, 0, 0], cast: false }));
    g.add(part(G.plane, mat(C.rug, { roughness: 0.98 }), { pos: [x, 0.065, z], scale: [w - 0.6, d - 0.6, 1], rot: [-Math.PI / 2, 0, 0], cast: false }));
  }
  return g;
}

function buildDesk() {
  const g = new THREE.Group();
  g.add(part(G.box, mat(C.deskTop, { roughness: 0.62 }), { pos: [0, 0.76, 0], scale: [2.6, 0.08, 1.3] }));
  g.add(part(G.box, mat(C.deskEdge, { roughness: 0.7 }), { pos: [0, 0.7, 0], scale: [2.5, 0.05, 1.22] }));
  for (const x of [-1.16, 1.16]) g.add(part(G.box, mat(C.deskLeg, { roughness: 0.78 }), { pos: [x, 0.36, 0], scale: [0.09, 0.72, 1.1] }));
  g.add(part(G.box, mat(C.deskLeg, { roughness: 0.78 }), { pos: [0, 0.44, -0.55], scale: [2.3, 0.44, 0.06] }));
  g.add(part(G.box, mat(C.deskEdge, { roughness: 0.75 }), { pos: [0.83, 0.34, -0.1], scale: [0.5, 0.6, 0.85] }));
  for (const y of [0.24, 0.46]) g.add(part(G.box, mat(C.metal, { roughness: 0.5, metalness: 0.4 }), { pos: [0.83, y, 0.33], scale: [0.3, 0.02, 0.02] }));
  return g;
}

function buildChair(cushion) {
  const g = new THREE.Group();
  g.add(part(G.box, mat(C.chair, { roughness: 0.85 }), { pos: [0, 0.47, 0], scale: [0.64, 0.12, 0.62] }));
  g.add(part(G.box, mat(cushion, { roughness: 0.9 }), { pos: [0, 0.54, 0], scale: [0.58, 0.05, 0.56] }));
  g.add(part(G.box, mat(C.chair, { roughness: 0.85 }), { pos: [0, 0.88, 0.3], scale: [0.6, 0.66, 0.1], rot: [deg(7), 0, 0] }));
  g.add(part(G.box, mat(cushion, { roughness: 0.9 }), { pos: [0, 0.88, 0.24], scale: [0.5, 0.56, 0.05], rot: [deg(7), 0, 0] }));
  for (const x of [-0.36, 0.36]) {
    g.add(part(G.box, mat(C.chairMetal, { roughness: 0.6, metalness: 0.3 }), { pos: [x, 0.7, -0.04], scale: [0.07, 0.05, 0.44] }));
    g.add(part(G.box, mat(C.chairMetal, { roughness: 0.6, metalness: 0.3 }), { pos: [x, 0.62, 0.15], scale: [0.05, 0.22, 0.07] }));
  }
  g.add(part(G.cyl, mat(C.chairMetal, { roughness: 0.5, metalness: 0.5 }), { pos: [0, 0.26, 0], scale: [0.12, 0.44, 0.12] }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(part(G.box, mat(C.chairMetal, { roughness: 0.55, metalness: 0.4 }), { pos: [Math.sin(a) * 0.18, 0.07, Math.cos(a) * 0.18], scale: [0.07, 0.05, 0.36], rot: [0, a, 0] }));
    g.add(part(G.sphere, mat(0x1d2227, { roughness: 0.6 }), { pos: [Math.sin(a) * 0.33, 0.05, Math.cos(a) * 0.33], scale: [0.1, 0.1, 0.1] }));
  }
  return g;
}

function buildMonitor(screenMaterial) {
  const g = new THREE.Group();
  g.add(part(G.box, mat(C.monitor, { roughness: 0.55 }), { pos: [0, 0.82, 0], scale: [0.46, 0.04, 0.3] }));
  g.add(part(G.box, mat(C.monitor, { roughness: 0.55 }), { pos: [0, 0.98, 0], scale: [0.08, 0.3, 0.08] }));
  const head = group(
    part(G.box, mat(C.monitor, { roughness: 0.5 }), { pos: [0, 0, 0], scale: [1.12, 0.68, 0.06] }),
    part(G.plane, screenMaterial, { pos: [0, 0.01, 0.034], scale: [1.02, 0.58, 1], cast: false, receive: false })
  );
  head.position.set(0, 1.42, 0.02);
  head.rotation.x = deg(-5);
  g.add(head);
  return g;
}

function buildDivider() {
  const g = new THREE.Group();
  g.add(part(G.box, mat(C.divider, { roughness: 0.94 }), { pos: [0, 0.64, -1], scale: [3, 1.28, 0.09] }));
  g.add(part(G.box, mat(C.dividerTop, { roughness: 0.7 }), { pos: [0, 1.31, -1], scale: [3.04, 0.08, 0.14] }));
  for (const x of [-1.5, 1.5]) {
    g.add(part(G.box, mat(C.divider, { roughness: 0.94 }), { pos: [x, 0.58, -0.06], scale: [0.09, 1.16, 1.9] }));
    g.add(part(G.box, mat(C.dividerTop, { roughness: 0.7 }), { pos: [x, 1.19, -0.06], scale: [0.13, 0.08, 1.94] }));
    g.add(part(G.box, mat(C.dividerPost, { roughness: 0.8 }), { pos: [x, 0.64, -1], scale: [0.13, 1.32, 0.13] }));
  }
  return g;
}

function buildHead(look) {
  const g = new THREE.Group();
  const skin = mat(look.skin, { roughness: 0.82 });
  const hair = mat(look.hair, { roughness: 0.92 });
  const head = part(G.sphere, skin, { pos: [0, 0, 0], scale: [0.86, 0.9, 0.84] });
  g.add(head);
  g.add(part(G.sphere, skin, { pos: [-0.42, -0.08, 0], scale: [0.13, 0.19, 0.13] }));
  g.add(part(G.sphere, skin, { pos: [0.42, -0.08, 0], scale: [0.13, 0.19, 0.13] }));
  g.add(part(G.sphere, mat(0x241d1b, { roughness: 0.4 }), { pos: [-0.15, 0.03, -0.4], scale: [0.09, 0.11, 0.07] }));
  g.add(part(G.sphere, mat(0x241d1b, { roughness: 0.4 }), { pos: [0.15, 0.03, -0.4], scale: [0.09, 0.11, 0.07] }));
  g.add(part(G.sphere, mat(0x8d4f44, { roughness: 0.6 }), { pos: [0, -0.15, -0.4], scale: [0.12, 0.05, 0.05] }));
  g.add(part(G.sphere, hair, { pos: [0, 0.12, 0.05], scale: [0.93, 0.8, 0.92] }));
  if (look.style === 'bun') g.add(part(G.sphere, hair, { pos: [0, 0.3, 0.34], scale: [0.36, 0.34, 0.34] }));
  if (look.style === 'long') {
    g.add(part(G.box, hair, { pos: [0, -0.24, 0.3], scale: [0.62, 0.62, 0.22] }));
    for (const x of [-0.34, 0.34]) g.add(part(G.pony, hair, { pos: [x, -0.14, 0.06], scale: [1, 1, 1] }));
  }
  if (look.style === 'curly') for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(part(G.ico, hair, { pos: [Math.sin(a) * 0.32, 0.2 + Math.cos(a * 2) * 0.08, Math.cos(a) * 0.3], scale: [0.34, 0.32, 0.34] }));
  }
  if (look.style === 'cap') {
    g.add(part(G.cap, mat(0x39566b, { roughness: 0.85 }), { pos: [0, 0.06, 0], scale: [0.99, 0.8, 0.97] }));
    g.add(part(G.box, mat(0x2f4757, { roughness: 0.85 }), { pos: [0, 0.07, -0.42], scale: [0.5, 0.05, 0.3] }));
  }
  if (look.extra === 'glasses') {
    for (const x of [-0.16, 0.16]) g.add(part(G.lens, mat(0x2a2f34, { roughness: 0.4, metalness: 0.3 }), { pos: [x, 0.04, -0.42], scale: [1, 1, 1] }));
    g.add(part(G.box, mat(0x2a2f34, { roughness: 0.4, metalness: 0.3 }), { pos: [0, 0.04, -0.42], scale: [0.13, 0.02, 0.02] }));
  }
  if (look.extra === 'headphones') {
    g.add(part(G.band, mat(0x2b3138, { roughness: 0.6 }), { pos: [0, 0.06, 0], scale: [1, 1, 1], rot: [0, 0, 0] }));
    for (const x of [-0.42, 0.42]) g.add(part(G.cyl, mat(0x2b3138, { roughness: 0.6 }), { pos: [x, 0, 0], scale: [0.22, 0.14, 0.22], rot: [0, 0, deg(90)] }));
  }
  return g;
}

function buildPerson(look, shirtColor) {
  const g = new THREE.Group();
  const skin = mat(look.skin, { roughness: 0.82 });
  const shirt = mat(shirtColor, { roughness: 0.88 });
  const torso = part(G.torso, shirt, { pos: [0, 0.92, 0], scale: [1, 1, 0.86] });
  g.add(torso);
  g.add(part(G.box, mat(C.trousers, { roughness: 0.9 }), { pos: [0, 0.6, -0.02], scale: [0.5, 0.18, 0.44] }));
  const armL = part(G.arm, shirt, { pos: [-0.31, 1.01, -0.29], rot: [deg(71), 0, deg(7)] });
  const armR = part(G.arm, shirt, { pos: [0.31, 1.01, -0.29], rot: [deg(71), 0, deg(-7)] });
  g.add(armL, armR);
  const handL = part(G.sphere, skin, { pos: [-0.36, 0.9, -0.6], scale: [0.18, 0.15, 0.2] });
  const handR = part(G.sphere, skin, { pos: [0.36, 0.9, -0.6], scale: [0.18, 0.15, 0.2] });
  g.add(handL, handR);
  const legUpper = [], legLower = [], shoes = [];
  for (const x of [-0.17, 0.17]) {
    const upper = part(G.leg, mat(C.trousers, { roughness: 0.9 }), { pos: [x, 0.53, -0.22], rot: [deg(82), 0, 0] });
    const lower = part(G.leg, mat(C.trousers, { roughness: 0.9 }), { pos: [x, 0.28, -0.48] });
    const shoe = part(G.box, mat(C.shoe, { roughness: 0.7 }), { pos: [x, 0.07, -0.56], scale: [0.2, 0.12, 0.34] });
    legUpper.push(upper); legLower.push(lower); shoes.push(shoe); g.add(upper, lower, shoe);
  }
  g.add(part(G.cyl, skin, { pos: [0, 1.3, 0], scale: [0.2, 0.16, 0.2] }));
  const head = buildHead(look);
  head.position.set(0, 1.62, 0);
  g.add(head);
  return { root: g, head, torso, armL, armR, handL, handR, legUpper, legLower, shoes };
}

function buildPlant(size = 1, tall = false) {
  const g = new THREE.Group();
  g.add(part(G.pot, mat(C.pot, { roughness: 0.9 }), { pos: [0, 0.21 * size, 0], scale: [size, size, size] }));
  g.add(part(G.cyl, mat(C.potDark, { roughness: 0.9 }), { pos: [0, 0.42 * size, 0], scale: [1.08 * size, 0.06 * size, 1.08 * size] }));
  const leaves = group();
  if (tall) {
    g.add(part(G.cyl, mat(C.stem, { roughness: 0.9 }), { pos: [0, 0.8 * size, 0], scale: [0.09 * size, 0.9 * size, 0.09 * size] }));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      leaves.add(part(G.ico, mat(i % 2 ? C.leaf : C.leafSoft, { roughness: 0.9 }), {
        pos: [Math.sin(a) * 0.34 * size, (1.14 + (i % 3) * 0.16) * size, Math.cos(a) * 0.34 * size],
        scale: [0.62 * size, 0.34 * size, 0.62 * size], rot: [0, a, deg(18)]
      }));
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      leaves.add(part(G.ico, mat(i % 2 ? C.leaf : C.leafSoft, { roughness: 0.9 }), {
        pos: [Math.sin(a) * 0.26 * size, (0.62 + (i % 2) * 0.18) * size, Math.cos(a) * 0.26 * size],
        scale: [0.52 * size, 0.46 * size, 0.52 * size]
      }));
    }
    leaves.add(part(G.ico, mat(C.leafSoft, { roughness: 0.9 }), { pos: [0, 0.86 * size, 0], scale: [0.5 * size, 0.44 * size, 0.5 * size] }));
  }
  g.add(leaves);
  return { root: g, leaves };
}

function buildLounge() {
  const g = new THREE.Group();
  const sofa = group(
    part(G.box, mat(C.sofa, { roughness: 0.94 }), { pos: [0, 0.34, 0], scale: [2.5, 0.34, 0.95] }),
    part(G.box, mat(C.sofaSoft, { roughness: 0.96 }), { pos: [0, 0.53, 0.02], scale: [2.3, 0.14, 0.85] }),
    part(G.box, mat(C.sofa, { roughness: 0.94 }), { pos: [0, 0.68, -0.44], scale: [2.5, 0.7, 0.2] }),
    part(G.box, mat(C.sofa, { roughness: 0.94 }), { pos: [-1.2, 0.56, 0], scale: [0.2, 0.5, 0.95] }),
    part(G.box, mat(C.sofa, { roughness: 0.94 }), { pos: [1.2, 0.56, 0], scale: [0.2, 0.5, 0.95] })
  );
  for (const x of [-1.05, 1.05]) for (const z of [-0.35, 0.35]) sofa.add(part(G.cyl, mat(C.woodDark, { roughness: 0.7 }), { pos: [x, 0.1, z], scale: [0.09, 0.2, 0.09] }));
  g.add(sofa);
  const table = group(part(G.box, mat(C.wood, { roughness: 0.6 }), { pos: [0, 0.42, 0], scale: [1.4, 0.08, 0.72] }));
  for (const x of [-0.58, 0.58]) for (const z of [-0.24, 0.24]) table.add(part(G.cyl, mat(C.woodDark, { roughness: 0.7 }), { pos: [x, 0.21, z], scale: [0.07, 0.42, 0.07] }));
  table.add(part(G.box, mat(C.book, { roughness: 0.8 }), { pos: [-0.3, 0.49, 0], scale: [0.4, 0.06, 0.28], rot: [0, deg(12), 0] }));
  table.add(part(G.cyl, mat(C.mug, { roughness: 0.5 }), { pos: [0.35, 0.51, 0.05], scale: [0.14, 0.14, 0.14] }));
  table.position.set(0, 0, 1.45);
  g.add(table);
  return g;
}

function buildCooler() {
  const g = new THREE.Group();
  g.add(part(G.box, mat(C.cooler, { roughness: 0.5 }), { pos: [0, 0.48, 0], scale: [0.48, 0.96, 0.44] }));
  g.add(part(G.box, mat(0xb9c3c4, { roughness: 0.6 }), { pos: [0, 0.62, -0.24], scale: [0.26, 0.2, 0.06] }));
  g.add(part(G.cyl, mat(C.water, { roughness: 0.25, metalness: 0.05, opacity: 0.72 }), { pos: [0, 1.24, 0], scale: [0.38, 0.6, 0.38] }));
  g.add(part(G.cone, mat(C.water, { roughness: 0.25, opacity: 0.72 }), { pos: [0, 0.98, 0], scale: [0.38, 0.22, 0.38], rot: [Math.PI, 0, 0] }));
  return g;
}

function buildShelf() {
  const g = new THREE.Group();
  const frame = mat(C.wood, { roughness: 0.7 });
  for (const x of [-0.84, 0.84]) g.add(part(G.box, frame, { pos: [x, 0.95, 0], scale: [0.09, 1.9, 0.42] }));
  const colors = [0xcf7f63, 0x6f9c8e, 0xd9b26a, 0x8592c2, 0xc07f9a];
  for (let s = 0; s < 3; s++) {
    const y = 0.32 + s * 0.56;
    g.add(part(G.box, frame, { pos: [0, y, 0], scale: [1.78, 0.07, 0.42] }));
    for (let b = 0; b < 6; b++) g.add(part(G.box, mat(colors[(s * 6 + b) % colors.length], { roughness: 0.85 }), {
      pos: [-0.68 + b * 0.27, y + 0.24, 0], scale: [0.16, 0.4, 0.3], rot: [0, 0, b === 4 ? deg(12) : 0]
    }));
  }
  return g;
}

function buildLamp() {
  const g = new THREE.Group();
  g.add(part(G.cyl, mat(C.chairMetal, { roughness: 0.5, metalness: 0.5 }), { pos: [0, 0.04, 0], scale: [0.44, 0.08, 0.44] }));
  g.add(part(G.cyl, mat(C.metal, { roughness: 0.4, metalness: 0.6 }), { pos: [0, 0.8, 0], scale: [0.06, 1.55, 0.06] }));
  const shade = part(G.cone, mat(C.lampShade, { roughness: 0.6, emissive: 0xffe4b0, emissiveIntensity: 0.5 }), { pos: [0, 1.72, 0], scale: [0.78, 0.6, 0.78], rot: [Math.PI, 0, 0] });
  g.add(shade);
  return g;
}

function buildRadio() {
  const lightMaterial = new THREE.MeshStandardMaterial({ color: 0x8ff0b8, emissive: 0x8ff0b8, emissiveIntensity: 0.25, roughness: 0.45 });
  const root = group(
    part(G.box, mat(0x27322d, { roughness: 0.55 }), { pos: [0, 0.45, 0], scale: [1.05, 0.72, 0.38] }),
    part(G.box, lightMaterial, { pos: [0, 0.61, -0.205], scale: [0.32, 0.12, 0.025], cast: false }),
    part(G.box, mat(C.metal, { roughness: 0.45, metalness: 0.5 }), { pos: [0, 0.92, 0], scale: [0.72, 0.05, 0.05], rot: [0, 0, deg(-12)] })
  );
  for (const x of [-0.32, 0.32]) root.add(part(G.cyl, mat(0x151b18, { roughness: 0.7 }), { pos: [x, 0.4, -0.215], scale: [0.22, 0.035, 0.22], rot: [deg(90), 0, 0] }));
  root.userData.music = true;
  const anchor = new THREE.Object3D(); anchor.position.set(0, 1.25, 0); root.add(anchor);
  return { root, anchor, lightMaterial };
}

/* ---------- cena ---------- */
export function createOffice3D({ canvas, overlay, onSelect, onMeeting, onMusic, onMural, onHover, onAvailability } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151d19);
  scene.fog = new THREE.Fog(0x151d19, 26, 62);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);
  const HOME = { azimuth: deg(34), polar: deg(56), radius: 22 };
  const view = { ...HOME };
  const goal = { ...HOME };
  const target = new THREE.Vector3(0, 1.05, 0);
  const LIMIT = { polar: [deg(14), deg(78)], radius: [8, 40] };

  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const textures = Object.fromEntries(['running', 'queued', 'attention', 'resting', 'configure', 'available'].map(k => [k, screenTexture(k, anisotropy)]));

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  scene.add(new THREE.HemisphereLight(0xe4f0d2, 0x3a4430, 1.6));
  const key = new THREE.DirectionalLight(0xfff2da, 2.05);
  key.position.set(10, 15, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -16; key.shadow.camera.right = 16;
  key.shadow.camera.top = 15; key.shadow.camera.bottom = -15;
  key.shadow.camera.near = 2; key.shadow.camera.far = 48;
  key.shadow.bias = -0.0008; key.shadow.normalBias = 0.022;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc6dcff, 0.55);
  fill.position.set(-11, 9, -7);
  scene.add(fill);
  const lampLight = new THREE.PointLight(0xffd9a2, 26, 14, 2);
  lampLight.position.set(-8.1, 1.7, 6);
  scene.add(lampLight);

  scene.add(buildFloor());
  const animatedProps = [];
  const sceneProps = new THREE.Group();
  scene.add(sceneProps);

  const lounge = buildLounge();
  lounge.position.set(-5.4, 0, 6.3);
  lounge.rotation.y = deg(-14);
  sceneProps.add(lounge);
  const lamp = buildLamp();
  lamp.position.set(-8.1, 0, 6);
  sceneProps.add(lamp);
  const radio = buildRadio();
  radio.root.position.set(-7.15, 0, 5.55);
  radio.root.rotation.y = deg(-10);
  sceneProps.add(radio.root);
  const shelf = buildShelf();
  shelf.position.set(8.1, 0, -6.9);
  shelf.rotation.y = deg(-28);
  sceneProps.add(shelf);
  const cooler = buildCooler();
  cooler.position.set(8.6, 0, 6.4);
  cooler.rotation.y = deg(-20);
  sceneProps.add(cooler);
  const meetingHaloMaterial = new THREE.MeshBasicMaterial({ color: 0x8ff0b8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const meeting = group(part(G.cyl, mat(C.wood, { roughness: 0.6 }), { pos: [0, 0.72, 0], scale: [1.7, 0.08, 1.7] }), part(G.cyl, mat(C.woodDark, { roughness: 0.7 }), { pos: [0, 0.36, 0], scale: [0.22, 0.72, 0.22] }), part(G.cyl, mat(C.woodDark, { roughness: 0.7 }), { pos: [0, 0.04, 0], scale: [0.9, 0.08, 0.9] }), part(G.ring, meetingHaloMaterial, { pos: [0, 0.08, 0], scale: [2.1, 2.1, 2.1], rot: [-Math.PI / 2, 0, 0], cast: false, receive: false }));
  meeting.position.set(3.2, 0, -6.6);
  meeting.userData.meeting = true;
  const meetingAnchor = new THREE.Object3D();
  meetingAnchor.position.set(0, 1.45, 0);
  meeting.add(meetingAnchor);
  sceneProps.add(meeting);
  /* Mural de tarefas: a peça vem do Blender (blender/build_mural.py). O grupo entra vazio para a
     cena não depender do download — se o GLB falhar, o escritório continua de pé sem ele. */
  const mural = new THREE.Group();
  mural.position.set(-5.2, 0, -6.55);
  mural.rotation.y = deg(14);
  mural.userData.mural = true;
  const muralAnchor = new THREE.Object3D();
  muralAnchor.position.set(0, 2.2, 0);
  mural.add(muralAnchor);
  sceneProps.add(mural);
  new GLTFLoader().loadAsync('/assets/blender/mural.glb').then((gltf) => {
    gltf.scene.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    mural.add(gltf.scene);
  }).catch(() => { /* sem o mural a cena segue: o painel de tarefas continua acessível pela aba Missões */ });
  for (let i = 0; i < 6; i++) {
    const chair = buildChair(0x6f7c8a);
    const a = deg(30) + (i / 6) * Math.PI * 2;
    chair.position.set(3.2 + Math.sin(a) * 1.72, 0, -6.6 + Math.cos(a) * 1.72);
    chair.rotation.y = a;
    sceneProps.add(chair);
  }
  for (const spec of [[-8.9, -6.8, 1.15, true], [8.9, 1.4, 1, true], [-8.9, 1.2, 0.8, false], [-1.4, -7.4, 0.85, false], [-1.9, 7.6, 0.9, true]]) {
    const plant = buildPlant(spec[2], spec[3]);
    plant.root.position.set(spec[0], 0, spec[1]);
    plant.root.rotation.y = spec[0] * 0.7;
    sceneProps.add(plant.root);
    animatedProps.push(plant.leaves);
  }

  /* ---------- estações ---------- */
  const COLUMNS = [-4.7, 0, 4.7];
  const ROWS = [-3.5, 3.5];
  const stations = new Map();
  const pickables = [];
  pickables.push(meeting);
  pickables.push(radio.root);
  pickables.push(mural);
  const stationsGroup = new THREE.Group();
  const meetingPeopleGroup = new THREE.Group();
  const meetingPeople = new Map();
  const animatedCharacters = new Map();
  const characterLoader = new GLTFLoader();
  scene.add(stationsGroup);
  scene.add(meetingPeopleGroup);

  function playCharacterClips(actor, names) {
    const key = names.join('|');
    if (actor.mode === key) return;
    const next = new Set(names);
    for (const [name, action] of actor.actions) {
      if (next.has(name)) {
        if (!actor.active.has(name)) action.reset().setEffectiveWeight(1).fadeIn(0.22).play();
      } else if (actor.active.has(name)) action.fadeOut(0.18);
    }
    actor.active = next;
    actor.mode = key;
  }

  async function loadCharacter(station, index) {
    try {
      const gltf = await characterLoader.loadAsync('/assets/blender/employee.glb');
      if (!running || !stations.has(station.id) || stations.get(station.id) !== station) return;
      const root = gltf.scene;
      root.name = `animated-${station.id}`;
      root.scale.setScalar(1);
      root.position.set(0, 0, 1.02);
      root.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const look = LOOKS[station.id] || DEFAULT_LOOK;
        if (object.material.name === 'Shirt') object.material.color.copy(station.shirt);
        if (object.material.name === 'Skin') object.material.color.setHex(look.skin);
        if (object.material.name === 'Hair') object.material.color.setHex(look.hair);
      });
      const mixer = new THREE.AnimationMixer(root);
      const actions = new Map(gltf.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
      const actor = { root, mixer, actions, active: new Set(), mode: '' };
      animatedCharacters.set(station.id, actor);
      station.root.add(root);
      station.person.root.visible = false;
      animateCharacter(station, clock.elapsedTime, 0, true);
      if (reduced) restPose();
      invalidate();
    } catch (error) {
      console.error(`Falha ao carregar animação de ${station.id}:`, error);
    }
  }

  function buildStation(employee, index) {
    const look = LOOKS[employee.id] || DEFAULT_LOOK;
    const shirt = new THREE.Color(employee.color || '#8fa3b8').getHex();
    const row = index < 3 ? 0 : 1;
    const g = new THREE.Group();
    g.position.set(COLUMNS[index % 3], 0, ROWS[row]);
    g.rotation.y = row === 0 ? 0 : Math.PI;
    g.userData.employeeId = employee.id;

    g.add(buildDivider());
    g.add(buildDesk());
    const screenMaterial = new THREE.MeshStandardMaterial({ map: textures.available, emissive: 0xffffff, emissiveMap: textures.available, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0 });
    const monitor = buildMonitor(screenMaterial);
    monitor.position.set(-0.15, 0, -0.32);
    monitor.rotation.y = deg(index % 3 === 2 ? -9 : index % 3 === 0 ? 9 : 0);
    g.add(monitor);
    g.add(part(G.box, mat(C.keyboard, { roughness: 0.7 }), { pos: [-0.1, 0.83, 0.46], scale: [0.68, 0.03, 0.22] }));
    g.add(part(G.box, mat(0xcfc7b6, { roughness: 0.7 }), { pos: [-0.1, 0.85, 0.46], scale: [0.62, 0.01, 0.16] }));
    g.add(part(G.sphere, mat(C.mouse, { roughness: 0.6 }), { pos: [0.4, 0.84, 0.3], scale: [0.14, 0.09, 0.2] }));

    if (look.extra === 'mug' || look.extra === 'glasses') {
      g.add(part(G.cyl, mat(C.mug, { roughness: 0.45 }), { pos: [-1.02, 0.88, 0.2], scale: [0.16, 0.19, 0.16] }));
      g.add(part(G.lens, mat(C.mug, { roughness: 0.45 }), { pos: [-1.13, 0.88, 0.2], scale: [0.9, 0.9, 0.9], rot: [0, deg(90), 0] }));
    }
    if (look.extra === 'papers' || look.extra === 'tablet') {
      for (let i = 0; i < 3; i++) g.add(part(G.box, mat(C.paper, { roughness: 0.9 }), { pos: [-1, 0.82 + i * 0.015, 0.16], scale: [0.42, 0.012, 0.3], rot: [0, deg(i * 7 - 7), 0] }));
    }
    if (look.extra === 'tablet') g.add(part(G.box, mat(C.monitor, { roughness: 0.4 }), { pos: [1, 0.86, 0.26], scale: [0.4, 0.03, 0.3], rot: [0, deg(-16), 0] }));
    if (look.extra === 'plant') {
      const desktopPlant = buildPlant(0.34, false);
      desktopPlant.root.position.set(1.02, 0.8, -0.2);
      g.add(desktopPlant.root);
      animatedProps.push(desktopPlant.leaves);
    }
    if (look.extra === 'headphones' || look.extra === 'papers') g.add(part(G.box, mat(C.book, { roughness: 0.85 }), { pos: [1.02, 0.84, 0.3], scale: [0.3, 0.09, 0.4], rot: [0, deg(9), 0] }));
    g.add(part(G.box, mat(0xf2d98a, { roughness: 0.95 }), { pos: [-0.62, 0.79, -0.94], scale: [0.16, 0.16, 0.01], rot: [deg(-4), 0, deg(6)] }));
    g.add(part(G.box, mat(0xa9d7ef, { roughness: 0.95 }), { pos: [-0.42, 0.9, -0.94], scale: [0.15, 0.15, 0.01], rot: [deg(-4), 0, deg(-5)] }));

    const chair = buildChair(shirt);
    chair.position.set(0, 0, 1.14);
    chair.rotation.y = deg(index % 2 ? 5 : -5);
    g.add(chair);

    const person = buildPerson(look, shirt);
    person.root.position.set(0, 0, 1.02);
    g.add(person.root);

    const ringMaterial = new THREE.MeshBasicMaterial({ color: STATUS.available.ring, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    const ring = part(G.ring, ringMaterial, { pos: [0, 0.07, 1.06], rot: [-Math.PI / 2, 0, 0], cast: false, receive: false });
    g.add(ring);

    const anchor = new THREE.Object3D();
    anchor.position.set(0, 2.4, 0);
    person.root.add(anchor);

    stationsGroup.add(g);
    pickables.push(g);
    return {
      id: employee.id, shirt: new THREE.Color(shirt), root: g, person, screenMaterial, ring, ringMaterial, anchor, monitor,
      phase: index * 1.37, index, walkSide: index % 2 ? 1 : -1, statusKey: 'available', hovered: false,
      base: { rootX: person.root.position.x, rootY: person.root.position.y, rootZ: person.root.position.z, head: person.head.position.y, headZ: person.head.position.z, torso: person.torso.position.y, armL: person.armL.rotation.x, armR: person.armR.rotation.x, handL: person.handL.position.y, handR: person.handR.position.y }
    };
  }

  /* ---------- etiquetas e balões ancorados em 3D ---------- */
  const tags = new Map();
  function buildTag(employee) {
    const el = document.createElement('div');
    el.className = 'tag';
    const bubble = document.createElement('span');
    bubble.className = 'tag-bubble';
    bubble.hidden = true;
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'tag-name';
    name.tabIndex = -1;
    name.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('i');
    const who = document.createElement('b');
    who.textContent = employee.name;
    const status = document.createElement('small');
    name.append(dot, who, status);
    name.addEventListener('click', () => onSelect && onSelect(employee.id));
    el.append(bubble, name);
    overlay.append(el);
    return { el, bubble, name, dot, status, last: '' };
  }

  const meetingTag = document.createElement('button');
  meetingTag.type = 'button';
  meetingTag.className = 'meeting-tag';
  meetingTag.setAttribute('aria-label', 'Abrir mesa de reunião da equipe');
  meetingTag.innerHTML = '<b>◎</b><span>Mesa de reunião<small>Reunir equipe</small></span>';
  meetingTag.addEventListener('click', () => onMeeting && onMeeting());
  overlay.append(meetingTag);
  const musicTag = document.createElement('button');
  musicTag.type = 'button'; musicTag.className = 'music-tag';
  musicTag.setAttribute('aria-label', 'Abrir rádio Spotify do escritório');
  musicTag.innerHTML = '<b>♫</b><span>Rádio do escritório<small>Abrir Spotify</small></span>';
  musicTag.addEventListener('click', () => onMusic && onMusic());
  overlay.append(musicTag);
  const muralTag = document.createElement('button');
  muralTag.type = 'button'; muralTag.className = 'mural-tag';
  muralTag.setAttribute('aria-label', 'Abrir o mural de tarefas do escritório');
  muralTag.innerHTML = '<b>▦</b><span>Mural de tarefas<small>Ver o quadro</small></span>';
  muralTag.addEventListener('click', () => onMural && onMural());
  overlay.append(muralTag);
  let musicActive = false;

  let meetingSignature = '';
  function updateMeeting(data, employees) {
    const participants = data && Array.isArray(data.participants) ? data.participants.slice(0, 6) : [];
    const signature = participants.join('|');
    if (signature !== meetingSignature) {
      meetingPeopleGroup.clear(); meetingPeople.clear();
      for (const station of stations.values()) {
        station.person.root.visible = !animatedCharacters.has(station.id);
        station.ring.visible = true;
      }
      participants.forEach((id, index) => {
        const employee = employees.find(item => item.id === id), station = stations.get(id);
        if (!employee || !station) return;
        station.person.root.visible = false; station.ring.visible = false;
        const actor = animatedCharacters.get(id); if (actor) actor.root.visible = false;
        const person = buildPerson(LOOKS[id] || DEFAULT_LOOK, new THREE.Color(employee.color || '#8fa3b8').getHex());
        const angle = deg(30) + (index / Math.max(participants.length, 2)) * Math.PI * 2;
        person.root.position.set(3.2 + Math.sin(angle) * 1.48, 0, -6.6 + Math.cos(angle) * 1.48);
        person.root.rotation.y = angle;
        const anchor = new THREE.Object3D(); anchor.position.set(0, 2.35, 0); person.root.add(anchor);
        meetingPeopleGroup.add(person.root); meetingPeople.set(id, { person, anchor });
      });
      meetingSignature = signature;
    }
    const active = !!data?.active;
    meetingHaloMaterial.opacity = active ? 0.72 : participants.length ? 0.42 : 0.22;
    meetingTag.dataset.active = active ? 'true' : 'false';
    meetingTag.querySelector('small').textContent = active ? 'Conversa em andamento' : participants.length ? 'Ver conversa' : 'Reunir equipe';
  }

  const tmp = new THREE.Vector3();
  function updateTags() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    for (const [id, tag] of tags) {
      const station = stations.get(id);
      if (!station) continue;
      (meetingPeople.get(id)?.anchor || station.anchor).getWorldPosition(tmp);
      const distance = tmp.distanceTo(camera.position);
      tmp.project(camera);
      const x = Math.round((tmp.x * 0.5 + 0.5) * width);
      const y = Math.round((-tmp.y * 0.5 + 0.5) * height);
      const scale = clamp(20 / Math.max(distance, 1), 0.6, 1.15);
      const transform = `translate(-50%,-100%) translate(${x}px,${y}px) scale(${scale.toFixed(2)})`;
      if (tag.last !== transform) { tag.el.style.transform = transform; tag.last = transform; }
      tag.el.style.opacity = tmp.z < 1 ? '1' : '0';
      tag.el.style.zIndex = String(clamp(Math.round(3000 - distance * 40), 1, 3000));
    }
    meetingAnchor.getWorldPosition(tmp);
    const meetingDistance = tmp.distanceTo(camera.position);
    tmp.project(camera);
    const meetingX = Math.round((tmp.x * 0.5 + 0.5) * width);
    const meetingY = Math.round((-tmp.y * 0.5 + 0.5) * height);
    meetingTag.style.transform = `translate(-50%,-100%) translate(${meetingX}px,${meetingY}px)`;
    meetingTag.style.opacity = tmp.z < 1 ? '1' : '0';
    meetingTag.style.zIndex = String(clamp(Math.round(3000 - meetingDistance * 40), 1, 3000));
    radio.anchor.getWorldPosition(tmp);
    const radioDistance = tmp.distanceTo(camera.position);
    tmp.project(camera);
    const radioX = Math.round((tmp.x * 0.5 + 0.5) * width), radioY = Math.round((-tmp.y * 0.5 + 0.5) * height);
    musicTag.style.transform = `translate(-50%,-100%) translate(${radioX}px,${radioY}px)`;
    musicTag.style.opacity = tmp.z < 1 ? '1' : '0';
    musicTag.style.zIndex = String(clamp(Math.round(3000 - radioDistance * 40), 1, 3000));
    muralAnchor.getWorldPosition(tmp);
    const muralDistance = tmp.distanceTo(camera.position);
    tmp.project(camera);
    const muralX = Math.round((tmp.x * 0.5 + 0.5) * width), muralY = Math.round((-tmp.y * 0.5 + 0.5) * height);
    muralTag.style.transform = `translate(-50%,-100%) translate(${muralX}px,${muralY}px)`;
    muralTag.style.opacity = tmp.z < 1 ? '1' : '0';
    muralTag.style.zIndex = String(clamp(Math.round(3000 - muralDistance * 40), 1, 3000));
  }

  /* ---------- câmera ---------- */
  function applyCamera() {
    const sin = Math.sin(view.polar), cos = Math.cos(view.polar);
    camera.position.set(target.x + view.radius * sin * Math.sin(view.azimuth), target.y + view.radius * cos, target.z + view.radius * sin * Math.cos(view.azimuth));
    camera.lookAt(target);
  }
  function clampGoal() {
    goal.polar = clamp(goal.polar, LIMIT.polar[0], LIMIT.polar[1]);
    goal.radius = clamp(goal.radius, LIMIT.radius[0], LIMIT.radius[1]);
  }
  function stepCamera(dt) {
    if (reduced) {
      const changed = Math.abs(goal.azimuth - view.azimuth) + Math.abs(goal.polar - view.polar) + Math.abs(goal.radius - view.radius) > 1e-4;
      Object.assign(view, goal);
      if (changed) applyCamera();
      return changed;
    }
    const k = 1 - Math.exp(-dt * 11);
    const delta = Math.abs(goal.azimuth - view.azimuth) + Math.abs(goal.polar - view.polar) + Math.abs(goal.radius - view.radius);
    if (delta < 0.0004) { if (delta > 0) { Object.assign(view, goal); applyCamera(); return true; } return false; }
    view.azimuth += (goal.azimuth - view.azimuth) * k;
    view.polar += (goal.polar - view.polar) * k;
    view.radius += (goal.radius - view.radius) * k;
    applyCamera();
    return true;
  }
  function camera_(action) {
    if (action === 'left') goal.azimuth += deg(22);
    else if (action === 'right') goal.azimuth -= deg(22);
    else if (action === 'up') goal.polar -= deg(8);
    else if (action === 'down') goal.polar += deg(8);
    else if (action === 'in') goal.radius *= 0.84;
    else if (action === 'out') goal.radius *= 1.19;
    else if (action === 'reset') Object.assign(goal, HOME);
    clampGoal();
    invalidate();
  }

  /* ---------- interação ---------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointers = new Map();
  let dragging = false, moved = 0, lastX = 0, lastY = 0, pinch = 0;
  let hovered = null;
  let reduced = false;
  let active = true;
  let running = true;
  let dirty = true;
  const invalidate = () => { dirty = true; };

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData.employeeId && !node.userData.meeting && !node.userData.music && !node.userData.mural) node = node.parent;
      if (node?.userData.employeeId) return node.userData.employeeId;
      if (node?.userData.meeting) return '__meeting__';
      if (node?.userData.music) return '__music__';
      if (node?.userData.mural) return '__mural__';
    }
    return null;
  }
  function setHovered(id) {
    if (hovered === id) return;
    hovered = id;
    for (const station of stations.values()) {
      const on = station.id === id;
      if (station.hovered === on) continue;
      station.hovered = on;
      station.ringMaterial.opacity = on ? 0.85 : 0.38;
      station.ring.scale.setScalar(on ? 1.1 : 1);
      const tag = tags.get(station.id);
      if (tag) tag.el.classList.toggle('is-active', on);
    }
    canvas.style.cursor = id ? 'pointer' : 'grab';
    invalidate();
    if (onHover) onHover(id);
  }

  function onPointerDown(event) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) { dragging = true; moved = 0; lastX = event.clientX; lastY = event.clientY; canvas.style.cursor = 'grabbing'; }
    if (pointers.size === 2) { dragging = false; pinch = pinchDistance(); }
    if (canvas.setPointerCapture && event.isPrimary) { try { canvas.setPointerCapture(event.pointerId); } catch { /* captura indisponível */ } }
  }
  function pinchDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function onPointerMove(event) {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const distance = pinchDistance();
      if (pinch > 0 && distance > 0) { goal.radius *= pinch / distance; clampGoal(); invalidate(); }
      pinch = distance;
      return;
    }
    if (dragging) {
      const dx = event.clientX - lastX, dy = event.clientY - lastY;
      lastX = event.clientX; lastY = event.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      goal.azimuth -= dx * 0.006;
      goal.polar -= dy * 0.005;
      clampGoal();
      invalidate();
      return;
    }
    if (event.pointerType === 'mouse') { const hit = pick(event); setHovered(hit?.startsWith?.('__') ? null : hit); if (hit?.startsWith?.('__')) canvas.style.cursor = 'pointer'; }
  }
  function onPointerUp(event) {
    const wasDragging = dragging;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (pointers.size === 0) { dragging = false; canvas.style.cursor = hovered ? 'pointer' : 'grab'; }
    if (wasDragging && moved < 6 && event.type === 'pointerup') {
      const id = pick(event);
      if (id === '__meeting__' && onMeeting) onMeeting();
      else if (id === '__music__' && onMusic) onMusic();
      else if (id === '__mural__' && onMural) onMural();
      else if (id && onSelect) onSelect(id);
      if (event.pointerType !== 'mouse') setHovered(null);
    }
  }
  function onPointerLeave() {
    pointers.clear(); dragging = false; pinch = 0;
    setHovered(null);
  }
  function onWheel(event) {
    event.preventDefault();
    goal.radius *= Math.exp(clamp(event.deltaY, -120, 120) * 0.0014);
    clampGoal();
    invalidate();
  }
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', '+': 'in', '=': 'in', '-': 'out', _: 'out', 0: 'reset' };
  function onKeyDown(event) {
    const action = KEYS[event.key];
    if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    camera_(action);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);
  canvas.style.cursor = 'grab';

  /* ---------- redimensionamento ---------- */
  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width / height < 1 ? 42 : width < 760 ? 36 : 30;
    camera.updateProjectionMatrix();
    invalidate();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(canvas);
  else window.addEventListener('resize', resize);

  /* ---------- movimento reduzido ---------- */
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  function applyMotion() {
    reduced = motionQuery.matches;
    if (reduced) restPose();
    invalidate();
  }
  const onMotionChange = () => applyMotion();
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
  else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);

  function restPose() {
    for (const station of stations.values()) animateCharacter(station, 0, 0, true);
    for (const leaves of animatedProps) leaves.rotation.z = 0;
  }

  const avatarPosition = new THREE.Vector3();
  const avatarRotation = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  function animateCharacter(station, time, dt, immediate = false) {
    const actor = animatedCharacters.get(station.id);
    if (!actor) return;
    const attendance = meetingPeople.get(station.id);
    const pose = officeMotion(time, station.index, station.statusKey, reduced);
    // Um mesmo esqueleto atende todos os estados, inclusive sono e reunião.
    station.person.root.visible = false;
    actor.root.visible = true;
    if (attendance) {
      attendance.person.root.visible = false;
      attendance.person.root.getWorldPosition(avatarPosition);
      station.root.worldToLocal(avatarPosition);
      actor.root.position.copy(avatarPosition);
      pose.yaw = attendance.person.root.rotation.y - station.root.rotation.y;
      pose.clip = station.statusKey === 'resting' ? 'sleep' : 'sit';
      pose.clipTime = undefined;
    } else {
      actor.root.position.set(pose.x, 0, pose.z);
    }
    avatarRotation.setFromAxisAngle(upAxis, pose.yaw);
    if (immediate || station.statusKey !== 'available' || pose.clip === 'sit') actor.root.quaternion.copy(avatarRotation);
    else actor.root.quaternion.slerp(avatarRotation, 1 - Math.exp(-dt * 12));
    playCharacterClips(actor, [pose.clip]);
    const action = actor.actions.get(pose.clip);
    if (action) {
      action.paused = reduced || pose.clipTime !== undefined;
      if (pose.clipTime !== undefined) action.time = Math.min(pose.clipTime, action.getClip().duration - .001);
      if (immediate || reduced) {
        for (const [name, other] of actor.actions) {
          other.stopFading(); other.setEffectiveWeight(name === pose.clip ? 1 : 0);
        }
      }
    }
    actor.mixer.update(reduced ? 0 : dt);
    station.person.root.position.copy(actor.root.position);
    station.person.root.rotation.y = pose.yaw;
    station.anchor.position.y = pose.clip === 'sleep' ? 1.42 : ['sit','type'].includes(pose.clip) ? 1.72 : 1.98;
    if (attendance) attendance.anchor.position.y = 1.72;
    station.screenMaterial.emissiveIntensity = STATUS[station.statusKey].glow;
  }

  function animate(time, dt) {
    for (const station of stations.values()) animateCharacter(station, time, dt);
    for (let i = 0; i < animatedProps.length; i++) animatedProps[i].rotation.z = Math.sin(time * .5 + i) * .012;
    radio.lightMaterial.emissiveIntensity = musicActive ? .75 + Math.sin(time * 8) * .45 : .12;
  }

  /* ---------- laço de render ---------- */
  const clock = new THREE.Clock();
  function renderNow() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.render(scene, camera);
    updateTags();
    dirty = false;
  }
  function frame() {
    if (!running || !active || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    const cameraMoved = stepCamera(dt);
    if (reduced) {
      if (!dirty && !cameraMoved) return;
    } else {
      animate(clock.elapsedTime, dt);
    }
    renderNow();
  }
  const onVisibility = () => { clock.getDelta(); invalidate(); };
  document.addEventListener('visibilitychange', onVisibility);

  const onContextLost = event => {
    event.preventDefault(); running = false;
    if (onAvailability) onAvailability(false, 'O navegador perdeu o contexto WebGL desta aba');
  };
  const onContextRestored = () => {
    running = true; clock.getDelta(); invalidate();
    if (onAvailability) onAvailability(true);
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  /* ---------- atualização de estado ---------- */
  let roster = '';
  function update(data) {
    const list = data && Array.isArray(data.employees) ? data.employees : [];
    if (!list.length) return;
    const signature = list.map(e => e.id).join('|');
    if (signature !== roster) {
      for (const station of stations.values()) { stationsGroup.remove(station.root); station.screenMaterial.dispose(); station.ringMaterial.dispose(); }
      for (const actor of animatedCharacters.values()) actor.mixer.stopAllAction();
      animatedCharacters.clear();
      for (const tag of tags.values()) tag.el.remove();
      stations.clear(); tags.clear(); pickables.length = 0;
      pickables.push(meeting, radio.root);
      list.slice(0, 6).forEach((employee, index) => {
        const station = buildStation(employee, index);
        stations.set(employee.id, station);
        void loadCharacter(station, index);
        tags.set(employee.id, buildTag(employee));
      });
      roster = signature;
      applyCamera();
    }
    for (const employee of list) {
      const station = stations.get(employee.id);
      const tag = tags.get(employee.id);
      if (!station || !tag) continue;
      const statusKey = STATUS[employee.statusKey] ? employee.statusKey : 'available';
      if (station.statusKey !== statusKey) {
        station.statusKey = statusKey;
        const status = STATUS[statusKey];
        station.screenMaterial.map = textures[status.screen];
        station.screenMaterial.emissiveMap = textures[status.screen];
        station.screenMaterial.emissiveIntensity = status.glow;
        station.screenMaterial.needsUpdate = true;
        station.ringMaterial.color.setHex(status.ring);
      }
      tag.el.dataset.status = statusKey;
      tag.status.textContent = employee.statusLabel || '';
      tag.name.setAttribute('aria-label', `${employee.name}: ${employee.statusLabel || ''}`);
      const bubble = employee.bubble || '';
      if (bubble) { tag.bubble.textContent = bubble; tag.bubble.hidden = false; }
      else { tag.bubble.textContent = ''; tag.bubble.hidden = true; }
    }
    updateMeeting(data?.meeting, list);
    if (reduced) restPose();
    musicActive = !!data?.music?.on;
    musicTag.dataset.active = musicActive ? 'true' : 'false';
    musicTag.querySelector('small').textContent = musicActive ? `${data.music.dj} · ${data.music.title}` : 'Abrir Spotify';
    invalidate();
    renderNow();
  }

  applyMotion();
  applyCamera();
  resize();
  renderer.setAnimationLoop(frame);

  return {
    update,
    camera: camera_,
    highlight: id => setHovered(id || null),
    setActive(value) {
      active = !!value;
      if (active) { clock.getDelta(); resize(); invalidate(); renderNow(); }
    },
    dispose() {
      running = false;
      renderer.setAnimationLoop(null);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      document.removeEventListener('visibilitychange', onVisibility);
      if (observer) observer.disconnect(); else window.removeEventListener('resize', resize);
      if (motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
      else if (motionQuery.removeListener) motionQuery.removeListener(onMotionChange);
      for (const tag of tags.values()) tag.el.remove();
      meetingTag.remove();
      musicTag.remove();
      tags.clear();
      for (const station of stations.values()) { station.screenMaterial.dispose(); station.ringMaterial.dispose(); }
      for (const actor of animatedCharacters.values()) actor.mixer.stopAllAction();
      animatedCharacters.clear();
      stations.clear();
      for (const texture of Object.values(textures)) texture.dispose();
      /* Geometrias e materiais de C/G são compartilhados entre instâncias: quem libera
         a memória de GPU aqui é o descarte do contexto do renderizador. */
      renderer.dispose();
    }
  };
}
