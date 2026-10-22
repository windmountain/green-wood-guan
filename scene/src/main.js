import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

import { buildHeightField, terrainMask, inCemetery, ridgelines, gridLines, contours, gridPoints } from './terrain.js';
import { defaults, loadSettings, saveSettings, clearSettings } from './settings.js';
import { startRecording } from './recorder.js';

// Output frame: vertical 1080p. The canvas always renders at exactly this
// size; CSS only scales it down to fit the window.
const WIDTH = 1080;
const HEIGHT = 1920;
const RESOLUTION = new THREE.Vector2(WIDTH, HEIGHT);

// Spacing (feet) when densifying paths so they follow the terrain between
// their original vertices.
const DRAPE_STEP = 15;

const s = loadSettings();

// ---------------------------------------------------------------- data

const data = await (await fetch(`${import.meta.env.BASE_URL}greenwood.json`)).json();

// The export puts the cemetery's bounding-box center at the origin.
const center = { x: 0, y: 0 };

// ---------------------------------------------------------------- three

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(s.fov, WIDTH / HEIGHT, 10, 200000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.setPixelRatio(1);
composer.setSize(WIDTH, HEIGHT);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(RESOLUTION.clone(), s.bloomStrength, s.bloomRadius, s.bloomThreshold);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function lineMaterial(vertexColors = false) {
  return new LineMaterial({
    linewidth: 1,
    resolution: RESOLUTION,
    transparent: true,
    depthWrite: false,
    vertexColors,
    fog: true,
  });
}

const materials = {
  terrain: lineMaterial(true),
  terrainPoints: new THREE.PointsMaterial({ vertexColors: true, sizeAttenuation: false, transparent: true, depthWrite: false }),
  occluder: new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
  paths: lineMaterial(),
  route: lineMaterial(true),
  walker: new THREE.MeshBasicMaterial(),
};

const walker = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), materials.walker);
scene.add(walker);

// Built by rebuild*(); replaced wholesale when settings change.
const built = { terrain: null, occluder: null, paths: null, route: null };
let field;
let mask;
let routeTrack; // { cum: Float32Array, points: [[x, y, ...], ...], total }

// ---------------------------------------------------------------- building

function toWorld(x, y, elevation, lift = 0) {
  return [x - center.x, (elevation - field.min) * s.exaggeration + lift, -(y - center.y)];
}

function replace(key, object) {
  if (built[key]) {
    scene.remove(built[key]);
    built[key].geometry.dispose();
  }
  built[key] = object;
  if (object) scene.add(object);
}

function segments(flat, material, colors) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(flat);
  if (colors) geometry.setColors(colors);
  return new LineSegments2(geometry, material);
}

// Low→high color by elevation, fading to the background over the outer
// `edgeFade` fraction of the terrain radius. `flat` is [x, y, e, ...].
function terrainColors(flat) {
  const hue = s.terrainHue / 360;
  const low = new THREE.Color().setHSL(hue, s.lowSaturation, s.lowLightness, THREE.SRGBColorSpace);
  const high = new THREE.Color().setHSL(hue, s.highSaturation, s.highLightness, THREE.SRGBColorSpace);
  const bg = new THREE.Color(s.background);
  const c = new THREE.Color();
  const fadeFrom = s.terrainRadius * (1 - s.edgeFade);
  const out = new Float32Array(flat.length);
  for (let k = 0; k < flat.length; k += 3) {
    const [x, y, e] = [flat[k], flat[k + 1], flat[k + 2]];
    c.copy(low).lerp(high, (e - field.min) / (field.max - field.min || 1));
    const r = Math.hypot(x - center.x, y - center.y);
    if (r > fadeFrom) c.lerp(bg, Math.min(1, (r - fadeFrom) / (s.terrainRadius - fadeFrom || 1)));
    out.set([c.r, c.g, c.b], k);
  }
  return out;
}

