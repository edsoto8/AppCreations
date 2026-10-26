extends TestCase
## Smoke tests on the real level scene with real physics. Run with --fixed-fps 60 so physics
## steps are deterministic and faster than real time (scripts/validate.sh does this).

const LEVEL := preload("res://scenes/level_01.tscn")

var level: Level
var player: Player
var input: ScriptedInput
var session: GameSession


func before_each() -> void:
	level = LEVEL.instantiate()
	# The runner processes ALWAYS; the level must really stop when the tree is paused.
	level.process_mode = Node.PROCESS_MODE_PAUSABLE
	add_child(level)
	player = level.player
	session = level.session
	input = ScriptedInput.new()
	player.input = input
	await physics_frames(20)


func after_each() -> void:
	get_tree().paused = false
	level.queue_free()
	await get_tree().process_frame
	await get_tree().process_frame


func _place(x: float, y: float) -> void:
	player.respawn_at(Vector3(x, y, 0), 0.0)


func _hold_for(frames: int) -> void:
	await physics_frames(frames)


func _first_enemy(type: String) -> Node3D:
	for e in level.builder.enemies.get_children():
		if (type == "bramblebug" and e is Bramblebug) or (type == "buzzpuff" and e is Buzzpuff):
			return e
	return null


func test_spawns_on_the_ground() -> void:
	check(player.is_on_floor(), "player grounded at spawn")
	check_near(player.global_position.y, level.data.spawn.y, 0.05, "spawn height")
	check_eq(session.state, GameSession.State.PLAYING, "session started")
	check_eq(session.total_coins, level.data.coins.size(), "total coins")


func test_level_builds_expected_objects() -> void:
	check_eq(level.builder.coins.size(), level.data.coins.size(), "coins")
	check_eq(level.builder.enemies.get_child_count(), level.data.enemies.size(), "enemies")
	check_eq(level.builder.checkpoints.size(), level.data.checkpoints.size(), "checkpoints")
	check(level.builder.goal != null, "goal")
	check_eq(get_tree().get_nodes_in_group("oneway").size(), level.data.platforms.size(),
			"one-way platform colliders")


func test_walks_right() -> void:
	var x0 := player.global_position.x
	input.direction = 1.0
	await _hold_for(60)
	var walked := player.global_position.x - x0
	note("walked %.2f m in 1 s" % walked)
	check(walked > 5.0 and walked < 6.1, "≈5.5 m in a second of walking")
	check(player.is_on_floor(), "still grounded")
	input.direction = 0.0
	await _hold_for(20)
	check(absf(player.velocity.x) < 0.01, "stops")


func test_real_jump_height_matches_model() -> void:
	var y0 := player.global_position.y
	var peak := y0
	input.jump_held = true
	for i in 70:
		await get_tree().physics_frame
		peak = maxf(peak, player.global_position.y)
	input.jump_held = false
	await _hold_for(40)
	var model := MovementModel.max_jump_height(player.config)
	note("physics jump %.2f m, model %.2f m" % [peak - y0, model])
	check_near(peak - y0, model, 0.15, "jump height")
	check(player.is_on_floor(), "landed again")


func test_short_hop_is_lower() -> void:
	var y0 := player.global_position.y
	var peak := y0
	input.jump_held = true
	await get_tree().physics_frame
	input.jump_held = false
	for i in 60:
		await get_tree().physics_frame
		peak = maxf(peak, player.global_position.y)
	note("tap hop %.2f m" % (peak - y0))
	check(peak - y0 < 1.3 and peak - y0 > 0.5, "tap gives a short hop")


func test_collects_a_coin() -> void:
	var c: Vector2 = level.data.coins[0]
	_place(c.x, c.y - 0.75)
	await _hold_for(5)
	check_eq(session.coins, 1, "coin counted")
	await _hold_for(30)
	check(not is_instance_valid(level.builder.coins[0]), "coin removed after its pop animation")


func test_checkpoint_activation_and_respawn() -> void:
	var cp: Vector2 = level.data.checkpoints[0]
	_place(cp.x, cp.y + 0.1)
	await _hold_for(10)
	check_eq(session.checkpoint_index, 0, "checkpoint active")
	check(level.builder.checkpoints[0].active, "flag raised")
	# Now fall into the next pit and come back here.
	_place(130.0, 8.0)  # over the pit after Stepping Hills (128..131)
	player.velocity = Vector3.ZERO
	var lives := session.lives
	await _hold_for(200)
	check_eq(session.lives, lives - 1, "fall cost a life")
	check_eq(session.state, GameSession.State.PLAYING, "back to playing")
	check_near(player.global_position.x, level.respawn_point().x, 0.6, "respawned at checkpoint x")
	check(player.invulnerable_left > 0.0, "brief invulnerability after respawn")


