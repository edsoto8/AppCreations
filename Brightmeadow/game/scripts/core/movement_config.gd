class_name MovementConfig
extends Resource
## Every player movement number lives here. The default instance is
## res://resources/movement_default.tres; the player, the jump-feasibility test and the level
## checks all read the same resource, so tuning here is automatically re-verified.

@export_group("Horizontal")
## Top speed while walking (m/s).
@export var walk_speed := 6.0
## Top speed while the run button is held (m/s).
@export var run_speed := 9.5
## Acceleration toward the target speed on the ground (m/s²).
@export var ground_accel := 42.0
## Deceleration with no input on the ground (m/s²).
@export var ground_decel := 50.0
## Acceleration when reversing direction on the ground (m/s²). Higher = snappier turns.
@export var turn_accel := 80.0
## Acceleration in the air (air control) (m/s²).
@export var air_accel := 30.0
## Deceleration with no input in the air (m/s²).
@export var air_decel := 12.0

@export_group("Vertical")
## Gravity while rising with jump held (m/s²).
@export var gravity := 38.0
## Gravity multiplier while falling (snappier descent).
@export var fall_gravity_mult := 1.55
## Gravity multiplier while rising after jump is released (variable jump height).
@export var jump_release_gravity_mult := 2.8
## Near the apex with jump held, gravity is scaled by this for a little hang time.
@export var apex_gravity_mult := 0.6
## |vertical speed| below which the apex modifier applies (m/s).
@export var apex_threshold := 1.6
## Initial upward speed of a jump (m/s).
@export var jump_velocity := 13.5
## Terminal fall speed (m/s).
@export var max_fall_speed := 22.0

@export_group("Assists")
## Seconds after leaving a ledge during which a jump still works.
@export var coyote_time := 0.1
## Seconds a jump press is remembered before landing.
@export var jump_buffer_time := 0.12

@export_group("Stomp and damage")
## Bounce speed after stomping an enemy (m/s).
@export var stomp_bounce := 10.5
## Bounce speed after stomping with jump held (m/s).
@export var stomp_bounce_held := 14.0
## Knockback when hurt: horizontal and vertical speed (m/s).
@export var hurt_knockback := Vector2(7.0, 7.5)
## Seconds of reduced control after being hurt.
@export var hurt_stun_time := 0.35
## Seconds of invulnerability after being hurt.
@export var invulnerable_time := 1.6

@export_group("Landing")
## Fall speed (m/s) at which the landing squash is at full strength.
@export var hard_landing_speed := 18.0
## Fraction of horizontal speed kept on a hard landing (1 = no slowdown).
@export var hard_landing_speed_keep := 0.85
