class_name LevelData
extends RefCounted
## Parsed form of a handcrafted level layout (res://levels/*.json). Gameplay happens on the z = 0
## plane: every position here is (x, y) in metres. Coin lines and arcs are expanded into points.

## One walkable box. Ground is solid from [member top] down out of the level; platforms are
## 0.9 m thick and one-way (you can jump up through them).
class Surface:
	var x0: float
	var x1: float
	var top: float
	var oneway: bool

	func _init(a: float, b: float, t: float, is_oneway: bool) -> void:
		x0 = a
		x1 = b
		top = t
		oneway = is_oneway

	func width() -> float:
		return x1 - x0

	func contains_x(x: float) -> bool:
		return x >= x0 and x <= x1

const PLATFORM_THICKNESS := 0.9

var level_name := ""
var spawn := Vector2.ZERO
var kill_y := -7.0
var bounds := Vector2(-10, 100)
var ground: Array[Surface] = []
var platforms: Array[Surface] = []
var coins := PackedVector2Array()
var enemies: Array[Dictionary] = []
var checkpoints := PackedVector2Array()
var goal := Vector2.ZERO
var signs: Array[Dictionary] = []
var decor: Array[Dictionary] = []
## Array of {x, name}, sorted by x.
var sections: Array[Dictionary] = []


static func load_file(path: String) -> LevelData:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("LevelData: cannot read %s" % path)
		return null
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("LevelData: %s is not a JSON object" % path)
		return null
	return from_dict(parsed)


static func from_dict(d: Dictionary) -> LevelData:
	var data := LevelData.new()
	data.level_name = d.get("name", "")
	data.spawn = _vec2(d.get("spawn", [0, 0]))
	data.kill_y = d.get("kill_y", -7.0)
	data.bounds = _vec2(d.get("bounds", [-10, 100]))
	for g in d.get("ground", []):
		data.ground.append(Surface.new(g[0], g[1], g[2], false))
	for p in d.get("platforms", []):
		data.platforms.append(Surface.new(p[0], p[1], p[2], true))
	for c in d.get("coins", []):
		data.coins.append_array(_expand_coins(c))
	for e in d.get("enemies", []):
		data.enemies.append(e)
	for cp in d.get("checkpoints", []):
		data.checkpoints.append(_vec2(cp))
	data.goal = _vec2(d.get("goal", [0, 0]))
	for s in d.get("signs", []):
		data.signs.append(s)
	for dec in d.get("decor", []):
		data.decor.append(dec)
	for sec in d.get("sections", []):
		data.sections.append(sec)
	data.sections.sort_custom(func(a, b): return a["x"] < b["x"])
	return data


func surfaces() -> Array[Surface]:
	var all: Array[Surface] = []
	all.append_array(ground)
	all.append_array(platforms)
	return all


## The highest surface whose top is at or below [param y] (+ tolerance) at [param x], or null.
func surface_under(x: float, y: float, tolerance := 0.05) -> Surface:
	var best: Surface = null
	for s in surfaces():
		if s.contains_x(x) and s.top <= y + tolerance:
			if best == null or s.top > best.top:
				best = s
	return best


func section_name_at(x: float) -> String:
	var current := ""
	for sec in sections:
		if x >= float(sec["x"]):
			current = sec["name"]
	return current


static func _vec2(a: Array) -> Vector2:
	return Vector2(float(a[0]), float(a[1]))


static func _expand_coins(c: Variant) -> PackedVector2Array:
	var out := PackedVector2Array()
	if c is Array:
		out.append(_vec2(c))
	elif c.has("line"):
		var l: Array = c["line"]
		var n: int = l[4]
		for i in n:
			var t := 0.0 if n == 1 else float(i) / float(n - 1)
			out.append(Vector2(lerpf(l[0], l[2], t), lerpf(l[1], l[3], t)))
	elif c.has("arc"):
		# [x0, x1, base_y, height, n]: a parabola from (x0, base) up to base+height and back.
		var a: Array = c["arc"]
		var n: int = a[4]
		for i in n:
			var t := 0.5 if n == 1 else float(i) / float(n - 1)
			out.append(Vector2(lerpf(a[0], a[1], t), a[2] + a[3] * 4.0 * t * (1.0 - t)))
	return out
