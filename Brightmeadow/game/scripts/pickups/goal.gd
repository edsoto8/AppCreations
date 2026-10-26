class_name Goal
extends Area3D
## Finish arch. Walking through it completes the level.

signal reached

var _emblem: Node3D
var _done := false
var _t := 0.0


func _ready() -> void:
	var model := ModelLib.instance("goal")
	$Visual.add_child(model)
	_emblem = model.find_child("Emblem", true, false) as Node3D
	if _emblem == null and ModelLib.exists("goal"):
		push_error("Goal: model has no 'Emblem' node (see docs/ASSET_CONTRACT.md)")
	body_entered.connect(_on_body_entered)


func _physics_process(delta: float) -> void:
	_t += delta
	if _emblem:
		_emblem.rotation.y = _t * (6.0 if _done else 1.2)


func _on_body_entered(body: Node3D) -> void:
	if _done or not body.is_in_group("player") or not body.is_alive():
		return
	_done = true
	Fx.burst(get_parent(), global_position + Vector3.UP * 4.6, Color(1.0, 0.85, 0.3), 40, 0.14, 8.0)
	Fx.burst(get_parent(), global_position + Vector3(-1.5, 3.5, 0), Color(0.95, 0.46, 0.23), 24, 0.12, 7.0)
	Fx.burst(get_parent(), global_position + Vector3(1.5, 3.5, 0), Color(0.14, 0.65, 0.65), 24, 0.12, 7.0)
	reached.emit()
