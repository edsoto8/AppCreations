extends TestCase
## Level JSON parsing.


func test_coin_expansion() -> void:
	var d := LevelData.from_dict({
		"coins": [[1, 2], {"line": [0, 0, 4, 0, 5]}, {"arc": [0, 4, 1, 2, 3]}],
	})
	check_eq(d.coins.size(), 9, "1 + 5 + 3 coins")
	check_eq(d.coins[3], Vector2(2, 0), "line midpoint")
	check_eq(d.coins[7], Vector2(2, 3), "arc apex = base + height")


func test_surface_under() -> void:
	var d := LevelData.from_dict({
		"ground": [[0, 10, 0]],
		"platforms": [[2, 5, 2]],
	})
	check_eq(d.surface_under(3, 3).top, 2.0, "platform above ground")
	check_eq(d.surface_under(3, 1).top, 0.0, "below platform → ground")
	check(d.surface_under(12, 0) == null, "nothing past the end")


func test_real_level_loads() -> void:
	var d := LevelData.load_file("res://levels/level_01.json")
	check(d != null, "parses")
	if d == null:
		return
	note("%d ground, %d platforms, %d coins, %d enemies, %d checkpoints, length %.0f m" % [
			d.ground.size(), d.platforms.size(), d.coins.size(), d.enemies.size(),
			d.checkpoints.size(), d.bounds.y - d.bounds.x])
	check(d.coins.size() >= 80, "plenty of coins")
	check(d.checkpoints.size() >= 1, "has a checkpoint")
	check(d.surface_under(d.spawn.x, d.spawn.y) != null, "spawn on ground")
	check(d.surface_under(d.goal.x, d.goal.y) != null, "goal on ground")
	for s in d.surfaces():
		var w := s.width()
		check(is_equal_approx(w, roundf(w)) and w >= 2.0,
				"surface at x=%.1f width %.2f must be a whole number ≥ 2 (tiles)" % [s.x0, w])
