class_name Buzzpuff
extends Node3D
## Flyer that glides back and forth between two points on a steady beat, with a gentle bob.
## Stomp it from above; touching it otherwise hurts.

const RADIUS := 0.42

var point_a := Vector3.ZERO
var point_b := Vector3.ZERO
## Seconds for a full A → B → A trip.
var period := 3.0

var _alive := true
var _t := 0.0
var _model: Node3D
var _anim: AnimationPlayer
var _yaw := 0.0
var _last_x := 0.0

@onready var hitbox: Area3D = $Hitbox
@onready var visual: Node3D = $Visual


func _ready() -> void:
	_model = ModelLib.instance("buzzpuff")
	visual.add_child(_model)
	_anim = ModelLib.find_animation_player(_model)
	ModelLib.set_looping(_anim, ["fly"])
	if _anim and _anim.has_animation("fly"):
		_anim.play("fly")
	# Every flyer starts at point A when the level loads, so the pattern is the same each play.
	_t = 0.0
	global_position = point_a
	_last_x = point_a.x
	_yaw = -(PI / 2.0 - 0.5)


func is_alive() -> bool:
	return _alive


func stomp_line_y() -> float:
	return global_position.y + RADIUS * 0.6


func _physics_process(delta: float) -> void:
	if not _alive:
		return
	_t += delta
	var phase := (1.0 - cos(TAU * _t / period)) * 0.5
	var pos := point_a.lerp(point_b, phase)
	pos.y += sin(_t * 5.0) * 0.12
	global_position = pos
	var dx := pos.x - _last_x
	_last_x = pos.x
	if absf(dx) > 0.001:
		_yaw = lerp_angle(_yaw, (PI / 2.0 - 0.5) * signf(dx), 1.0 - exp(-8.0 * delta))
	visual.rotation.y = _yaw


func stomp() -> void:
	if not _alive:
		return
	_alive = false
	hitbox.set_deferred("monitorable", false)
	Audio.play_sfx("stomp", 0.0, 0.0, 1.15)
	Fx.burst(get_parent(), global_position, Color(1.0, 0.65, 0.75), 16)
	if _anim:
		_anim.pause()
	var tw := create_tween().set_process_mode(Tween.TWEEN_PROCESS_PHYSICS).set_parallel()
	tw.tween_property(visual, "scale", Vector3(1.35, 0.3, 1.35), 0.08)
	tw.tween_property(self, "global_position:y", global_position.y - 6.0, 0.7) \
			.set_delay(0.15).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
	tw.tween_property(visual, "rotation:z", 3.0, 0.7).set_delay(0.15)
	tw.chain().tween_callback(queue_free)
