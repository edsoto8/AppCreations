extends TestCase
## Checks the handcrafted level against the real movement numbers (MovementConfig): every
## surface on the route is reachable, the goal and checkpoints can be reached from the start,
## no jump needs running before the run tutorial sign, coins are within reach, and enemies
## don't sit on spawn/respawn points or inside platforms.

const LAYOUT := "res://levels/level_01.json"
## Extra horizontal distance a jump must cover beyond the bare gap (lands the feet inside).
const LAND_MARGIN := 0.3
## Jumps must clear a rise by at least this much (head-room for imperfect timing).
const RISE_MARGIN := 0.2
## The "Hold SHIFT to run" sign: no route jump before it may need running.
const RUN_TUTORIAL_X := 79.0

var cfg: MovementConfig = preload("res://resources/movement_default.tres")
var data: LevelData
var surfaces: Array[LevelData.Surface] = []
var max_h := 0.0


func before_each() -> void:
	data = LevelData.load_file(LAYOUT)
	surfaces = data.surfaces()
	max_h = MovementModel.max_jump_height(cfg)


## 0 = unreachable, 1 = walking jump, 2 = needs a running jump. Also drops (falls) count.
func _edge(a: LevelData.Surface, b: LevelData.Surface) -> int:
	if a == b:
		return 0
	var rise := b.top - a.top
	var gap: float
	if b.x0 >= a.x1:
		gap = b.x0 - a.x1
	elif a.x0 >= b.x1:
		gap = a.x0 - b.x1
	else:
		gap = 0.0  # overlapping in x
	if gap == 0.0:
		# Overlap or touching: straight up/down. Up only through one-way platforms or onto an
		# adjacent step; never up into the underside of solid ground.
		if rise <= 0.0:
			return 1
		var adjacent := is_equal_approx(b.x0, a.x1) or is_equal_approx(a.x0, b.x1)
		if not b.oneway and not adjacent:
			return 0
		return 1 if rise <= max_h - RISE_MARGIN else 0
	if rise > max_h - RISE_MARGIN:
		return 0
	var need := gap + LAND_MARGIN
	var walk := MovementModel.max_jump_distance(cfg, rise + RISE_MARGIN * 0.5, false)
	if walk >= need:
		return 1
	var run := MovementModel.max_jump_distance(cfg, rise + RISE_MARGIN * 0.5, true)
	if run >= need and a.width() >= 2.0:
		return 2
	return 0


func _surface_at(p: Vector2) -> LevelData.Surface:
	return data.surface_under(p.x, p.y)


## BFS that prefers walking jumps; returns {surface: [cost, prev]}.
func _explore(from: LevelData.Surface, allow_run: bool) -> Dictionary:
	var seen := {from: null}
	var queue: Array = [from]
	while not queue.is_empty():
		var cur: LevelData.Surface = queue.pop_front()
		for nxt in surfaces:
			if seen.has(nxt):
				continue
			var e := _edge(cur, nxt)
			if e == 1 or (e == 2 and allow_run):
				seen[nxt] = cur
				queue.append(nxt)
	return seen


func test_goal_and_checkpoints_reachable_from_start() -> void:
	var start := _surface_at(data.spawn)
	var reach := _explore(start, true)
	var goal := _surface_at(data.goal)
	check(reach.has(goal), "goal surface reachable from spawn")
	for cp in data.checkpoints:
		check(reach.has(_surface_at(cp)), "checkpoint at x=%.1f reachable" % cp.x)
	var unreachable := []
	for s in surfaces:
		if not reach.has(s):
			unreachable.append("[%.0f..%.0f @%.1f]" % [s.x0, s.x1, s.top])
	check(unreachable.is_empty(), "every surface reachable; not: %s" % ", ".join(unreachable))
	note("%d/%d surfaces reachable, full jump %.2f m" % [reach.size(), surfaces.size(), max_h])


func test_goal_reachable_from_every_checkpoint_and_surface() -> void:
	var goal := _surface_at(data.goal)
	var stuck := []
	for s in surfaces:
		if not _explore(s, true).has(goal):
			stuck.append("[%.0f..%.0f @%.1f]" % [s.x0, s.x1, s.top])
	check(stuck.is_empty(), "no soft-locks; can't reach goal from: %s" % ", ".join(stuck))


