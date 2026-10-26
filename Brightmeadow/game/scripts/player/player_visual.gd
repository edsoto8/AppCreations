class_name PlayerVisual
extends Node3D
## Presentation of the player: picks animations from the body's motion, turns to face the
## travel direction, adds squash and stretch, dust puffs and invulnerability blinking.
## Only this node (pivot at the feet) is scaled or rotated; the collision capsule is untouched.

const LOOPING := ["idle", "walk", "run", "fall", "celebrate"]
## Yaw that turns the model (built facing +Z, the camera) to face +X, minus a little so the face
## stays partly visible to the camera.
const SIDE_YAW := PI / 2.0 - 0.38

var _model: Node3D
var _anim: AnimationPlayer
var _current := ""
var _one_shot_left := 0.0
var _yaw := SIDE_YAW
## Squash-and-stretch spring: 1 = rest, >1 tall/thin, <1 short/wide.
var _stretch := 1.0
var _stretch_vel := 0.0
var _blink_time := 0.0

@onready var body: Player = get_parent()
var dust: CPUParticles3D


func _ready() -> void:
	_model = ModelLib.instance("explorer")
	add_child(_model)
	ModelLib.set_visual_layers(_model, 2)
	_anim = ModelLib.find_animation_player(_model)
	ModelLib.set_looping(_anim, LOOPING)
	dust = Fx.make_dust()
	add_child(dust)
	body.jumped.connect(_on_jumped)
	body.landed.connect(_on_landed)
	body.hurt.connect(_on_hurt)
	body.stomped.connect(func(_e): _kick(0.22))
	body.defeated.connect(_on_defeated)
	_play("idle", 0.0)


func reset_pose() -> void:
	_stretch = 1.0
	_stretch_vel = 0.0
	_one_shot_left = 0.0
	_yaw = SIDE_YAW
	visible = true
	_play("idle", 0.0)


func _process(delta: float) -> void:
	_update_animation(delta)
	_update_blink(delta)


# Transform changes happen on physics ticks so physics interpolation smooths them along with
# the body (changing an interpolated node's transform in _process would stutter).
func _physics_process(delta: float) -> void:
	_update_facing(delta)
	_update_stretch(delta)


func _update_animation(delta: float) -> void:
	_one_shot_left -= delta
	var v := body.velocity
	match body.state:
		Player.State.DEFEATED:
			_play("hurt")
			return
		Player.State.CELEBRATING:
			if body.is_on_floor():
				_play("celebrate", 0.2)
			return
		Player.State.HURT:
			_play("hurt", 0.05)
			return
	if _one_shot_left > 0.0:
		return
	if body.is_on_floor():
		var speed := absf(v.x)
		if speed < 0.4:
			_play("idle", 0.2)
		elif speed <= body.config.walk_speed + 0.3:
			_play("walk", 0.15, clampf(speed / body.config.walk_speed, 0.5, 1.3))
		else:
			_play("run", 0.12, clampf(speed / body.config.run_speed, 0.7, 1.25))
	else:
		_play("jump" if v.y > 0.5 else "fall", 0.12)


func _update_facing(delta: float) -> void:
	var target := SIDE_YAW * body.facing
	if body.state == Player.State.CELEBRATING:
		target = 0.0  # face the camera
	_yaw = lerp_angle(_yaw, target, 1.0 - exp(-16.0 * delta))
	rotation.y = _yaw


func _update_stretch(delta: float) -> void:
	# Critically-damped-ish spring back to 1.
	var k := 260.0
	var damping := 18.0
	_stretch_vel += (-(_stretch - 1.0) * k - _stretch_vel * damping) * delta
	_stretch += _stretch_vel * delta
	# Stretch a little with vertical speed in the air.
	var air := 0.0
	if not body.is_on_floor() and body.state != Player.State.DEFEATED:
		air = clampf(body.velocity.y / 30.0, -0.06, 0.08)
	var s := clampf(_stretch + air, 0.6, 1.4)
	var w := 1.0 / sqrt(s)
	scale = Vector3(w, s, w)


func _update_blink(delta: float) -> void:
	if body.invulnerable_left > 0.0 and body.state != Player.State.CELEBRATING:
		_blink_time += delta
		visible = fmod(_blink_time, 0.16) < 0.1
	else:
		_blink_time = 0.0
		visible = true


func _kick(amount: float) -> void:
	_stretch_vel += amount * 14.0


func _on_jumped() -> void:
	_stretch = 0.82  # brief anticipation squash...
	_stretch_vel = 9.0  # ...that springs into a stretch
	_play_one_shot("jump", 0.05, 0.0)
	_puff(6)
	Audio.play_sfx("jump", 0.06)


func _on_landed(impact: float) -> void:
	var hard := clampf(impact / body.config.hard_landing_speed, 0.0, 1.0)
	_stretch = lerpf(0.9, 0.68, hard)
	_stretch_vel = 0.0
	if hard > 0.35:
		_play_one_shot("land", 0.05, 0.18)
	_puff(int(lerpf(4, 14, hard)))
	Audio.play_sfx("land", 0.1, lerpf(-14.0, -6.0, hard))


func _on_hurt(_health: int) -> void:
	_stretch = 0.75
	_play_one_shot("hurt", 0.05, 0.35)
	Audio.play_sfx("hurt")


func _on_defeated(cause: StringName) -> void:
	Audio.play_sfx("fall" if cause == &"fall" else "hurt")


func _puff(amount: int) -> void:
	if dust == null:
		return
	dust.amount = maxi(amount, 1)
	dust.restart()
	dust.emitting = true


func _play_one_shot(anim_name: String, blend: float, hold: float) -> void:
	_current = ""
	_play(anim_name, blend)
	_one_shot_left = hold


func _play(anim_name: String, blend := 0.15, speed := 1.0) -> void:
	if _anim == null or not _anim.has_animation(anim_name):
		return
	if _current != anim_name:
		_anim.play(anim_name, blend)
		_current = anim_name
	_anim.speed_scale = speed
