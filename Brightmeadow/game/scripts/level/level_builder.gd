class_name LevelBuilder
extends RefCounted
## Turns LevelData into nodes: tiled terrain visuals with box colliders, coins, enemies,
## checkpoints, goal, signs, decoration and the background. The layout itself is handcrafted
## in the JSON; the only randomness here is a seeded scatter of small props (grass, flowers,
## rocks) and background hills/clouds, so every build is identical.

const COIN_SCENE := preload("res://scenes/coin.tscn")
const BRAMBLEBUG_SCENE := preload("res://scenes/bramblebug.tscn")
const BUZZPUFF_SCENE := preload("res://scenes/buzzpuff.tscn")
const CHECKPOINT_SCENE := preload("res://scenes/checkpoint.tscn")
const GOAL_SCENE := preload("res://scenes/goal.tscn")
const SIGN_FONT := preload("res://assets/fonts/fredoka-latin-600-normal.woff2")

const GROUND_DEPTH := 4.0
const PLATFORM_DEPTH := 2.5
const COLLIDER_DEPTH := 2.0
## Ground colliders extend this far below their top.
const GROUND_COLLIDER_HEIGHT := 16.0
const VALLEY_FLOOR_Y := -3.2

var data: LevelData
var root: Node3D
var gameplay := true

var terrain: Node3D
var pickups: Node3D
var enemies: Node3D
var markers: Node3D
var decor: Node3D
var background: Node3D

var coins: Array[Coin] = []
var checkpoints: Array[Checkpoint] = []
var goal: Goal

var _rng := RandomNumberGenerator.new()


## [param with_gameplay] false builds only scenery (used by the main menu diorama).
func build(level: LevelData, parent: Node3D, with_gameplay := true) -> void:
	data = level
	root = parent
	gameplay = with_gameplay
	terrain = _group("Terrain")
	pickups = _group("Pickups")
	enemies = _group("Enemies")
	markers = _group("Markers")
	decor = _group("Decor")
	background = _group("Background")

	for s in data.ground:
		_build_surface(s)
	for s in data.platforms:
		_build_surface(s)
	if gameplay:
		_build_bounds()
		_build_coins()
		_build_enemies()
		_build_checkpoints()
		_build_goal()
		_build_signs()
	_build_decor()
	_scatter_props()
	_build_background()


func _group(group_name: String) -> Node3D:
	var n := Node3D.new()
	n.name = group_name
	root.add_child(n)
	return n


# --- Terrain ---------------------------------------------------------------------------------

func _build_surface(s: LevelData.Surface) -> void:
	var holder := Node3D.new()
	holder.name = ("Platform_%d" if s.oneway else "Ground_%d") % int(s.x0)
	terrain.add_child(holder)
	var prefix := "float" if s.oneway else "ground"
	var mids := ["float_mid_a", "float_mid_b"] if s.oneway else [
			"ground_mid_a", "ground_mid_b", "ground_mid_c"]
	_add_model(holder, prefix + "_cap_left", Vector3(s.x0 + 0.5, s.top, 0))
	var n := int(round(s.width())) - 1
	for i in n:
		var x := s.x0 + 1.0 + i
		# Deterministic variety without visible repetition.
		var pick: String = mids[absi(int(x) * 7 + int(s.top * 3.0)) % mids.size()]
		_add_model(holder, pick, Vector3(x, s.top, 0))
	_add_model(holder, prefix + "_cap_right", Vector3(s.x1 - 0.5, s.top, 0))

	var body := StaticBody3D.new()
	body.name = "Collider"
	body.collision_layer = 1
	body.collision_mask = 0
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	var height := LevelData.PLATFORM_THICKNESS if s.oneway else GROUND_COLLIDER_HEIGHT
	box.size = Vector3(s.width(), height, COLLIDER_DEPTH)
	shape.shape = box
	body.add_child(shape)
	holder.add_child(body)
	body.position = Vector3((s.x0 + s.x1) * 0.5, s.top - height * 0.5, 0)
	if s.oneway:
		body.set_meta("top", s.top)
		body.add_to_group("oneway")


