extends TestCase
## Movement math (MovementModel) and jump assists (JumpAssist).

const DT := 1.0 / 60.0
var cfg: MovementConfig = preload("res://resources/movement_default.tres")


func _run_for(seconds: float, vx: float, dir: float, run: bool, on_floor := true) -> float:
	var t := 0.0
	while t < seconds:
		vx = MovementModel.step_horizontal(vx, dir, run, on_floor, cfg, DT)
		t += DT
	return vx


func test_accelerates_to_walk_and_run_speed() -> void:
	check_near(_run_for(1.0, 0.0, 1.0, false), cfg.walk_speed, 0.001, "walk top speed")
	check_near(_run_for(1.0, 0.0, 1.0, true), cfg.run_speed, 0.001, "run top speed")
	check_near(_run_for(1.0, 0.0, -1.0, false), -cfg.walk_speed, 0.001, "walk left")


func test_reaches_walk_speed_quickly() -> void:
	var t := 0.0
	var vx := 0.0
	while vx < cfg.walk_speed - 0.01 and t < 2.0:
		vx = MovementModel.step_horizontal(vx, 1.0, false, true, cfg, DT)
		t += DT
	note("time to walk speed: %.3f s" % t)
	check(t < 0.25, "should take < 0.25 s, took %.3f" % t)


func test_stops_when_input_released() -> void:
	var vx := _run_for(0.5, cfg.walk_speed, 0.0, false)
	check_eq(vx, 0.0, "ground stop")


func test_turning_is_faster_than_accelerating() -> void:
	var turned := MovementModel.step_horizontal(cfg.walk_speed, -1.0, false, true, cfg, DT)
	var accelerated := MovementModel.step_horizontal(0.0, 1.0, false, true, cfg, DT)
	check(cfg.walk_speed - turned > accelerated, "turn delta should beat accel delta")


func test_air_control_is_weaker_than_ground() -> void:
	var air := MovementModel.step_horizontal(0.0, 1.0, false, false, cfg, DT)
	var ground := MovementModel.step_horizontal(0.0, 1.0, false, true, cfg, DT)
	check(air < ground and air > 0.0, "air accel should be positive but weaker")


func test_releasing_run_eases_down() -> void:
	var vx := MovementModel.step_horizontal(cfg.run_speed, 1.0, false, true, cfg, DT)
	check(vx < cfg.run_speed and vx > cfg.walk_speed, "eases from run toward walk, got %.2f" % vx)


func test_gravity_modes() -> void:
	check_eq(MovementModel.gravity_for(10.0, true, cfg), cfg.gravity, "rising held")
	check_eq(MovementModel.gravity_for(10.0, false, cfg),
			cfg.gravity * cfg.jump_release_gravity_mult, "rising released")
	check_eq(MovementModel.gravity_for(-10.0, true, cfg), cfg.gravity * cfg.fall_gravity_mult, "falling")
	check_eq(MovementModel.gravity_for(0.5, true, cfg), cfg.gravity * cfg.apex_gravity_mult, "apex")


func test_terminal_velocity() -> void:
	var vy := 0.0
	for i in 600:
		vy = MovementModel.step_vertical(vy, false, cfg, DT)
	check_eq(vy, -cfg.max_fall_speed, "terminal")


func test_jump_heights() -> void:
	var full := MovementModel.max_jump_height(cfg)
	var tap := MovementModel.min_jump_height(cfg)
	note("full jump %.2f m, tap jump %.2f m" % [full, tap])
	check(full > 2.1 and full < 2.6, "full jump should be ~2.3 m, got %.2f" % full)
	check(tap > 0.6 and tap < 1.2, "tap jump should be ~0.9 m, got %.2f" % tap)


func test_variable_jump_grows_with_hold_time() -> void:
	var last := 0.0
	for hold in [0.0, 0.08, 0.16, 0.24, 0.5]:
		var apex := 0.0
		for p in MovementModel.simulate_jump(cfg, 0.0, 0.0, false, hold, 0.0):
			apex = maxf(apex, p.y)
		check(apex >= last - 0.001, "apex should not shrink with longer hold (%.2f)" % hold)
		last = apex


func test_running_jumps_further() -> void:
	var walk := MovementModel.max_jump_distance(cfg, 0.0, false)
	var run := MovementModel.max_jump_distance(cfg, 0.0, true)
	note("flat jump reach: walk %.2f m, run %.2f m" % [walk, run])
	check(run > walk + 1.5, "running jump should be clearly longer")
	check_eq(MovementModel.max_jump_distance(cfg, 5.0, true), -1.0, "5 m rise unreachable")


func test_coyote_time() -> void:
	# Walk off a ledge, press jump after n airborne frames: should work for ~0.1 s (6 frames).
	var frames_ok := 0
	for n in 12:
		var assist := JumpAssist.new(0.1, 0.12)
		assist.tick(DT, true, false)
		for j in n:
			assist.tick(DT, false, false)
		if assist.tick(DT, false, true):
			frames_ok += 1
	note("coyote frames: %d" % frames_ok)
	check(frames_ok >= 5 and frames_ok <= 7, "≈6 frames of coyote time, got %d" % frames_ok)


func test_no_coyote_while_rising() -> void:
	var a := JumpAssist.new(0.1, 0.12)
	a.tick(DT, true, false)
	check(not a.tick(DT, false, true, true), "no second jump while rising from a jump")


func test_jump_buffer() -> void:
	var a := JumpAssist.new(0.1, 0.12)
	a.tick(DT, false, false)
	a.tick(DT, false, true)  # pressed in the air, too early
	for i in 4:
		check(not a.tick(DT, false, false), "no jump while airborne")
	check(a.tick(DT, true, false), "buffered jump fires on landing")
	check(not a.tick(DT, true, false), "buffer is consumed")


func test_jump_buffer_expires() -> void:
	var a := JumpAssist.new(0.1, 0.12)
	a.tick(DT, false, true)
	for i in 12:
		a.tick(DT, false, false)
	check(not a.tick(DT, true, false), "stale press should not jump")