// Split a polyline into ≤DRAPE_STEP pieces and lift every point onto the
// terrain. Returns [[x, y, elevation], ...].
function drape(line) {
  const out = [];
  for (let k = 0; k < line.length - 1; k++) {
    const [x1, y1] = line[k];
    const [x2, y2] = line[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / DRAPE_STEP));
    for (let t = 0; t < steps; t++) {
      const x = x1 + ((x2 - x1) * t) / steps;
      const y = y1 + ((y2 - y1) * t) / steps;
      out.push([x, y, field.sample(x, y)]);
    }
  }
  const [x, y] = line[line.length - 1];
  out.push([x, y, field.sample(x, y)]);
  return out;
}

function polylineSegments(points, lift) {
  const flat = [];
  for (let k = 0; k < points.length - 1; k++) {
    flat.push(...toWorld(...points[k], lift), ...toWorld(...points[k + 1], lift));
  }
  return flat;
}

function rebuildField() {
  const r = s.terrainRadius;
  field = buildHeightField(
    data.elevation,
    { minX: center.x - r, maxX: center.x + r, minY: center.y - r, maxY: center.y + r },
    {
      cellSize: s.cellSize,
      power: s.idwPower,
      smoothing: s.smoothing,
      maxGap: s.maxGap,
      alwaysFill: (x, y) => inCemetery(x, y, data.boundary, 200),
    },
  );
  mask = terrainMask(field, {
    cx: center.x,
    cy: center.y,
    radius: r,
    rings: s.clipToBoundary ? data.boundary : null,
    margin: s.clipMargin,
  });
}

