class_name Bramblebug
extends CharacterBody3D
## Ground patroller: walks along its surface, turning at walls, ledges and the optional patrol
## range. Stomp from above to defeat it; touching it from the side hurts.

const SPEED := 1.7
const GRAVITY := 30.0
## Height above the origin (feet) of the top of the shell.
const STOMP_HEIGHT := 0.6
const ACTIVATION_RANGE := 24.0

var direction := -1.0
## Optional patrol limits in world x; (0, 0) = whole surface.
var patrol_range := Vector2.ZERO

var _alive := true
var _model: Node3D
var _anim: AnimationPlayer
var _yaw := 0.0

@onready var hitbox: Area3D = $Hitbox
@onready var visual: Node3D = $Visual


func _ready() -> void:
	_model = ModelLib.instance("bramblebug")
	visual.add_child(_model)
	_anim = ModelLib.find_animation_player(_model)
	ModelLib.set_looping(_anim, ["walk", "idle"])
	if _anim and _anim.has_animation("walk"):
		_anim.play("walk")
		_anim.seek(randf() * 0.5)
	_yaw = _target_yaw()
	visual.rotation.y = _yaw


func is_alive() -> bool:
	return _alive


func stomp_line_y() -> float:
	return global_position.y + STOMP_HEIGHT


func _physics_process(delta: float) -> void:
	if not _alive:
		return
	var player := get_tree().get_first_node_in_group("player") as Node3D
	if player and absf(player.global_position.x - global_position.x) > ACTIVATION_RANGE:
		return
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	else:
		velocity.y = -0.5
		if _should_turn():
			direction = -direction
	velocity.x = direction * SPEED
	velocity.z = 0.0
	move_and_slide()
	global_position.z = 0.0
	_yaw = lerp_angle(_yaw, _target_yaw(), 1.0 - exp(-10.0 * delta))
	visual.rotation.y = _yaw


func _should_turn() -> bool:
	if is_on_wall():
		var n := get_wall_normal()
		if signf(n.x) == -direction:
			return true
	var x := global_position.x
	if patrol_range != Vector2.ZERO:
		if (direction < 0 and x <= patrol_range.x) or (direction > 0 and x >= patrol_range.y):
			return true
	# Ledge check: is there floor just ahead?
	var ahead := global_position + Vector3(direction * 0.55, 0.3, 0)
	var query := PhysicsRayQueryParameters3D.create(ahead, ahead + Vector3.DOWN * 0.8, 1)
	return get_world_3d().direct_space_state.intersect_ray(query).is_empty()


func _target_yaw() -> float:
	# Model faces +Z; turn to the walking direction but keep the face a bit toward the camera.
	return (PI / 2.0 - 0.45) * direction


func stomp() -> void:
	if not _alive:
		return
	_alive = false
	hitbox.set_deferred("monitorable", false)
	Audio.play_sfx("stomp")
	Fx.burst(get_parent(), global_position + Vector3.UP * 0.4, Color(0.75, 0.55, 0.95), 14)
	if _anim:
		_anim.pause()
	var tw := create_tween()
	tw.tween_property(visual, "scale", Vector3(1.4, 0.25, 1.4), 0.08)
	tw.tween_interval(0.35)
	tw.tween_property(visual, "scale", Vector3(0.01, 0.01, 0.01), 0.15)
	tw.tween_callback(queue_free)
