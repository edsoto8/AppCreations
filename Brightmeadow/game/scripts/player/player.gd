class_name Player
extends CharacterBody3D
## Side-scrolling platformer controller on the z = 0 plane. All tuning comes from
## [member config]; the motion math is in MovementModel so tests can check it. Visuals
## (animation, squash and stretch, blinking) live in PlayerVisual and never touch collision.

signal jumped
signal landed(impact_speed: float)
signal hurt(health_left: int)
signal stomped(enemy: Node3D)
## Emitted once when the player is defeated (fell out of the level or lost the last heart).
signal defeated(cause: StringName)

enum State { NORMAL, HURT, DEFEATED, CELEBRATING, FROZEN }

@export var config: MovementConfig = preload("res://resources/movement_default.tres")

var state: State = State.NORMAL
var input := PlayerInput.new()
## +1 facing right, -1 facing left.
var facing := 1.0
var invulnerable_left := 0.0
## Set by the level; falling below this is a lost life.
var kill_y := -7.0
## Set by the level so the HUD and tests can ask the session about health.
var session: GameSession

var _assist := JumpAssist.new()
var _stun_left := 0.0
var _oneway_bodies: Array[Node3D] = []
var _oneway_excepted := {}
var _was_on_floor := true

@onready var visual: PlayerVisual = $Visual
@onready var sensor: Area3D = $EnemySensor


func _ready() -> void:
	_assist.coyote_time = config.coyote_time
	_assist.buffer_time = config.jump_buffer_time
	floor_snap_length = 0.25
	floor_max_angle = deg_to_rad(50)
	axis_lock_linear_z = true
	refresh_oneway()


## Re-collects the one-way platforms (call after the level has been built).
func refresh_oneway() -> void:
	_oneway_bodies.clear()
	_oneway_excepted.clear()
	for body in get_tree().get_nodes_in_group("oneway"):
		_oneway_bodies.append(body)


func _physics_process(delta: float) -> void:
	invulnerable_left = maxf(0.0, invulnerable_left - delta)
	match state:
		State.FROZEN:
			return
		State.DEFEATED:
			_defeated_motion(delta)
			return
		State.CELEBRATING:
			input.clear()
		_:
			input.sample()

	if state == State.HURT:
		_stun_left -= delta
		if _stun_left <= 0.0:
			state = State.NORMAL

	_update_oneway()
	var on_floor := is_on_floor()
	var dir := input.direction if state == State.NORMAL else 0.0
	velocity.x = MovementModel.step_horizontal(velocity.x, dir, input.run, on_floor, config, delta)
	if not is_zero_approx(dir):
		facing = signf(dir)

	var rising_from_jump := velocity.y > 0.1 and not on_floor
	var want_jump := state == State.NORMAL and input.jump_pressed
	if _assist.tick(delta, on_floor, want_jump, rising_from_jump):
		# Gravity applies on the take-off step too, exactly as MovementModel.simulate_jump
		# assumes, so the measured jump matches the numbers the level was designed against.
		velocity.y = MovementModel.step_vertical(config.jump_velocity, input.jump_held, config, delta)
		jumped.emit()
	elif not on_floor:
		velocity.y = MovementModel.step_vertical(velocity.y, input.jump_held, config, delta)
	else:
		velocity.y = minf(velocity.y, 0.0)

	var prev_feet_y := global_position.y
	var fall_speed := -velocity.y
	move_and_slide()
	_lock_plane()

	var now_on_floor := is_on_floor()
	if now_on_floor and not _was_on_floor and fall_speed > 1.0:
		var hard := clampf(fall_speed / config.hard_landing_speed, 0.0, 1.0)
		velocity.x *= lerpf(1.0, config.hard_landing_speed_keep, hard)
		landed.emit(fall_speed)
	_was_on_floor = now_on_floor

	_check_enemies(prev_feet_y)
	if global_position.y < kill_y:
		defeat(&"fall")


func is_alive() -> bool:
	return state != State.DEFEATED


## Resolves contact with enemy hitboxes overlapping the sensor: stomp when coming down onto an
## enemy's top, otherwise take a hit.
func _check_enemies(prev_feet_y: float) -> void:
	if state == State.DEFEATED or state == State.CELEBRATING:
		return
	for area in sensor.get_overlapping_areas():
		var enemy := area.get_parent() as Node3D
		if enemy == null or not enemy.has_method("stomp") or not enemy.is_alive():
			continue
		var stomp_line: float = enemy.stomp_line_y()
		var descending := velocity.y <= 0.5
		if descending and prev_feet_y >= stomp_line - 0.3:
			enemy.stomp()
			var bounce := config.stomp_bounce_held if input.jump_held else config.stomp_bounce
			velocity.y = bounce
			global_position.y = maxf(global_position.y, stomp_line)
			_assist.reset()
			stomped.emit(enemy)
			return
		take_hit(enemy.global_position.x)


func take_hit(from_x: float) -> void:
	if invulnerable_left > 0.0 or state == State.DEFEATED or state == State.CELEBRATING:
		return
	var away := signf(global_position.x - from_x)
	if away == 0.0:
		away = -facing
	var out_of_health := session.damage(1) if session else false
	if out_of_health:
		defeat(&"hurt")
		return
	state = State.HURT
	_stun_left = config.hurt_stun_time
	invulnerable_left = config.invulnerable_time
	velocity = Vector3(away * config.hurt_knockback.x, config.hurt_knockback.y, 0)
	hurt.emit(session.health if session else 0)


func defeat(cause: StringName) -> void:
	if state == State.DEFEATED:
		return
	state = State.DEFEATED
	invulnerable_left = 0.0
	# A little "oh no" hop, then fall out of view (falls just keep falling).
	velocity = Vector3(0, 9.0 if cause == &"hurt" else 0.0, 0)
	set_collision_mask_value(1, false)
	defeated.emit(cause)


func celebrate() -> void:
	state = State.CELEBRATING
	invulnerable_left = 999.0


## Puts the player back at [param pos] (feet) ready to play, briefly invulnerable.
func respawn_at(pos: Vector3, invulnerable := 1.5) -> void:
	global_position = Vector3(pos.x, pos.y, 0)
	velocity = Vector3.ZERO
	state = State.NORMAL
	facing = 1.0
	invulnerable_left = invulnerable
	set_collision_mask_value(1, true)
	_assist.reset()
	_was_on_floor = true
	_oneway_excepted.clear()
	for body in _oneway_bodies:
		if is_instance_valid(body):
			remove_collision_exception_with(body)
	reset_physics_interpolation()
	if visual:
		visual.reset_pose()


func freeze() -> void:
	state = State.FROZEN
	velocity = Vector3.ZERO


func _defeated_motion(delta: float) -> void:
	velocity.y = maxf(velocity.y - config.gravity * delta, -config.max_fall_speed)
	global_position += velocity * delta
	_lock_plane()


## One-way platforms: solid only while the feet are above their top, so you can jump up
## through them from below and walk underneath them.
func _update_oneway() -> void:
	var feet := global_position.y
	for body in _oneway_bodies:
		if not is_instance_valid(body):
			continue
		if absf(body.global_position.x - global_position.x) > 12.0:
			continue
		var top: float = body.get_meta("top")
		var pass_through := feet < top - 0.06
		if pass_through != _oneway_excepted.get(body, false):
			_oneway_excepted[body] = pass_through
			if pass_through:
				add_collision_exception_with(body)
			else:
				remove_collision_exception_with(body)


func _lock_plane() -> void:
	if global_position.z != 0.0:
		global_position.z = 0.0
	velocity.z = 0.0
