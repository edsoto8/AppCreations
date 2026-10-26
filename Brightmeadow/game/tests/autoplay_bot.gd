class_name AutoplayBot
extends Node
## Plays the level through the real player controller and physics, using only the inputs a
## person has (left/right, run, jump). It plans a route over the level's surfaces with the same
## reach rules as the feasibility test, runs to each take-off point, jumps with the button held,
## and steers in the air toward a landing spot. Used by tests/integration/test_autoplay.gd and
## by scripts/screenshots.sh to drive the camera through the level.

## When true the player can't be hurt (traversal check only; enemies are tested separately).
var ignore_enemies := true
var player: Player
var level: Level

var input := ScriptedInput.new()
var route: Array[LevelData.Surface] = []
var deaths := 0
var jumps := 0
var log_lines: PackedStringArray = []

var _data: LevelData
var _cfg: MovementConfig
var _step := 0
var _airborne := false
var _target: LevelData.Surface
var _target_x := 0.0
var _jump_frames := 0


func setup(p_level: Level) -> void:
	level = p_level
	player = level.player
	_data = level.data
	_cfg = player.config
	player.input = input
	player.defeated.connect(func(_c): deaths += 1)
	process_physics_priority = -10  # decide inputs before the player moves
	_plan_from(_data.surface_under(_data.spawn.x, _data.spawn.y))


func _plan_from(start: LevelData.Surface) -> void:
	var goal := _data.surface_under(_data.goal.x, _data.goal.y)
	var prev := {start: null}
	var queue: Array = [start]
	while not queue.is_empty():
		var cur: LevelData.Surface = queue.pop_front()
		if cur == goal:
			break
		var options: Array = []
		for nxt in _data.surfaces():
			if not prev.has(nxt) and _reach(cur, nxt) > 0:
				options.append(nxt)
		# Prefer surfaces further right, then closer, so the route moves forward.
		options.sort_custom(func(a, b): return a.x0 < b.x0)
		for nxt in options:
			prev[nxt] = cur
			queue.append(nxt)
	route.clear()
	var s: LevelData.Surface = goal
	while s != null:
		route.push_front(s)
		s = prev.get(s)
	_step = 0


## Same reach rule as the feasibility test (0 = no, 1 = walk, 2 = run).
func _reach(a: LevelData.Surface, b: LevelData.Surface) -> int:
	if a == b:
		return 0
	var rise := b.top - a.top
	var max_h := MovementModel.max_jump_height(_cfg) - 0.2
	if rise > max_h:
		return 0
	var gap := 0.0
	if b.x0 >= a.x1:
		gap = b.x0 - a.x1
	elif a.x0 >= b.x1:
		gap = a.x0 - b.x1
	if gap == 0.0:
		var adjacent := is_equal_approx(b.x0, a.x1) or is_equal_approx(a.x0, b.x1)
		if rise > 0.0 and not b.oneway and not adjacent:
			return 0
		return 1
	if MovementModel.max_jump_distance(_cfg, rise + 0.1, false) >= gap + 0.3:
		return 1
	if MovementModel.max_jump_distance(_cfg, rise + 0.1, true) >= gap + 0.3:
		return 2
	return 0


func _physics_process(_delta: float) -> void:
	if player == null or route.is_empty():
		return
	if ignore_enemies:
		player.invulnerable_left = maxf(player.invulnerable_left, 0.5)
	if player.state == Player.State.DEFEATED or player.state == Player.State.FROZEN:
		input.direction = 0.0
		input.jump_held = false
		_airborne = false
		return
	if player.state == Player.State.CELEBRATING:
		return

	var pos := player.global_position
	if player.is_on_floor() and _jump_frames <= 0:
		_airborne = false
		var here := _data.surface_under(pos.x, pos.y + 0.1)
		if here == null:
			return
		var idx := route.find(here)
		if idx == -1:
			_log("off route at x=%.1f (on %.0f..%.0f), replanning" % [pos.x, here.x0, here.x1])
			_plan_from(here)
			idx = 0
		_step = idx
		if _step >= route.size() - 1:
			# On the goal surface: walk to the goal.
			input.direction = signf(_data.goal.x + 2.0 - pos.x)
			input.run = false
			input.jump_held = false
			return
		_ground_control(here, route[_step + 1])
	else:
		_jump_frames -= 1
		_air_control()


