class_name Menus
extends CanvasLayer
## In-level overlays: pause menu, controls, game over and level complete. Runs while the tree
## is paused. Only one overlay is shown at a time.

signal resume_requested

var _current: Control
## True while the pause menu (or the controls page opened from it) is showing.
var _pause_mode := false


func _ready() -> void:
	layer = 20
	process_mode = Node.PROCESS_MODE_ALWAYS


func is_open() -> bool:
	return _current != null


## While the tree is paused the level can't see input, so the pause overlay handles
## "pause" (resume) and "restart" itself.
func _unhandled_input(event: InputEvent) -> void:
	if not _pause_mode:
		return
	if event.is_action_pressed("pause"):
		get_viewport().set_input_as_handled()
		resume_requested.emit()
	elif event.is_action_pressed("restart"):
		get_viewport().set_input_as_handled()
		Game.restart_level()


func close() -> void:
	_pause_mode = false
	if _current:
		_current.queue_free()
		_current = null


func show_pause() -> void:
	var box := _open(0.45)
	box.add_child(UiKit.title("Paused", 64))
	box.add_child(UiKit.text("Take a breather, explorer.", 24, UiKit.TEAL))
	_pause_mode = true
	var resume := UiKit.button("Resume", func(): resume_requested.emit())
	box.add_child(resume)
	box.add_child(UiKit.button("Restart Level", Game.restart_level))
	box.add_child(UiKit.button("Controls", func():
		show_controls(show_pause)
		_pause_mode = true))
	box.add_child(UiKit.button("Main Menu", Game.goto_menu))
	resume.call_deferred("grab_focus")


func show_controls(back: Callable) -> void:
	var box := _open(0.45)
	box.add_child(UiKit.title("Controls", 56))
	box.add_child(UiKit.controls_grid())
	box.add_child(UiKit.text("Gamepad: stick / d-pad, A jump, X run, Start pause", 20, UiKit.TEAL))
	var b := UiKit.button("Back", back)
	box.add_child(b)
	b.call_deferred("grab_focus")


func show_game_over(session: GameSession) -> void:
	var box := _open(0.6)
	box.add_child(UiKit.title("Game Over", 72, Color("e8483b")))
	box.add_child(UiKit.text("Juni needs a rest. Try the trail again?", 26))
	box.add_child(UiKit.text("Coins  %d / %d" % [session.coins, session.total_coins], 26, UiKit.TEAL))
	var retry := UiKit.button("Try Again", Game.restart_level)
	box.add_child(retry)
	box.add_child(UiKit.button("Main Menu", Game.goto_menu))
	retry.call_deferred("grab_focus")


func show_complete(session: GameSession, best_time: float) -> void:
	var box := _open(0.35)
	box.add_child(UiKit.title("Trail Complete!", 68, UiKit.TEAL))
	box.add_child(UiKit.text("Juni made it across Brightmeadow!", 26))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 40)
	grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var rows := [
		["Coins", "%d / %d" % [session.coins, session.total_coins]],
		["Time", UiKit.format_time(session.time_elapsed)],
		["Best", UiKit.format_time(best_time)],
		["Bugs bopped", str(session.enemies_stomped)],
		["Lives left", str(session.lives)],
	]
	for r in rows:
		var k := UiKit.text(r[0], 28, UiKit.TEAL)
		k.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		grid.add_child(k)
		var v := UiKit.text(r[1], 28)
		v.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		grid.add_child(v)
	box.add_child(grid)
	if session.coins == session.total_coins:
		box.add_child(UiKit.text("★ Every coin found! ★", 28, Color("e09a1a")))
	var again := UiKit.button("Play Again", Game.restart_level)
	box.add_child(again)
	box.add_child(UiKit.button("Main Menu", Game.goto_menu))
	again.call_deferred("grab_focus")
	# Pop in.
	var panel := box.get_parent() as Control
	panel.pivot_offset = panel.size * 0.5
	panel.scale = Vector2(0.7, 0.7)
	create_tween().tween_property(panel, "scale", Vector2.ONE, 0.35) \
			.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _open(dim: float) -> VBoxContainer:
	close()
	var holder := Control.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(holder)
	_current = holder
	return UiKit.overlay(holder, dim)
