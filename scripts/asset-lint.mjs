// Import lint for .glb assets: parses each file, measures triangles, bounds
// (with node transforms), animations and images, checks budgets and that every
// file is listed in ASSETS_LICENSE.md. Usage: node scripts/asset-lint.mjs [dir|files...]
import fs from 'node:fs';
import path from 'node:path';

const BUDGET = { tris: 12000, bytes: 1.5 * 1024 * 1024 };

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return { json, bytes: buf.length };
}

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function trs(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function inspect(file) {
  const { json, bytes } = readGlb(file);
  let tris = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[p.attributes.POSITION];
        tris += p.indices !== undefined ? json.accessors[p.indices].count / 3 : acc.count / 3;
        if (!acc.min) continue;
        for (let i = 0; i < 8; i++) {
          const v = [i & 1 ? acc.max[0] : acc.min[0], i & 2 ? acc.max[1] : acc.min[1], i & 4 ? acc.max[2] : acc.min[2]];
          for (let k = 0; k < 3; k++) {
            const w = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k];
            min[k] = Math.min(min[k], w);
            max[k] = Math.max(max[k], w);
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of json.scenes[json.scene ?? 0].nodes) visit(r, I);
  return {
    file: path.basename(file),
    bytes,
    tris: Math.round(tris),
    size: max.map((v, i) => +(v - min[i]).toFixed(3)),
    minY: +min[1].toFixed(3),
    anims: (json.animations ?? []).map((a) => a.name),
    images: (json.images ?? []).length,
    materials: (json.materials ?? []).length,
    skinned: (json.skins ?? []).length > 0,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const args = process.argv.slice(2);
  const target = args.length ? args : ['public/assets'];
  const files = target.flatMap((t) => (fs.statSync(t).isDirectory() ? fs.readdirSync(t, { recursive: true }).map((f) => path.join(t, f)) : [t])).filter((f) => f.endsWith('.glb'));
  const licence = fs.existsSync('ASSETS_LICENSE.md') ? fs.readFileSync('ASSETS_LICENSE.md', 'utf8') : '';
  let failed = 0;
  for (const f of files) {
    const problems = [];
    let r;
    try {
      r = inspect(f);
    } catch (e) {
      console.log(`FAIL ${f}: ${e.message}`);
      failed++;
      continue;
    }
    if (r.tris === 0) problems.push('no triangles');
    if (r.tris > BUDGET.tris) problems.push(`${r.tris} tris > ${BUDGET.tris}`);
    if (r.bytes > BUDGET.bytes) problems.push(`${(r.bytes / 1024).toFixed(0)} KB > budget`);
    if (!licence.includes(path.basename(f))) problems.push('missing from ASSETS_LICENSE.md');
    const line = `${r.file}: ${r.tris} tris, ${(r.bytes / 1024).toFixed(0)} KB, size ${r.size.join('x')}, minY ${r.minY}${r.anims.length ? `, anims [${r.anims.join(', ')}]` : ''}`;
    if (problems.length) {
      failed++;
      console.log(`FAIL ${line} — ${problems.join('; ')}`);
    } else console.log(`ok   ${line}`);
  }
  console.log(`${files.length} assets, ${failed} failing`);
  process.exit(failed ? 1 : 0);
}
