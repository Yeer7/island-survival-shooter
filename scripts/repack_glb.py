"""Shrink the textures embedded in a .glb without touching its geometry.

Each embedded image is decoded with Pillow, resized so its longest side is at most
--max px, and re-encoded (JPEG for opaque images, PNG when it has alpha). The BIN
chunk is rebuilt with every bufferView re-aligned. Usage:
    python scripts/repack_glb.py in.glb out.glb --max 512
"""
import argparse, io, json, struct
from PIL import Image


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a glb'
    off = 12
    js = binc = None
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf8'))
        elif ctype == 0x004E4942:
            binc = bytes(chunk)
        off += 8 + clen
    return js, binc


def write_glb(path, js, binc):
    jb = json.dumps(js, separators=(',', ':')).encode('utf8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    binc += b'\0' * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack('<II', len(binc), 0x004E4942) + binc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--max', type=int, default=512)
    a = ap.parse_args()
    js, binc = read_glb(a.src)
    views = js.get('bufferViews', [])
    replace = {}
    for img in js.get('images', []):
        if 'bufferView' not in img:
            continue
        bv = views[img['bufferView']]
        raw = binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        im = Image.open(io.BytesIO(raw))
        im.load()
        if max(im.size) > a.max:
            s = a.max / max(im.size)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        out = io.BytesIO()
        alpha = im.mode in ('RGBA', 'LA') and im.getextrema()[-1][0] < 255
        if alpha:
            im.save(out, 'PNG', optimize=True)
            img['mimeType'] = 'image/png'
        else:
            im.convert('RGB').save(out, 'JPEG', quality=86)
            img['mimeType'] = 'image/jpeg'
        replace[img['bufferView']] = out.getvalue()
    newbin = bytearray()
    for i, bv in enumerate(views):
        while len(newbin) % 4:
            newbin.append(0)
        chunk = replace.get(i)
        if chunk is None:
            o = bv.get('byteOffset', 0)
            chunk = binc[o: o + bv['byteLength']]
        bv['byteOffset'] = len(newbin)
        bv['byteLength'] = len(chunk)
        newbin += chunk
    js['buffers'][0]['byteLength'] = len(newbin)
    write_glb(a.dst, js, bytes(newbin))


if __name__ == '__main__':
    main()
