class_name PlayerInput
extends RefCounted
## One physics step of player intent. The default reads the keyboard/gamepad through the
## InputMap; tests and the autoplay bot swap in a scripted subclass by overriding [method _read].

var direction := 0.0
var run := false
var jump_held := false
var jump_pressed := false

var _was_held := false


func sample() -> void:
	_read()
	# Edge-detect as well as asking Input, so scripted input and very short taps both register.
	jump_pressed = jump_pressed or (jump_held and not _was_held)
	_was_held = jump_held


func clear() -> void:
	direction = 0.0
	run = false
	jump_held = false
	jump_pressed = false


func _read() -> void:
	direction = Input.get_axis("move_left", "move_right")
	run = Input.is_action_pressed("run")
	jump_held = Input.is_action_pressed("jump")
	jump_pressed = Input.is_action_just_pressed("jump")