function rebuildTerrain() {
  const style = s.terrainStyle;
  if (style === 'points') {
    const flat = gridPoints(field, mask, { every: s.lineEvery });
    const positions = [];
    for (let k = 0; k < flat.length; k += 3) positions.push(...toWorld(flat[k], flat[k + 1], flat[k + 2]));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(terrainColors(flat), 3));
    replace('terrain', new THREE.Points(geometry, materials.terrainPoints));
  } else if (style === 'none') {
    replace('terrain', null);
  } else {
    const flat =
      style === 'contours' ? contours(field, mask, { interval: s.contourInterval })
      : style === 'grid' ? gridLines(field, mask, { every: s.lineEvery })
      : ridgelines(field, mask, { every: s.lineEvery, axis: s.ridgeAxis });
    const positions = [];
    for (let k = 0; k < flat.length; k += 3) positions.push(...toWorld(flat[k], flat[k + 1], flat[k + 2]));
    replace('terrain', positions.length ? segments(positions, materials.terrain, terrainColors(flat)) : null);
  }

  // Invisible (background-colored) surface that hides lines behind hills.
  const positions = [];
  const index = [];
  for (let j = 0; j < field.ny; j++) {
    for (let i = 0; i < field.nx; i++) {
      positions.push(...toWorld(field.xAt(i), field.yAt(j), field.valid(i, j) ? field.at(i, j) : field.min));
      if (i < field.nx - 1 && j < field.ny - 1 && field.valid(i, j) && field.valid(i + 1, j) && field.valid(i, j + 1) && field.valid(i + 1, j + 1)) {
        const a = j * field.nx + i;
        index.push(a, a + field.nx, a + 1, a + 1, a + field.nx, a + field.nx + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  replace('occluder', new THREE.Mesh(geometry, materials.occluder));
}

function rebuildPaths() {
  const flat = data.paths.flatMap((line) => polylineSegments(drape(line), s.pathLift));
  replace('paths', segments(flat, materials.paths));
}

function rebuildRoute() {
  const routeColor = new THREE.Color(s.routeColor);
  const retraceColor = new THREE.Color(s.retraceColor);
  const positions = [];
  const colors = [];
  const points = [];
  const cum = [];
  let total = 0;
  for (const stop of data.route) {
    const draped = drape(stop.p);
    const c = stop.r ? retraceColor : routeColor;
    for (let k = 0; k < draped.length - 1; k++) {
      const a = draped[k];
      const b = draped[k + 1];
      positions.push(...toWorld(...a, s.routeLift), ...toWorld(...b, s.routeLift));
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum.push(total);
      points.push(a);
    }
  }
  // points[k] is segment k's start; stops chain end-to-start, so this
  // final end closes the list.
  points.push(data.route.at(-1).p.at(-1));
  routeTrack = { cum: Float32Array.from(cum), points, total };
  replace('route', segments(positions, materials.route, colors));
}

function rebuildAll() {
  rebuildTerrain();
  rebuildPaths();
  rebuildRoute();
}

rebuildField();
rebuildAll();

// ---------------------------------------------------------------- animation

// Seconds for one full lap of the route at the walker's speed.
function lapTime() {
  return routeTrack.total / 5280 / s.walkerSpeed;
}

// How far along one lap (0–1) the walker is: it starts `walkerOffset`
// miles in at routeStart, walks at a constant `walkerSpeed`, and loops
// back to the start whenever it finishes.
function routeProgress() {
  const walked = (s.walkerOffset + s.walkerSpeed * Math.max(0, s.time - s.routeStart)) * 5280;
  const total = routeTrack.total;
  return (((walked % total) + total) % total) / total;
}

// Show the route up to `progress` (0–1) and return the walker's world position.
function updateRoute(progress) {
  const { cum, points, total } = routeTrack;
  const target = progress * total;
  // first segment whose cumulative end is past target
  let lo = 0;
  let hi = cum.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const k = Math.min(lo, cum.length - 1);
  built.route.geometry.instanceCount = progress >= 1 ? cum.length : k;
  const segStart = k === 0 ? 0 : cum[k - 1];
  const f = Math.min(1, Math.max(0, (target - segStart) / (cum[k] - segStart || 1)));
  const a = points[k];
  const b = points[k + 1] ?? a;
  const x = a[0] + (b[0] - a[0]) * f;
  const y = a[1] + (b[1] - a[1]) * f;
  return new THREE.Vector3(...toWorld(x, y, field.sample(x, y), s.routeLift));
}

const background = new THREE.Color();
const fog = new THREE.Fog(background);
fog.color = background;
scene.background = background;

function applyLook() {
  background.set(s.background);
  fog.near = s.fogNear;
  fog.far = s.fogFar;
  scene.fog = s.fog ? fog : null;
  materials.occluder.color.set(s.background);
  if (built.occluder) built.occluder.visible = s.occlude;

  Object.assign(materials.terrain, { linewidth: s.terrainWidth, opacity: s.terrainOpacity });
  Object.assign(materials.terrainPoints, { size: s.pointSize, opacity: s.terrainOpacity });
  Object.assign(materials.paths, { linewidth: s.pathWidth, opacity: s.pathOpacity });
  materials.paths.color.set(s.pathColor);
  Object.assign(materials.route, { linewidth: s.routeWidth, opacity: s.routeOpacity });
  materials.walker.color.set(s.walkerColor);

  if (built.paths) built.paths.visible = s.showPaths;
  if (built.route) built.route.visible = s.showRoute;

  bloomPass.enabled = s.bloom;
  bloomPass.strength = s.bloomStrength;
  bloomPass.radius = s.bloomRadius;
  bloomPass.threshold = s.bloomThreshold;

  if (camera.fov !== s.fov) {
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
  }
}

function cameraTarget(walkerPos) {
  return new THREE.Vector3(0, s.targetHeight, 0).lerp(walkerPos, s.followWalker);
}

function updateCamera(walkerPos) {
  controls.enabled = s.freeCamera;
  if (s.freeCamera) {
    controls.update();
    return;
  }
  const az = THREE.MathUtils.degToRad(s.azimuthStart + s.orbitDegrees * (s.time / s.duration));
  const el = THREE.MathUtils.degToRad(s.elevationAngle);
  const target = cameraTarget(walkerPos);
  camera.position.set(
    target.x + s.distance * Math.cos(el) * Math.sin(az),
    target.y + s.distance * Math.sin(el),
    target.z + s.distance * Math.cos(el) * Math.cos(az),
  );
  camera.lookAt(target);
}

let stopRecording = null;
const recIndicator = document.getElementById('rec');

function render() {
  applyLook();
  const walkerPos = updateRoute(routeProgress());
  walker.position.copy(walkerPos);
  walker.scale.setScalar(s.walkerSize);
  walker.visible = s.showWalker && s.time >= s.routeStart;
  updateCamera(walkerPos);
  composer.render();
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (s.playing) {
    s.time += dt;
    if (s.time >= s.duration) {
      if (stopRecording) {
        s.time = s.duration;
        s.playing = false;
        stopRecording();
        stopRecording = null;
        recIndicator.hidden = true;
      } else if (s.loop) {
        s.time %= s.duration;
      } else {
        s.time = s.duration;
        s.playing = false;
      }
    }
  }
  render();
});

// ---------------------------------------------------------------- GUI

const gui = new GUI({ title: 'Green-Wood 3D' });
gui.onFinishChange(() => saveSettings(s));

const actions = {
  restart() {
    s.time = 0;
    s.playing = true;
  },
  record() {
    if (stopRecording) return;
    s.time = 0;
    s.playing = true;
    stopRecording = startRecording(renderer.domElement, { fps: s.recordFps, mbps: s.recordMbps });
    recIndicator.hidden = false;
  },
  stopRecord() {
    if (!stopRecording) return;
    stopRecording();
    stopRecording = null;
    recIndicator.hidden = true;
  },
  snapshot() {
    render();
    renderer.domElement.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `green-wood-${s.time.toFixed(2)}s.png`;
      a.click();
    });
  },
  copySettings() {
    const { playing, time, ...rest } = s;
    navigator.clipboard.writeText(JSON.stringify(rest, null, 2));
  },
  reset() {
    clearSettings();
    location.reload();
  },
};

