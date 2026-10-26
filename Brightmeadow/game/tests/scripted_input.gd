class_name ScriptedInput
extends PlayerInput
## Player input driven by code (tests and the autoplay bot). Set direction / run / jump_held;
## jump presses are detected from jump_held going down.


func _read() -> void:
	jump_pressed = false