func test_side_contact_hurts_with_invulnerability() -> void:
	var bug := _first_enemy("bramblebug")
	_place(bug.global_position.x - 1.2, bug.global_position.y)
	input.direction = 1.0
	await _hold_for(30)
	input.direction = 0.0
	check_eq(session.health, GameSession.MAX_HEALTH - 1, "lost one heart")
	check(player.invulnerable_left > 0.0, "invulnerable after a hit")
	check(bug.is_alive(), "walking into it doesn't defeat it")
	await _hold_for(30)
	check_eq(session.health, GameSession.MAX_HEALTH - 1, "no repeat damage while invulnerable")


func test_stomp_defeats_and_bounces() -> void:
	var bug := _first_enemy("bramblebug")
	var p := bug.global_position
	_place(p.x, p.y + 2.2)
	var bounced := false
	for i in 40:
		await get_tree().physics_frame
		if player.velocity.y > 5.0:
			bounced = true
			break
	check(bounced, "bounced off the enemy")
	check(not is_instance_valid(bug) or not bug.is_alive(), "enemy defeated")
	check_eq(session.health, GameSession.MAX_HEALTH, "no damage from a stomp")
	check_eq(session.enemies_stomped, 1, "stomp counted")


func test_stomp_flyer() -> void:
	var puff := _first_enemy("buzzpuff")
	var p := puff.global_position
	_place(p.x, p.y + 1.6)
	for i in 30:
		# Stay above the flyer as it glides along its path.
		player.global_position.x = puff.global_position.x
		await get_tree().physics_frame
		if not puff.is_alive():
			break
	check(not puff.is_alive(), "buzzpuff stomped")
	check_eq(session.health, GameSession.MAX_HEALTH, "no damage")


func test_jump_up_through_one_way_platform() -> void:
	# Ground under the first floating platform [36..40 @ 2.0].
	_place(38.0, 0.0)
	await _hold_for(10)
	input.jump_held = true
	await _hold_for(45)
	input.jump_held = false
	await _hold_for(40)
	note("after jumping up through: y = %.2f" % player.global_position.y)
	check_near(player.global_position.y, 2.0, 0.08, "standing on top of the one-way platform")
	check(player.is_on_floor(), "grounded on it")


func test_running_out_of_health_costs_a_life() -> void:
	session.damage()
	session.damage()
	var bug := _first_enemy("bramblebug")
	_place(bug.global_position.x - 1.2, bug.global_position.y)
	input.direction = 1.0
	await _hold_for(20)
	input.direction = 0.0
	check_eq(player.state, Player.State.DEFEATED, "defeated on the last heart")
	await _hold_for(150)
	check_eq(session.lives, GameSession.START_LIVES - 1, "life lost")
	check_eq(session.health, GameSession.MAX_HEALTH, "health refilled on respawn")
	check_near(player.global_position.x, level.data.spawn.x, 0.6, "back at the start")


func test_game_over_after_all_lives() -> void:
	for i in GameSession.START_LIVES:
		_place(57.0, 4.0)  # over the first long pit (56..58)
		player.velocity = Vector3.ZERO
		await _hold_for(220)
	check_eq(session.state, GameSession.State.GAME_OVER, "game over")
	check(level.menus.is_open(), "game over screen shown")


func test_reaching_goal_completes_level() -> void:
	_place(level.data.goal.x - 2.0, level.data.goal.y)
	input.direction = 1.0
	await _hold_for(40)
	check_eq(session.state, GameSession.State.COMPLETE, "level complete")
	check_eq(player.state, Player.State.CELEBRATING, "player celebrates")
	await _hold_for(130)
	check(level.menus.is_open(), "results screen shown")


func test_pause_during_death_delay_still_costs_a_life() -> void:
	_place(57.0, 4.0)  # over the first pit
	player.velocity = Vector3.ZERO
	while player.is_alive():
		await get_tree().physics_frame
	level._pause()  # refused while defeated
	check(not get_tree().paused, "can't pause during the defeat sequence")
	await _hold_for(150)
	check_eq(session.lives, GameSession.START_LIVES - 1, "life was lost")
	check_eq(session.state, GameSession.State.PLAYING, "respawned")


func test_respawn_camera_snaps_to_checkpoint() -> void:
	_place(130.0, 8.0)  # die far from the start
	player.velocity = Vector3.ZERO
	while session.state != GameSession.State.RESPAWNING:
		await get_tree().physics_frame
	while session.state != GameSession.State.PLAYING:
		await get_tree().physics_frame
	await _hold_for(2)
	check_near(level.camera.global_position.x, level.respawn_point().x, 4.0,
			"camera centred near the respawn point right away")


func test_pause_freezes_the_level() -> void:
	var x0 := player.global_position.x
	input.direction = 1.0
	level._pause()
	await _hold_for(30)
	check_near(player.global_position.x, x0, 0.001, "player doesn't move while paused")
	level._resume()
	await _hold_for(10)
	check(player.global_position.x > x0, "moves again after resume")
	input.direction = 0.0


func test_pause_and_resume() -> void:
	level._pause()
	check(get_tree().paused, "tree paused")
	check_eq(session.state, GameSession.State.PAUSED)
	check(level.menus.is_open(), "pause menu open")
	level._resume()
	check(not get_tree().paused, "resumed")
	check_eq(session.state, GameSession.State.PLAYING)
