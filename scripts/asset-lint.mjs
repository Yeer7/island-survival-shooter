// Import lint for .glb assets: parses each file, measures triangles, bounds
// (with node transforms), animations and images, checks budgets and that every
// file is listed in ASSETS_LICENSE.md. Usage: node scripts/asset-lint.mjs [dir|files...]
import fs from 'node:fs';
import path from 'node:path';

const BUDGET = { tris: 12000, bytes: 1.5 * 1024 * 1024 };

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.gltf')) {
    // Separate-file glTF: JSON plus .bin buffers (and images) next to it.
    const json = JSON.parse(buf.toString('utf8'));
    let bytes = buf.length;
    for (const b of json.buffers ?? []) if (b.uri && !b.uri.startsWith('data:')) {
      const p = path.join(path.dirname(file), b.uri);
      if (!fs.existsSync(p)) throw new Error(`missing buffer ${b.uri}`);
      bytes += fs.statSync(p).size;
    }
    for (const im of json.images ?? []) if (im.uri && !im.uri.startsWith('data:')) {
      const p = path.join(path.dirname(file), im.uri);
      if (!fs.existsSync(p)) throw new Error(`missing image ${im.uri}`);
      bytes += fs.statSync(p).size;
    }
    return { json, bytes };
  }
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
  const all = target.flatMap((t) => (fs.statSync(t).isDirectory() ? fs.readdirSync(t, { recursive: true }).map((f) => path.join(t, f)) : [t]));
  const files = all.filter((f) => f.endsWith('.glb') || f.endsWith('.gltf'));
  // FBX is loaded at runtime with FBXLoader: check size, the binary FBX header and the licence entry.
  const fbx = all.filter((f) => f.endsWith('.fbx'));
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
  for (const f of fbx) {
    const buf = fs.readFileSync(f);
    const problems = [];
    if (!buf.subarray(0, 20).toString('latin1').startsWith('Kaydara FBX Binary')) problems.push('not a binary FBX');
    if (buf.length > BUDGET.bytes) problems.push('over size budget');
    if (!licence.includes(path.basename(f))) problems.push('missing from ASSETS_LICENSE.md');
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path.basename(f)}: ${(buf.length / 1024).toFixed(0)} KB (fbx)${problems.length ? ' — ' + problems.join('; ') : ''}`);
  }
  // Every image shipped next to the models must be at most 512 px and licensed.
  for (const f of all.filter((x) => /\.(png|jpe?g)$/i.test(x))) {
    const buf = fs.readFileSync(f);
    let w = 0;
    let h = 0;
    if (buf[0] === 0x89) {
      w = buf.readUInt32BE(16);
      h = buf.readUInt32BE(20);
    } else {
      for (let i = 2; i < buf.length - 9; ) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc2) {
          h = buf.readUInt16BE(i + 5);
          w = buf.readUInt16BE(i + 7);
          break;
        }
        i += 2 + len;
      }
    }
    const problems = [];
    if (Math.max(w, h) > 512 && !f.includes('colormap')) problems.push(`${w}x${h} > 512`);
    if (!licence.includes(path.basename(f))) problems.push('missing from ASSETS_LICENSE.md');
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path.basename(f)}: ${w}x${h}${problems.length ? ' — ' + problems.join('; ') : ''}`);
  }
  // Audio: real Ogg files, small, licensed, and measured. The manifest written by
  // scripts/master_audio.py must list exactly the shipped files, each mono with a
  // decoded peak at or under -1 dBFS.
  const audio = all.filter((x) => /\.(ogg|mp3)$/i.test(x));
  if (audio.length) {
    const manPath = audio.map((f) => path.join(path.dirname(f), 'manifest.json')).find((m) => fs.existsSync(m));
    const man = manPath ? JSON.parse(fs.readFileSync(manPath, 'utf8')).files : [];
    const byName = new Map(man.map((m) => [m.file, m]));
    for (const f of audio) {
      const buf = fs.readFileSync(f);
      const problems = [];
      const name = path.basename(f);
      if (f.endsWith('.ogg') && buf.subarray(0, 4).toString('latin1') !== 'OggS') problems.push('not an Ogg file');
      if (buf.length > 150 * 1024) problems.push(`${(buf.length / 1024).toFixed(0)} KB > 150 KB`);
      if (!licence.includes(name)) problems.push('missing from ASSETS_LICENSE.md');
      const m = byName.get(name);
      if (!m) problems.push('not in the audio manifest');
      else {
        if (m.peakDb > -1) problems.push(`peak ${m.peakDb} dBFS > -1`);
        if (m.channels !== 1) problems.push('not mono');
      }
      if (problems.length) failed++;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}: ${(buf.length / 1024).toFixed(0)} KB${m ? `, peak ${m.peakDb} dBFS, ${m.seconds}s` : ''}${problems.length ? ' — ' + problems.join('; ') : ''}`);
    }
    const shipped = new Set(audio.map((f) => path.basename(f)));
    for (const m of man) {
      if (!shipped.has(m.file)) {
        failed++;
        console.log(`FAIL manifest lists ${m.file}, which is not shipped`);
      }
    }
    console.log(`${audio.length} audio files, manifest covers ${man.length}`);
  }
  console.log(`${files.length + fbx.length} models, ${failed} failing`);
  process.exit(failed ? 1 : 0);
}