func _build_bounds() -> void:
	for x in [data.bounds.x - 0.5, data.bounds.y + 0.5]:
		var body := StaticBody3D.new()
		body.name = "Bound"
		body.collision_layer = 1
		var shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(1, 60, COLLIDER_DEPTH)
		shape.shape = box
		body.add_child(shape)
		terrain.add_child(body)
		body.position = Vector3(x, 20, 0)


# --- Gameplay objects ------------------------------------------------------------------------

func _build_coins() -> void:
	for p in data.coins:
		var c: Coin = COIN_SCENE.instantiate()
		c.position = Vector3(p.x, p.y, 0)
		pickups.add_child(c)
		coins.append(c)


func _build_enemies() -> void:
	for e in data.enemies:
		match e["type"]:
			"bramblebug":
				var b: Bramblebug = BRAMBLEBUG_SCENE.instantiate()
				b.position = Vector3(e["x"], e["y"], 0)
				b.direction = e.get("dir", -1)
				if e.has("range"):
					b.patrol_range = Vector2(e["range"][0], e["range"][1])
				enemies.add_child(b)
			"buzzpuff":
				var f: Buzzpuff = BUZZPUFF_SCENE.instantiate()
				f.point_a = Vector3(e["a"][0], e["a"][1], 0)
				f.point_b = Vector3(e["b"][0], e["b"][1], 0)
				f.period = e.get("period", 3.0)
				f.position = f.point_a
				enemies.add_child(f)
			_:
				push_error("LevelBuilder: unknown enemy type %s" % e["type"])


func _build_checkpoints() -> void:
	for i in data.checkpoints.size():
		var cp: Checkpoint = CHECKPOINT_SCENE.instantiate()
		cp.index = i
		cp.position = Vector3(data.checkpoints[i].x, data.checkpoints[i].y, -0.6)
		markers.add_child(cp)
		checkpoints.append(cp)


func _build_goal() -> void:
	goal = GOAL_SCENE.instantiate()
	goal.position = Vector3(data.goal.x, data.goal.y, 0)
	markers.add_child(goal)


func _build_signs() -> void:
	for s in data.signs:
		var holder := Node3D.new()
		holder.name = "Sign"
		decor.add_child(holder)
		holder.position = Vector3(s["x"], s["y"], -1.1)
		holder.add_child(ModelLib.instance("signpost"))
		var label := Label3D.new()
		label.text = s["text"]
		label.font = SIGN_FONT
		label.font_size = 64
		label.outline_size = 18
		label.pixel_size = 0.0055
		label.modulate = Color(1, 0.98, 0.92)
		label.outline_modulate = Color(0.23, 0.16, 0.12)
		label.position = Vector3(0, 2.3, 0.3)
		label.double_sided = false
		label.shaded = false
		holder.add_child(label)


# --- Scenery ---------------------------------------------------------------------------------

func _build_decor() -> void:
	for d in data.decor:
		var n := _add_model(decor, d["m"], Vector3(d["x"], d["y"], d.get("z", -1.6)))
		n.scale = Vector3.ONE * float(d.get("s", 1.0))
		n.rotation.y = deg_to_rad(float(d.get("r", 0.0)))


