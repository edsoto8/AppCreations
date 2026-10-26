extends TestCase
## GameSession state machine and rules.

var s: GameSession


func before_each() -> void:
	s = GameSession.new()
	s.start(10)


func test_start_state() -> void:
	check_eq(s.state, GameSession.State.PLAYING)
	check_eq(s.health, GameSession.MAX_HEALTH)
	check_eq(s.lives, GameSession.START_LIVES)
	check_eq(s.total_coins, 10)
	check_eq(s.checkpoint_index, -1)


func test_coins() -> void:
	var seen := []
	s.coins_changed.connect(func(c): seen.append(c))
	s.collect_coin()
	s.collect_coin()
	check_eq(s.coins, 2)
	check_eq(seen, [1, 2], "signal values")


func test_damage_until_empty() -> void:
	check(not s.damage(), "first hit not fatal")
	check(not s.damage(), "second hit not fatal")
	check(s.damage(), "third hit empties health")
	check_eq(s.health, 0)


func test_lose_life_and_respawn() -> void:
	check(not s.lose_life(), "not game over yet")
	check_eq(s.state, GameSession.State.RESPAWNING)
	check_eq(s.lives, GameSession.START_LIVES - 1)
	s.damage()  # ignored while respawning
	s.respawned()
	check_eq(s.state, GameSession.State.PLAYING)
	check_eq(s.health, GameSession.MAX_HEALTH, "health refilled")


func test_game_over_after_last_life() -> void:
	for i in GameSession.START_LIVES - 1:
		s.lose_life()
		s.respawned()
	check(s.lose_life(), "last life → game over")
	check_eq(s.state, GameSession.State.GAME_OVER)
	s.collect_coin()
	check_eq(s.coins, 0, "no coins after game over")


func test_checkpoints_only_move_forward() -> void:
	check(s.activate_checkpoint(1), "first activation")
	check(not s.activate_checkpoint(0), "earlier checkpoint ignored")
	check(not s.activate_checkpoint(1), "same checkpoint ignored")
	check(s.activate_checkpoint(2), "later checkpoint")
	check_eq(s.checkpoint_index, 2)


func test_pause_resume_and_timer() -> void:
	s.tick(1.0)
	check(s.pause(), "pause")
	s.tick(5.0)
	check_near(s.time_elapsed, 1.0, 0.0001, "timer stops while paused")
	check(not s.pause(), "double pause ignored")
	check(s.resume(), "resume")
	s.tick(0.5)
	check_near(s.time_elapsed, 1.5, 0.0001, "timer resumes")


func test_complete() -> void:
	check(s.complete(), "complete")
	check_eq(s.state, GameSession.State.COMPLETE)
	check(not s.complete(), "only once")
	check(not s.damage(), "no damage after finishing")
	check(not s.pause(), "no pause after finishing")


func test_restart_resets_everything() -> void:
	s.collect_coin()
	s.damage()
	s.lose_life()
	s.start(5)
	check_eq(s.coins, 0)
	check_eq(s.lives, GameSession.START_LIVES)
	check_eq(s.health, GameSession.MAX_HEALTH)
	check_eq(s.total_coins, 5)