func test_no_running_jumps_needed_before_run_tutorial() -> void:
	var start := _surface_at(data.spawn)
	var walk_reach := _explore(start, false)
	var furthest := -INF
	for s in walk_reach:
		furthest = maxf(furthest, s.x1)
	note("walking-only route reaches x = %.1f (run sign at %.0f)" % [furthest, RUN_TUTORIAL_X])
	check(furthest >= RUN_TUTORIAL_X, "the opening must be beatable without running")


func test_route_jump_report() -> void:
	# Count the jumps along the route that need a run, for the design notes.
	var needs_run := []
	for a in surfaces:
		for b in surfaces:
			if b.x0 >= a.x1 and b.x0 - a.x1 > 0.0 and b.x0 - a.x1 < 6.0 and _edge(a, b) == 2:
				needs_run.append("%.0f→%.0f" % [a.x1, b.x0])
	note("forward jumps that need running: %s" % ", ".join(needs_run))
	check(needs_run.size() <= 8, "running jumps should stay occasional")


func test_coins_within_reach() -> void:
	# Coin centre must be reachable by the body (feet + 0.75 m centre + 0.45 m pickup radius).
	var reach_up := max_h + 0.75 + 0.45
	var bad := []
	for c in data.coins:
		var ok := false
		for s in surfaces:
			if c.x >= s.x0 - 4.0 and c.x <= s.x1 + 4.0 and c.y - s.top <= reach_up and c.y >= s.top:
				ok = true
				break
		if not ok:
			bad.append("(%.1f, %.1f)" % [c.x, c.y])
	check(bad.is_empty(), "unreachable coins: %s" % ", ".join(bad))


func test_coins_not_inside_terrain() -> void:
	var bad := []
	for c in data.coins:
		for s in surfaces:
			var bottom := s.top - (LevelData.PLATFORM_THICKNESS if s.oneway else 100.0)
			if c.x > s.x0 + 0.1 and c.x < s.x1 - 0.1 and c.y < s.top + 0.35 and c.y > bottom - 0.35:
				bad.append("(%.1f, %.1f)" % [c.x, c.y])
	check(bad.is_empty(), "coins inside terrain: %s" % ", ".join(bad))


func test_enemies_keep_clear_of_spawn_points() -> void:
	var points: Array[Vector2] = [data.spawn]
	for cp in data.checkpoints:
		points.append(cp)
	for e in data.enemies:
		if e["type"] != "bramblebug":
			continue
		var lo: float = e["x"]
		var hi: float = e["x"]
		if e.has("range"):
			lo = e["range"][0]
			hi = e["range"][1]
		else:
			var s := data.surface_under(e["x"], e["y"])
			if s:
				lo = s.x0
				hi = s.x1
		for p in points:
			var same_height := absf(p.y - float(e["y"])) < 0.5
			check(not (same_height and p.x > lo - 3.0 and p.x < hi + 3.0),
					"bramblebug at x=%.0f patrols within 3 m of respawn point x=%.1f" % [e["x"], p.x])


func test_bramblebugs_stand_on_surfaces() -> void:
	for e in data.enemies:
		if e["type"] == "bramblebug":
			var s := data.surface_under(e["x"], e["y"])
			check(s != null and is_equal_approx(s.top, float(e["y"])),
					"bramblebug at x=%.0f should start on a surface top" % e["x"])


func test_flyers_avoid_platform_bodies() -> void:
	for e in data.enemies:
		if e["type"] != "buzzpuff":
			continue
		var a := Vector2(e["a"][0], e["a"][1])
		var b := Vector2(e["b"][0], e["b"][1])
		for i in 21:
			var p := a.lerp(b, i / 20.0)
			for s in data.platforms:
				var inside := (p.x > s.x0 - 0.4 and p.x < s.x1 + 0.4
						and p.y > s.top - LevelData.PLATFORM_THICKNESS - 0.55 and p.y < s.top + 0.4)
				check(not inside, "buzzpuff path %s→%s clips platform at x=%.0f" % [a, b, s.x0])