func _ground_control(here: LevelData.Surface, nxt: LevelData.Surface) -> void:
	var pos := player.global_position
	var forward := 1.0 if nxt.x0 >= here.x1 - 0.01 else (-1.0 if nxt.x1 <= here.x0 + 0.01 else 0.0)
	var rise := nxt.top - here.top
	var takeoff_x: float
	var land_x: float
	if forward == 0.0:
		# Target overlaps us (one-way platform above, or a lower one below): line up under it.
		land_x = clampf((maxf(nxt.x0, here.x0) + minf(nxt.x1, here.x1)) * 0.5, nxt.x0 + 0.6, nxt.x1 - 0.6)
		takeoff_x = land_x
		if rise <= 0.0:
			# Dropping onto something below that overlaps: walk off our nearer edge.
			takeoff_x = here.x1 + 0.5 if nxt.x1 > here.x1 else here.x0 - 0.5
	else:
		var edge := here.x1 if forward > 0 else here.x0
		var gap := absf((nxt.x0 if forward > 0 else nxt.x1) - edge)
		if rise <= -0.3 and gap < 0.5:
			takeoff_x = edge + forward * 0.6  # just walk off
		elif gap == 0.0:
			takeoff_x = edge - forward * 1.2  # step up onto adjacent higher ground
		else:
			takeoff_x = edge - forward * 0.25
		var depth := minf(1.2, nxt.width() * 0.4)
		land_x = (nxt.x0 + depth) if forward > 0 else (nxt.x1 - depth)
		if nxt == route.back():
			land_x = nxt.x0 + 2.0

	var dx := takeoff_x - pos.x
	var need_run := _reach(here, nxt) == 2
	input.run = need_run or absf(dx) > 3.0
	var arrived := absf(dx) < 0.35 or (forward != 0.0 and signf(dx) != forward and absf(dx) < 1.5)
	var walking_off := forward != 0.0 and rise <= -0.3 and absf(takeoff_x - (here.x1 if forward > 0 else here.x0)) > 0.4
	if arrived and not walking_off:
		if forward == 0.0 and absf(player.velocity.x) > 1.0:
			input.direction = 0.0  # settle before a vertical jump
			return
		input.jump_held = true
		_jump_frames = 3
		_airborne = true
		_target = nxt
		_target_x = land_x
		jumps += 1
	else:
		input.jump_held = false
		input.direction = clampf(dx * 2.0, -1.0, 1.0) if absf(dx) < 0.5 else signf(dx)
		if walking_off:
			_target = nxt
			_target_x = land_x


func _air_control() -> void:
	if _target == null:
		input.direction = 0.0
		return
	var pos := player.global_position
	var v := player.velocity
	input.jump_held = true
	# Predict when we come down to the target's height and pick the speed that lands on it.
	var t := 0.0
	var y := pos.y
	var vy := v.y
	var dt := 1.0 / 60.0
	while t < 3.0 and (vy > 0.0 or y > _target.top + 0.02):
		vy = MovementModel.step_vertical(vy, true, _cfg, dt)
		y += vy * dt
		t += dt
	var want := (_target_x - pos.x) / maxf(t, 0.05)
	# While still below the target's top, keep clear of its edge (don't clip the side).
	if pos.y < _target.top - 0.05:
		var near_edge := _target.x0 - 0.45 if _target_x > pos.x else _target.x1 + 0.45
		if absf(near_edge - pos.x) < 0.3 or signf(near_edge - pos.x) != signf(_target_x - pos.x):
			want = 0.0 if not _target.oneway else want
	var top := _cfg.run_speed
	input.run = true
	input.direction = clampf(want / top + (want - v.x) * 0.15, -1.0, 1.0)


func _log(line: String) -> void:
	log_lines.append(line)
