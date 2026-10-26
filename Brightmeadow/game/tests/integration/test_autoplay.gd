extends TestCase
## End-to-end traversal: the autoplay bot plays the whole level with the real controller and
## physics (enemies can't hurt it; they have their own tests) and must reach the goal without
## falling. Proves the route works with actual collision, not just on paper.

const LEVEL := preload("res://scenes/level_01.tscn")
## Simulated-time limit.
const MAX_SECONDS := 300.0


func test_bot_completes_level() -> void:
	var level: Level = LEVEL.instantiate()
	add_child(level)
	await physics_frames(5)
	var bot := AutoplayBot.new()
	add_child(bot)
	bot.setup(level)
	note("route: %d surfaces" % bot.route.size())
	var frames := 0
	var furthest := 0.0
	while level.session.state != GameSession.State.COMPLETE and frames < int(MAX_SECONDS * 60):
		await get_tree().physics_frame
		frames += 1
		furthest = maxf(furthest, level.player.global_position.x)
		if level.session.state == GameSession.State.GAME_OVER:
			break
	var secs := frames / 60.0
	note("bot: %s in %.1f s sim time, %d jumps, %d falls, furthest x=%.1f, coins %d/%d" % [
			"finished" if level.session.state == GameSession.State.COMPLETE else "DID NOT FINISH",
			secs, bot.jumps, bot.deaths, furthest, level.session.coins, level.session.total_coins])
	for line in bot.log_lines.slice(0, 10):
		note(line)
	check_eq(level.session.state, GameSession.State.COMPLETE, "bot reached the goal")
	check_eq(bot.deaths, 0, "bot never fell")
	bot.queue_free()
	level.queue_free()
	await get_tree().process_frame
