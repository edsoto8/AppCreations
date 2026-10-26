class_name Checkpoint
extends Area3D
## Flag post. Touching it raises the flag and makes it the respawn point.

signal reached(checkpoint: Checkpoint)

const FLAG_LOW := 0.9
const FLAG_HIGH := 2.1
const INACTIVE_COLOR := Color(0.62, 0.66, 0.72)
const ACTIVE_COLOR := Color(0.95, 0.46, 0.23)

var index := 0
var active := false

var _flag: Node3D
var _flag_materials: Array[StandardMaterial3D] = []


func _ready() -> void:
	var model := ModelLib.instance("checkpoint")
	$Visual.add_child(model)
	_flag = model.find_child("Flag", true, false) as Node3D
	if _flag:
		_flag.position.y = FLAG_LOW
		_collect_flag_materials(_flag, false)
		if _flag_materials.is_empty():
			_collect_flag_materials(_flag, true)
		_set_flag_color(INACTIVE_COLOR)
	elif ModelLib.exists("checkpoint"):
		push_error("Checkpoint: model has no 'Flag' node (see docs/ASSET_CONTRACT.md)")
	body_entered.connect(_on_body_entered)


## Where the player reappears (feet).
func respawn_position() -> Vector3:
	return global_position + Vector3(0.6, 0.05, 0)


func _on_body_entered(body: Node3D) -> void:
	if not active and body.is_in_group("player") and body.is_alive():
		reached.emit(self)


## Called by the level once the session accepts this checkpoint.
func activate(animate := true) -> void:
	if active:
		return
	active = true
	if not animate:
		if _flag:
			_flag.position.y = FLAG_HIGH
			_set_flag_color(ACTIVE_COLOR)
		return
	Audio.play_sfx("checkpoint")
	Fx.burst(get_parent(), global_position + Vector3.UP * 2.2, Color(1.0, 0.8, 0.3), 18, 0.1, 5.0)
	if _flag:
		var tw := create_tween()
		tw.tween_property(_flag, "position:y", FLAG_HIGH, 0.6) \
				.set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
		tw.parallel().tween_method(_set_flag_color, INACTIVE_COLOR, ACTIVE_COLOR, 0.4)


## Gives the flag its own material copies. With [param all] false only the fabric (M_Banner*)
## is recoloured; wooden/metal bits that may share the mesh keep their colour.
func _collect_flag_materials(node: Node, all: bool) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var src := mi.get_active_material(i)
			var mat: StandardMaterial3D = (src.duplicate() if src is StandardMaterial3D
					else StandardMaterial3D.new())
			mi.set_surface_override_material(i, mat)
			if all or src == null or src.resource_name.begins_with("M_Banner"):
				_flag_materials.append(mat)
	for child in node.get_children():
		_collect_flag_materials(child, all)


func _set_flag_color(c: Color) -> void:
	for m in _flag_materials:
		m.albedo_color = c
