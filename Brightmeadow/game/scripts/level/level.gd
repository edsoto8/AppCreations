class_name Level
extends Node3D
## Level root: builds the layout, wires coins/checkpoints/goal/player to the GameSession, and
## runs the respawn, pause, game-over and finish flow.

@export_file("*.json") var layout_path := "res://levels/level_01.json"

var data: LevelData
var builder := LevelBuilder.new()
var session: GameSession

@onready var world: Node3D = $World
@onready var player: Player = $Player
@onready var camera: FollowCamera = $Camera
@onready var hud: Hud = $HUD
@onready var menus: Menus = $Menus


func _ready() -> void:
	data = LevelData.load_file(layout_path)
	builder.build(data, world)
	session = Game.session

	player.add_to_group("player")
	player.kill_y = data.kill_y
	player.session = session
	player.refresh_oneway()
	player.respawn_at(Vector3(data.spawn.x, data.spawn.y, 0), 0.0)
	player.defeated.connect(_on_player_defeated)
	player.stomped.connect(func(_e): session.record_stomp())

	camera.target = player
	camera.bounds = data.bounds
	camera.snap_to_target()

	for c in builder.coins:
		c.collected.connect(func(_c): session.collect_coin())
	for cp in builder.checkpoints:
		cp.reached.connect(_on_checkpoint_reached)
	builder.goal.reached.connect(_on_goal_reached)
	menus.resume_requested.connect(_resume)

	session.start(data.coins.size())
	hud.bind(session, data, player)
	Audio.play_music("music_meadow")


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		if session.state == GameSession.State.PLAYING:
			_pause()
		elif session.state == GameSession.State.PAUSED:
			_resume()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("restart"):
		if session.state in [GameSession.State.PLAYING, GameSession.State.PAUSED,
				GameSession.State.GAME_OVER]:
			Game.restart_level()
			get_viewport().set_input_as_handled()


func respawn_point() -> Vector3:
	if session.checkpoint_index >= 0:
		return builder.checkpoints[session.checkpoint_index].respawn_position()
	return Vector3(data.spawn.x, data.spawn.y, 0)


func _pause() -> void:
	# Not while the defeat/respawn sequence runs: it owns the session state then.
	if not player.is_alive():
		return
	Game.set_paused(true)
	if get_tree().paused:
		menus.show_pause()


func _resume() -> void:
	menus.close()
	Game.set_paused(false)


func _on_checkpoint_reached(cp: Checkpoint) -> void:
	if session.activate_checkpoint(cp.index):
		# Reaching a later checkpoint also raises any skipped earlier flags.
		for other in builder.checkpoints:
			if other.index < cp.index:
				other.activate(false)
		cp.activate()


func _on_goal_reached() -> void:
	if not session.complete():
		return
	player.celebrate()
	Audio.duck_music()
	Audio.play_sfx("level_complete")
	if Game.best_time < 0.0 or session.time_elapsed < Game.best_time:
		Game.best_time = session.time_elapsed
	await get_tree().create_timer(1.8, false).timeout
	menus.show_complete(session, Game.best_time)


func _on_player_defeated(cause: StringName) -> void:
	# Timers must not run while paused (create_timer defaults to process_always).
	await get_tree().create_timer(0.9 if cause == &"fall" else 1.2, false).timeout
	if session.state != GameSession.State.PLAYING:
		return
	var game_over := session.lose_life()
	if game_over:
		player.freeze()
		Audio.stop_music(0.4)
		Audio.play_sfx("game_over")
		menus.show_game_over(session)
		return
	await Game.fade_to(1.0, 0.3).finished
	if session.state != GameSession.State.RESPAWNING:
		return
	player.respawn_at(respawn_point())
	camera.snap_to_target()
	session.respawned()
	Game.fade_to(0.0, 0.35)