## Small props along every surface: grass tufts at the front and back edge, flowers, bushes,
## rocks and mushrooms toward the back. Seeded per surface so the result never changes.
func _scatter_props() -> void:
	for s in data.surfaces():
		_rng.seed = hash(Vector2(s.x0, s.top))
		var depth := PLATFORM_DEPTH if s.oneway else GROUND_DEPTH
		var front := depth * 0.5 - 0.35
		var x := s.x0 + 0.6
		while x < s.x1 - 0.6:
			_add_prop("grass_tuft", x, s.top, front - _rng.randf() * 0.25, 0.8 + _rng.randf() * 0.5)
			if _rng.randf() < 0.55:
				_add_prop("grass_tuft", x + 0.4, s.top, -front * 0.6 - _rng.randf() * 0.3,
						0.7 + _rng.randf() * 0.5)
			x += 0.9 + _rng.randf() * 1.2
		if s.oneway:
			if s.width() >= 4 and _rng.randf() < 0.7:
				_add_prop("flowers", lerpf(s.x0 + 0.8, s.x1 - 0.8, _rng.randf()), s.top, -0.7, 0.7)
			continue
		x = s.x0 + 1.5 + _rng.randf() * 2.0
		while x < s.x1 - 1.0:
			var r := _rng.randf()
			var z := -1.2 - _rng.randf() * 0.6
			if r < 0.35:
				_add_prop("flowers", x, s.top, z, 0.8 + _rng.randf() * 0.4)
			elif r < 0.6:
				_add_prop("bush", x, s.top, z - 0.2, 0.8 + _rng.randf() * 0.5)
			elif r < 0.75:
				_add_prop("rock", x, s.top, z, 0.6 + _rng.randf() * 0.5)
			elif r < 0.88:
				_add_prop("mushroom", x, s.top, z + 0.3, 0.8 + _rng.randf() * 0.5)
			x += 2.5 + _rng.randf() * 3.5
		# Front-edge accents that sit below the walk line of sight: low flowers and bushes.
		x = s.x0 + 2.0 + _rng.randf() * 3.0
		while x < s.x1 - 1.5:
			if _rng.randf() < 0.5:
				_add_prop("flowers", x, s.top, 1.5, 0.6)
			else:
				_add_prop("bush", x, s.top - 0.15, 1.75, 0.55)
			x += 6.0 + _rng.randf() * 6.0


func _build_background() -> void:
	_rng.seed = 20261026
	var x0 := data.bounds.x - 40.0
	var x1 := data.bounds.y + 40.0

	# Valley floor the background hills and trees stand on.
	var floor_mesh := MeshInstance3D.new()
	floor_mesh.name = "ValleyFloor"
	var plane := PlaneMesh.new()
	plane.size = Vector2(x1 - x0 + 200.0, 140.0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("5cae46")
	mat.roughness = 1.0
	plane.material = mat
	floor_mesh.mesh = plane
	floor_mesh.position = Vector3((x0 + x1) * 0.5, VALLEY_FLOOR_Y, -9.0 - 70.0)
	floor_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	background.add_child(floor_mesh)

	# Mid-ground tree line.
	var x := x0
	while x < x1:
		var kind := "tree_pine" if _rng.randf() < 0.45 else "tree_round"
		var t := _add_model(background, kind, Vector3(x, VALLEY_FLOOR_Y, -12.0 - _rng.randf() * 8.0))
		t.scale = Vector3.ONE * (1.1 + _rng.randf() * 0.6)
		t.rotation.y = _rng.randf() * TAU
		x += 4.0 + _rng.randf() * 7.0

	# Two rows of hills.
	for row in 2:
		x = x0 + _rng.randf() * 10.0
		while x < x1:
			var h := _add_model(background, "hill_a" if _rng.randf() < 0.5 else "hill_b",
					Vector3(x, VALLEY_FLOOR_Y - 0.5, -30.0 - row * 22.0 - _rng.randf() * 6.0))
			var sc := (1.0 + _rng.randf() * 0.5) * (1.0 + row * 0.7)
			h.scale = Vector3(sc, sc * (0.8 + _rng.randf() * 0.4), sc)
			x += (16.0 + _rng.randf() * 12.0) * (1.0 + row * 0.6)

	# Clouds drift slowly (see CloudDrift).
	x = x0
	while x < x1:
		var c := ModelLib.instance("cloud_a" if _rng.randf() < 0.5 else "cloud_b")
		# Script before entering the tree so its _physics_process gets enabled.
		c.set_script(preload("res://scripts/level/cloud_drift.gd"))
		background.add_child(c)
		c.position = Vector3(x, 11.0 + _rng.randf() * 8.0, -28.0 - _rng.randf() * 30.0)
		c.scale = Vector3.ONE * (0.8 + _rng.randf() * 0.8)
		x += 14.0 + _rng.randf() * 18.0


func _add_prop(model_name: String, x: float, y: float, z: float, s: float) -> Node3D:
	var n := _add_model(decor, model_name, Vector3(x, y, z))
	n.scale = Vector3.ONE * s
	n.rotation.y = _rng.randf() * TAU
	return n


func _add_model(parent: Node3D, model_name: String, pos: Vector3) -> Node3D:
	var n := ModelLib.instance(model_name)
	parent.add_child(n)
	n.position = pos
	return n
