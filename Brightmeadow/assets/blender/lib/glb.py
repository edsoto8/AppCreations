"""Minimal GLB reader (plain Python, no bpy / numpy) used by the validator and the manifest.

All results are in glTF / Godot axes: +Y up, +Z toward the camera.
"""
import json
import math
import struct

COMP_FMT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
TYPE_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
FPS = 30


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path}: not a GLB file")
    off = 12
    js, binary = None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binary = chunk
        off += 8 + clen
    return js, binary


class Glb:
    def __init__(self, path):
        self.path = path
        self.js, self.bin = read_glb(path)

    # ------------------------------------------------------------------ accessors
    def accessor(self, idx):
        acc = self.js["accessors"][idx]
        bv = self.js["bufferViews"][acc["bufferView"]]
        fmt = COMP_FMT[acc["componentType"]]
        n = TYPE_N[acc["type"]]
        size = struct.calcsize(fmt)
        stride = bv.get("byteStride", size * n)
        base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        out = []
        for i in range(acc["count"]):
            vals = struct.unpack_from("<" + fmt * n, self.bin, base + i * stride)
            if acc.get("normalized") and fmt != "f":
                mx = float((1 << (8 * size - (1 if fmt.islower() else 0))) - 1)
                vals = tuple(max(v / mx, -1.0) for v in vals)
            out.append(vals if n > 1 else vals[0])
        return out

    # ------------------------------------------------------------------ nodes
    def node_names(self):
        return [n.get("name", "") for n in self.js.get("nodes", [])]

    def local_matrix(self, node):
        if "matrix" in node:
            m = node["matrix"]
            return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
        t = node.get("translation", [0, 0, 0])
        q = node.get("rotation", [0, 0, 0, 1])
        s = node.get("scale", [1, 1, 1])
        x, y, z, w = q
        r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
             [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
             [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [
            [0, 0, 0, 1]]

    def world_matrices(self):
        nodes = self.js.get("nodes", [])
        parent = {}
        for i, n in enumerate(nodes):
            for c in n.get("children", []):
                parent[c] = i
        cache = {}

        def world(i):
            if i in cache:
                return cache[i]
            m = self.local_matrix(nodes[i])
            if i in parent:
                m = matmul(world(parent[i]), m)
            cache[i] = m
            return m

        return [world(i) for i in range(len(nodes))]

    # ------------------------------------------------------------------ geometry
    def world_vertices(self, node_filter=None):
        """Rest-pose vertex positions in scene space for every mesh node (skins applied)."""
        nodes = self.js.get("nodes", [])
        wm = self.world_matrices()
        out = []
        for i, n in enumerate(nodes):
            if "mesh" not in n:
                continue
            if node_filter and not node_filter(n.get("name", "")):
                continue
            mesh = self.js["meshes"][n["mesh"]]
            skin = self.js["skins"][n["skin"]] if "skin" in n else None
            joint_mats = None
            if skin is not None:
                ibms = self.accessor(skin["inverseBindMatrices"]) if "inverseBindMatrices" in \
                    skin else [identity_flat()] * len(skin["joints"])
                joint_mats = [matmul(wm[j], flat_to_mat(ibm)) for j, ibm in
                              zip(skin["joints"], ibms)]
            for prim in mesh["primitives"]:
                pos = self.accessor(prim["attributes"]["POSITION"])
                if joint_mats is not None:
                    joints = self.accessor(prim["attributes"]["JOINTS_0"])
                    weights = self.accessor(prim["attributes"]["WEIGHTS_0"])
                    for p, js_, ws in zip(pos, joints, weights):
                        acc = [0.0, 0.0, 0.0]
                        tw = sum(ws) or 1.0
                        for j, w in zip(js_, ws):
                            if w <= 0:
                                continue
                            q = apply(joint_mats[j], p)
                            for k in range(3):
                                acc[k] += q[k] * w / tw
                        out.append(tuple(acc))
                else:
                    for p in pos:
                        out.append(apply(wm[i], p))
        return out

    def bounds(self, node_filter=None):
        vs = self.world_vertices(node_filter)
        mn = [min(v[k] for v in vs) for k in range(3)]
        mx = [max(v[k] for v in vs) for k in range(3)]
        return mn, mx

    def triangles(self):
        tris = 0
        nodes = self.js.get("nodes", [])
        for n in nodes:
            if "mesh" not in n:
                continue
            for prim in self.js["meshes"][n["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                if "indices" in prim:
                    tris += self.js["accessors"][prim["indices"]]["count"] // 3
                else:
                    tris += self.js["accessors"][prim["attributes"]["POSITION"]]["count"] // 3
        return tris

    def triangles_world(self, node_filter=None):
        """List of triangles [(p0, p1, p2), ...] in scene space (non-skinned meshes)."""
        nodes = self.js.get("nodes", [])
        wm = self.world_matrices()
        out = []
        for i, n in enumerate(nodes):
            if "mesh" not in n or "skin" in n:
                continue
            if node_filter and not node_filter(n.get("name", "")):
                continue
            for prim in self.js["meshes"][n["mesh"]]["primitives"]:
                pos = [apply(wm[i], p) for p in self.accessor(prim["attributes"]["POSITION"])]
                idx = self.accessor(prim["indices"]) if "indices" in prim else list(
                    range(len(pos)))
                for k in range(0, len(idx) - 2, 3):
                    out.append((pos[idx[k]], pos[idx[k + 1]], pos[idx[k + 2]]))
        return out

    # ------------------------------------------------------------------ animation
    def animations(self):
        """{name: frames} where frames = round(duration * 30)."""
        out = {}
        for a in self.js.get("animations", []):
            tmax = 0.0
            for s in a["samplers"]:
                acc = self.js["accessors"][s["input"]]
                if "max" in acc:
                    tmax = max(tmax, acc["max"][0])
                else:
                    tmax = max(tmax, max(self.accessor(s["input"])))
            out[a.get("name", "")] = int(round(tmax * FPS))
        return out

    def material_names(self):
        return [m.get("name", "") for m in self.js.get("materials", [])]


# ---------------------------------------------------------------------- tiny matrix math
def identity_flat():
    return (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)


def flat_to_mat(m):
    """Column-major 16 floats -> row-major 4x4 list."""
    return [[m[c * 4 + r] for c in range(4)] for r in range(4)]


def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def apply(m, p):
    x, y, z = p
    return (m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
            m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
            m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3])


def summary(path):
    g = Glb(path)
    mn, mx = g.bounds()
    return {
        "bounds_min": [round(v, 4) for v in mn],
        "bounds_max": [round(v, 4) for v in mx],
        "triangles": g.triangles(),
        "animations": g.animations(),
    }
