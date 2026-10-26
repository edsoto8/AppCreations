class_name MovementModel
extends RefCounted
## Pure movement math shared by the player controller, unit tests and the jump-feasibility
## checks. No nodes, no globals: the same inputs always give the same outputs.


## New horizontal speed after one step.
## [param input_dir] is -1..1, [param run] is the run button.
static func step_horizontal(vx: float, input_dir: float, run: bool, on_floor: bool,
		cfg: MovementConfig, delta: float) -> float:
	var top := cfg.run_speed if run else cfg.walk_speed
	var target := input_dir * top
	var rate: float
	if is_zero_approx(input_dir):
		rate = cfg.ground_decel if on_floor else cfg.air_decel
	elif vx != 0.0 and signf(vx) != signf(input_dir):
		rate = cfg.turn_accel if on_floor else cfg.air_accel
	elif absf(vx) > absf(target):
		# Above the target (e.g. let go of run): ease down, don't snap.
		rate = cfg.ground_decel if on_floor else cfg.air_decel
	else:
		rate = cfg.ground_accel if on_floor else cfg.air_accel
	return move_toward(vx, target, rate * delta)


## Gravity to apply this step for the given vertical speed.
static func gravity_for(vy: float, jump_held: bool, cfg: MovementConfig) -> float:
	if vy <= 0.0:
		if jump_held and absf(vy) < cfg.apex_threshold:
			return cfg.gravity * cfg.apex_gravity_mult
		return cfg.gravity * cfg.fall_gravity_mult
	if not jump_held:
		return cfg.gravity * cfg.jump_release_gravity_mult
	if vy < cfg.apex_threshold:
		return cfg.gravity * cfg.apex_gravity_mult
	return cfg.gravity


## New vertical speed after one airborne step.
static func step_vertical(vy: float, jump_held: bool, cfg: MovementConfig, delta: float) -> float:
	vy -= gravity_for(vy, jump_held, cfg) * delta
	return maxf(vy, -cfg.max_fall_speed)


## Simulates a jump from the ground with the button held for [param hold_time] seconds and the
## given horizontal input, sampling the (x, y) trajectory every physics step until the body has
## fallen [param drop] metres below the take-off height. Starts at [param start_vx].
static func simulate_jump(cfg: MovementConfig, start_vx: float, input_dir: float, run: bool,
		hold_time: float, drop: float, delta := 1.0 / 60.0) -> PackedVector2Array:
	var points := PackedVector2Array()
	var pos := Vector2.ZERO
	var vx := start_vx
	var vy := cfg.jump_velocity
	var t := 0.0
	points.append(pos)
	while (t == 0.0 or pos.y > -drop) and t < 10.0:
		var held := t < hold_time
		vx = step_horizontal(vx, input_dir, run, false, cfg, delta)
		vy = step_vertical(vy, held, cfg, delta)
		pos += Vector2(vx, vy) * delta
		t += delta
		points.append(pos)
	return points


## Highest point reached by a full (held) jump.
static func max_jump_height(cfg: MovementConfig, delta := 1.0 / 60.0) -> float:
	var best := 0.0
	for p in simulate_jump(cfg, 0.0, 0.0, false, 10.0, 0.0, delta):
		best = maxf(best, p.y)
	return best


## Lowest apex reached by a tap jump (button released immediately).
static func min_jump_height(cfg: MovementConfig, delta := 1.0 / 60.0) -> float:
	var best := 0.0
	for p in simulate_jump(cfg, 0.0, 0.0, false, delta, 0.0, delta):
		best = maxf(best, p.y)
	return best


## Furthest horizontal distance at which a full jump at top speed can land on a surface
## [param rise] metres above (positive) or below (negative) the take-off surface. Returns -1 when
## that height can't be reached. Distances are measured for the body's centre.
static func max_jump_distance(cfg: MovementConfig, rise: float, run: bool,
		delta := 1.0 / 60.0) -> float:
	var speed := cfg.run_speed if run else cfg.walk_speed
	var pts := simulate_jump(cfg, speed, 1.0, run, 10.0, maxf(0.0, -rise) + 0.01, delta)
	var apex := 0.0
	for p in pts:
		apex = maxf(apex, p.y)
	if apex < rise:
		return -1.0
	# Furthest x where the descending trajectory is still at or above the target height.
	var best := -1.0
	for i in range(1, pts.size()):
		if pts[i].y >= rise:
			best = pts[i].x
	return best