const play = gui.addFolder('Playback');
play.add(s, 'playing').listen();
play.add(s, 'time', 0, 120, 0.01).listen();
play.add(s, 'duration', 1, 120, 0.5);
play.add(s, 'loop');
play.add(s, 'routeStart', 0, 120, 0.1).name('route start (s)');
play.add(s, 'walkerSpeed', 0, 1, 0.01).name('walker mi / s');
play.add(s, 'walkerOffset', 0, 40, 0.01).name('walker offset mi');
const routeInfo = {
  get lap() {
    return Number(lapTime().toFixed(2));
  },
};
play.add(routeInfo, 'lap').name('lap time (s)').disable().listen();
play.add(actions, 'restart');

const cam = gui.addFolder('Camera');
cam.add(s, 'freeCamera').name('free (drag/scroll)').onChange((free) => {
  if (free) controls.target.copy(cameraTarget(walker.position));
});
cam.add(s, 'fov', 10, 90, 1);
cam.add(s, 'distance', 1000, 30000, 10);
cam.add(s, 'elevationAngle', 0, 90, 0.5).name('elevation °');
cam.add(s, 'azimuthStart', -360, 360, 1).name('azimuth start °');
cam.add(s, 'orbitDegrees', -360, 360, 1).name('orbit ° / duration');
cam.add(s, 'targetHeight', -2000, 2000, 10).name('target height');
cam.add(s, 'followWalker', 0, 1, 0.01).name('follow walker');

