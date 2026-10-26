extends Node3D
## Slow sideways drift for background clouds, wrapping around a 600 m strip.

const SPEED := 0.35
const WRAP_MIN := -60.0
const WRAP_MAX := 480.0


func _physics_process(delta: float) -> void:
	position.x += SPEED * delta
	if position.x > WRAP_MAX:
		position.x = WRAP_MIN
		reset_physics_interpolation()
