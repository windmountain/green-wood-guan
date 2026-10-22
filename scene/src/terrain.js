// A height field interpolated from scattered spot elevations, plus the
// line geometry (ridgelines, contours, grid) the scene draws from it.
//
// Everything here is in data coordinates: x east, y north, feet. main.js
// maps to three.js world space (x, elevation, -y).

// Points are binned onto grid nodes (mean per node). Empty nodes are filled
// by inverse distance weighting from the nearest filled nodes, searching
// outward ring by ring up to `maxGap` feet — beyond that a node is left as
// NaN (no data: the bay, mostly), which the line builders skip. Nodes for
// which `alwaysFill(x, y)` is true (the cemetery) search without limit, so
// paths always have ground under them.
export function buildHeightField(points, bounds, { cellSize, power, smoothing, maxGap, alwaysFill }) {
  const cell = cellSize;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY) / cell) + 1;
  const xAt = (i) => bounds.minX + i * cell;
  const yAt = (j) => bounds.minY + j * cell;

  const sum = new Float64Array(nx * ny);
  const count = new Uint32Array(nx * ny);
  for (const [x, y, z] of points) {
    const i = Math.round((x - bounds.minX) / cell);
    const j = Math.round((y - bounds.minY) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
    sum[j * nx + i] += z;
    count[j * nx + i]++;
  }
  const known = new Float32Array(nx * ny).fill(NaN);
  for (let k = 0; k < known.length; k++) if (count[k]) known[k] = sum[k] / count[k];

  const h = known.slice();
  const gapCells = Math.ceil(maxGap / cell);
  const unlimited = Math.max(nx, ny);
  const MIN_SAMPLES = 6;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!Number.isNaN(known[j * nx + i])) continue;
      const limit = alwaysFill(xAt(i), yAt(j)) ? unlimited : gapCells;
      let num = 0;
      let den = 0;
      let found = 0;
      for (let r = 1; r <= limit && found < MIN_SAMPLES; r++) {
        // walk the square ring at Chebyshev distance r
        for (let dj = -r; dj <= r; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ny) continue;
          const step = dj === -r || dj === r ? 1 : 2 * r;
          for (let di = -r; di <= r; di += step) {
            const ii = i + di;
            if (ii < 0 || ii >= nx) continue;
            const v = known[jj * nx + ii];
            if (Number.isNaN(v)) continue;
            const w = 1 / Math.pow(di * di + dj * dj, power / 2);
            num += w * v;
            den += w;
            found++;
          }
        }
      }
      if (found) h[j * nx + i] = num / den;
    }
  }

  for (let pass = 0; pass < smoothing; pass++) blur(h, nx, ny);

  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return {
    nx, ny, cell, h, min, max, xAt, yAt,
    at: (i, j) => h[j * nx + i],
    valid: (i, j) => !Number.isNaN(h[j * nx + i]),
    sample(x, y) {
      const fi = Math.min(Math.max((x - bounds.minX) / cell, 0), nx - 1.001);
      const fj = Math.min(Math.max((y - bounds.minY) / cell, 0), ny - 1.001);
      const i = Math.floor(fi);
      const j = Math.floor(fj);
      const tx = fi - i;
      const ty = fj - j;
      const corners = [
        [h[j * nx + i], (1 - tx) * (1 - ty)],
        [h[j * nx + i + 1], tx * (1 - ty)],
        [h[(j + 1) * nx + i], (1 - tx) * ty],
        [h[(j + 1) * nx + i + 1], tx * ty],
      ];
      let num = 0;
      let den = 0;
      for (const [v, w] of corners) {
        if (Number.isNaN(v)) continue;
        num += v * w;
        den += w;
      }
      return den ? num / den : min;
    },
  };
}

// 3×3 box blur, in place. NaN (no data) nodes stay NaN and don't contribute.
function blur(h, nx, ny) {
  const src = h.slice();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (Number.isNaN(src[j * nx + i])) continue;
      let sum = 0;
      let count = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const v = src[jj * nx + ii];
          if (Number.isNaN(v)) continue;
          sum += v;
          count++;
        }
      }
      h[j * nx + i] = sum / count;
    }
  }
}