const ter = gui.addFolder('Terrain');
ter.add(s, 'terrainStyle', ['ridgelines', 'contours', 'grid', 'points', 'none']).name('style').onChange(rebuildTerrain);
ter.add(s, 'exaggeration', 0, 20, 0.1).onChange(rebuildAll);
ter.add(s, 'lineEvery', 1, 10, 1).name('line every N').onChange(rebuildTerrain);
ter.add(s, 'ridgeAxis', ['x', 'y']).name('ridge axis').onChange(rebuildTerrain);
ter.add(s, 'contourInterval', 2, 50, 1).name('contour ft').onChange(rebuildTerrain);
ter.add(s, 'occlude').name('hide lines behind hills');
ter.add(s, 'terrainWidth', 0.5, 8, 0.1).name('width');
ter.add(s, 'pointSize', 1, 12, 0.5).name('point size');
ter.add(s, 'terrainOpacity', 0, 1, 0.01).name('opacity');
ter.add(s, 'terrainHue', 0, 360, 1).name('hue').onChange(rebuildTerrain);
ter.add(s, 'lowSaturation', 0, 1, 0.01).name('low saturation').onChange(rebuildTerrain);
ter.add(s, 'lowLightness', 0, 1, 0.01).name('low lightness').onChange(rebuildTerrain);
ter.add(s, 'highSaturation', 0, 1, 0.01).name('high saturation').onChange(rebuildTerrain);
ter.add(s, 'highLightness', 0, 1, 0.01).name('high lightness').onChange(rebuildTerrain);
ter.add(s, 'edgeFade', 0, 1, 0.01).name('edge fade').onChange(rebuildTerrain);
const interp = ter.addFolder('Interpolation (slow)').close();
const refield = () => {
  rebuildField();
  rebuildAll();
};
interp.add(s, 'terrainRadius', 3000, 11000, 100).name('radius ft').onFinishChange(refield);
interp.add(s, 'cellSize', 15, 150, 1).name('cell ft').onFinishChange(refield);
interp.add(s, 'maxGap', 50, 2000, 10).name('max data gap ft').onFinishChange(refield);
interp.add(s, 'idwPower', 1, 6, 0.1).name('IDW power').onFinishChange(refield);
interp.add(s, 'smoothing', 0, 20, 1).onFinishChange(refield);
interp.add(s, 'clipToBoundary').name('clip to cemetery').onFinishChange(refield);
interp.add(s, 'clipMargin', 0, 1000, 10).name('clip margin ft').onFinishChange(refield);

const pth = gui.addFolder('Paths');
pth.add(s, 'showPaths').name('show');
pth.add(s, 'pathWidth', 0.5, 8, 0.1).name('width');
pth.add(s, 'pathOpacity', 0, 1, 0.01).name('opacity');
pth.addColor(s, 'pathColor').name('color');
pth.add(s, 'pathLift', 0, 100, 1).name('lift ft').onChange(rebuildPaths);

const rte = gui.addFolder('Route');
rte.add(s, 'showRoute').name('show');
rte.add(s, 'routeWidth', 0.5, 12, 0.1).name('width');
rte.add(s, 'routeOpacity', 0, 1, 0.01).name('opacity');
rte.addColor(s, 'routeColor').name('color').onChange(rebuildRoute);
rte.addColor(s, 'retraceColor').name('retrace color').onChange(rebuildRoute);
rte.add(s, 'routeLift', 0, 100, 1).name('lift ft').onChange(rebuildRoute);
rte.add(s, 'showWalker').name('walker');
rte.add(s, 'walkerSize', 1, 200, 1).name('walker size');
rte.addColor(s, 'walkerColor').name('walker color');

const look = gui.addFolder('Look');
look.addColor(s, 'background').onChange(rebuildTerrain);
look.add(s, 'fog');
look.add(s, 'fogNear', 0, 40000, 100).name('fog near');
look.add(s, 'fogFar', 0, 60000, 100).name('fog far');
look.add(s, 'bloom');
look.add(s, 'bloomStrength', 0, 3, 0.01).name('bloom strength');
look.add(s, 'bloomRadius', 0, 1, 0.01).name('bloom radius');
look.add(s, 'bloomThreshold', 0, 1, 0.01).name('bloom threshold');

const out = gui.addFolder('Output');
out.add(s, 'recordFps', [24, 30, 60]).name('record fps');
out.add(s, 'recordMbps', 5, 100, 1).name('record Mbps');
out.add(actions, 'record').name('● record from start');
out.add(actions, 'stopRecord').name('■ stop recording');
out.add(actions, 'snapshot').name('save PNG frame');
out.add(actions, 'copySettings').name('copy settings JSON');
out.add(actions, 'reset').name('reset to defaults');

for (const folder of [cam, ter, pth, rte, look]) folder.close();

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'h' || e.key === 'H') gui.show(gui._hidden);
  if (e.key === ' ') {
    e.preventDefault();
    s.playing = !s.playing;
  }
});

// Handy from the devtools console while vibe coding.
Object.assign(window, { THREE, scene, camera, settings: s, defaults, field: () => field });
