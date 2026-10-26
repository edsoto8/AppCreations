class_name JumpAssist
extends RefCounted
## Coyote time and jump buffering as a tiny pure state machine.
## Call [method tick] once per physics step; it answers whether a jump should start now.

var coyote_time := 0.1
var buffer_time := 0.12

var _coyote_left := 0.0
var _buffer_left := 0.0


func _init(coyote := 0.1, buffer := 0.12) -> void:
	coyote_time = coyote
	buffer_time = buffer


## [param on_floor]: grounded this step. [param jump_pressed]: the button went down this step.
## [param rising]: the body is already moving up from a jump (no coyote while ascending).
func tick(delta: float, on_floor: bool, jump_pressed: bool, rising := false) -> bool:
	if on_floor:
		_coyote_left = coyote_time
	else:
		_coyote_left = maxf(0.0, _coyote_left - delta)
	if rising:
		_coyote_left = 0.0

	if jump_pressed:
		_buffer_left = buffer_time
	else:
		_buffer_left = maxf(0.0, _buffer_left - delta)

	if _buffer_left > 0.0 and (on_floor or _coyote_left > 0.0):
		_buffer_left = 0.0
		_coyote_left = 0.0
		return true
	return false


## Forget any pending jump (e.g. after respawn or a stomp bounce).
func reset() -> void:
	_coyote_left = 0.0
	_buffer_left = 0.0