// Which grid nodes to draw: those with data, inside a circle of `radius`
// feet around (cx, cy), and — if `rings` is given — inside the cemetery
// (grown by `margin` feet).
export function terrainMask(field, { cx, cy, radius, rings, margin }) {
  const mask = new Uint8Array(field.nx * field.ny);
  for (let j = 0; j < field.ny; j++) {
    for (let i = 0; i < field.nx; i++) {
      const x = field.xAt(i);
      const y = field.yAt(j);
      mask[j * field.nx + i] =
        field.valid(i, j) &&
        Math.hypot(x - cx, y - cy) <= radius &&
        (!rings || inCemetery(x, y, rings, margin))
          ? 1
          : 0;
    }
  }
  return mask;
}

export function inCemetery(x, y, rings, margin) {
  return (
    rings.some((ring) => pointInRing(x, y, ring)) ||
    (margin > 0 && rings.some((ring) => distanceToRing(x, y, ring) < margin))
  );
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a];
    const [xb, yb] = ring[b];
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

function distanceToRing(x, y, ring) {
  let best = Infinity;
  for (let a = 0; a < ring.length - 1; a++) {
    const [x1, y1] = ring[a];
    const [x2, y2] = ring[a + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

// Each line builder returns a flat list of segments as
// [x1, y1, e1, x2, y2, e2, ...] (e = elevation in feet).

// Horizontal profile lines every `every` grid rows (east–west), the
// "Unknown Pleasures" look. `axis: 'y'` runs them north–south instead.
export function ridgelines(field, mask, { every, axis }) {
  const out = [];
  const { nx, ny } = field;
  const inMask = (i, j) => !mask || mask[j * nx + i];
  if (axis === 'y') {
    for (let i = 0; i < nx; i += every) {
      for (let j = 0; j < ny - 1; j++) {
        if (!inMask(i, j) || !inMask(i, j + 1)) continue;
        out.push(field.xAt(i), field.yAt(j), field.at(i, j), field.xAt(i), field.yAt(j + 1), field.at(i, j + 1));
      }
    }
  } else {
    for (let j = 0; j < ny; j += every) {
      for (let i = 0; i < nx - 1; i++) {
        if (!inMask(i, j) || !inMask(i + 1, j)) continue;
        out.push(field.xAt(i), field.yAt(j), field.at(i, j), field.xAt(i + 1), field.yAt(j), field.at(i + 1, j));
      }
    }
  }
  return out;
}

export function gridLines(field, mask, { every }) {
  return [
    ...ridgelines(field, mask, { every, axis: 'x' }),
    ...ridgelines(field, mask, { every, axis: 'y' }),
  ];
}

// Marching squares: one iso-line every `interval` feet of elevation.
export function contours(field, mask, { interval }) {
  const out = [];
  const { nx, ny } = field;
  const start = Math.ceil(field.min / interval) * interval;
  for (let level = start; level <= field.max; level += interval) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        if (mask && !(mask[j * nx + i] && mask[j * nx + i + 1] && mask[(j + 1) * nx + i] && mask[(j + 1) * nx + i + 1])) continue;
        // Corners counter-clockwise from bottom-left.
        const v = [field.at(i, j), field.at(i + 1, j), field.at(i + 1, j + 1), field.at(i, j + 1)];
        const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const crossings = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e];
          const b = v[(e + 1) % 4];
          if ((a < level) === (b < level)) continue;
          const t = (level - a) / (b - a);
          const [ia, ja] = c[e];
          const [ib, jb] = c[(e + 1) % 4];
          crossings.push(field.xAt(ia + (ib - ia) * t), field.yAt(ja + (jb - ja) * t));
        }
        // 2 crossings is the normal case; 4 is a saddle — pair them in order.
        for (let k = 0; k + 3 < crossings.length; k += 4) {
          out.push(crossings[k], crossings[k + 1], level, crossings[k + 2], crossings[k + 3], level);
        }
      }
    }
  }
  return out;
}

// Grid nodes as points, [x, y, e, ...].
export function gridPoints(field, mask, { every }) {
  const out = [];
  for (let j = 0; j < field.ny; j += every) {
    for (let i = 0; i < field.nx; i += every) {
      if (mask && !mask[j * field.nx + i]) continue;
      out.push(field.xAt(i), field.yAt(j), field.at(i, j));
    }
  }
  return out;
}
