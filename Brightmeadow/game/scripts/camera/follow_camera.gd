class_name FollowCamera
extends Camera3D
## Smooth side-follow camera. No player rotation. Looks ahead in the direction of travel, only
## re-centres vertically when the player lands somewhere new (or leaves the frame), and stays
## inside the level's horizontal bounds.

@export var distance := 15.5
@export var height := 2.3
## Downward tilt in degrees.
@export var pitch_deg := 6.0
@export var look_ahead := 2.6
@export var follow_speed_x := 5.0
@export var follow_speed_y := 3.0
## While airborne, the camera only moves vertically once the player is this far from the
## framing line (up, down).
@export var air_band := Vector2(3.2, 2.2)
@export var min_y := 1.2

var target: Player
var bounds := Vector2(-INF, INF)

var _ahead := 0.0
var _base_y := 0.0
var _focus := Vector3.ZERO


func _ready() -> void:
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	rotation = Vector3(deg_to_rad(-pitch_deg), 0, 0)


func snap_to_target() -> void:
	if target == null:
		return
	var p := _target_pos()
	_base_y = p.y
	_ahead = target.facing * look_ahead * 0.5
	_focus = Vector3(p.x + _ahead, _base_y, 0)
	_apply()


func _process(delta: float) -> void:
	if target == null:
		return
	var p := _target_pos()
	var max_speed := target.config.run_speed
	var moving := clampf(absf(target.velocity.x) / max_speed, 0.0, 1.0)
	var ahead_goal := target.facing * look_ahead * (0.35 + 0.65 * moving)
	if target.state == Player.State.DEFEATED:
		ahead_goal = _ahead
	_ahead = lerpf(_ahead, ahead_goal, 1.0 - exp(-1.6 * delta))

	if target.state == Player.State.DEFEATED:
		pass  # hold position: watch the fall
	elif target.is_on_floor():
		_base_y = p.y
	elif p.y > _base_y + air_band.x:
		_base_y = p.y - air_band.x
	elif p.y < _base_y - air_band.y:
		_base_y = p.y + air_band.y

	var goal := Vector3(p.x + _ahead, _base_y, 0)
	_focus.x = lerpf(_focus.x, goal.x, 1.0 - exp(-follow_speed_x * delta))
	_focus.y = lerpf(_focus.y, goal.y, 1.0 - exp(-follow_speed_y * delta))
	_apply()


func _target_pos() -> Vector3:
	return target.get_global_transform_interpolated().origin


func _apply() -> void:
	var half_width := _half_view_width()
	var x := _focus.x
	if bounds.y - bounds.x > half_width * 2.0:
		x = clampf(x, bounds.x + half_width, bounds.y - half_width)
	var y := maxf(_focus.y + height, min_y)
	global_position = Vector3(x, y + distance * tan(deg_to_rad(pitch_deg)), distance)


func _half_view_width() -> float:
	var vp := get_viewport()
	var aspect := 16.0 / 9.0
	if vp:
		var size := vp.get_visible_rect().size
		if size.y > 0:
			aspect = size.x / size.y
	return distance * tan(deg_to_rad(fov) * 0.5) * aspect
