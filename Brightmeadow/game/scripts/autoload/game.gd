extends Node
## Game autoload: owns the GameSession, switches scenes with a fade, and handles global keys
## (fullscreen, mute). Level-specific flow (respawns, finish) lives in level.gd.

const MENU_SCENE := "res://scenes/main_menu.tscn"
const LEVEL_SCENE := "res://scenes/level_01.tscn"

var session := GameSession.new()
## Best completion time this run of the game (seconds), or -1.
var best_time := -1.0

var _overlay: ColorRect
var _fade_layer: CanvasLayer
var _changing := false
var _fade_tween: Tween


func _enter_tree() -> void:
	InputSetup.ensure()


func _exit_tree() -> void:
	ModelLib.clear_cache()


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_fade_layer = CanvasLayer.new()
	_fade_layer.layer = 100
	add_child(_fade_layer)
	_overlay = ColorRect.new()
	_overlay.color = Color(0.1, 0.13, 0.2, 0.0)
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade_layer.add_child(_overlay)


func _process(delta: float) -> void:
	session.tick(delta)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_fullscreen"):
		var mode := DisplayServer.window_get_mode()
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED
				if mode == DisplayServer.WINDOW_MODE_FULLSCREEN
				else DisplayServer.WINDOW_MODE_FULLSCREEN)
	elif event.is_action_pressed("toggle_mute"):
		Audio.toggle_mute()


func start_level() -> void:
	_change_scene(LEVEL_SCENE)


func restart_level() -> void:
	_change_scene(LEVEL_SCENE)


func goto_menu() -> void:
	_change_scene(MENU_SCENE)


func quit() -> void:
	get_tree().quit()


## Fades the screen to [param alpha] over [param time]; await the returned tween's finished.
## While a scene change runs it owns the overlay: other callers get a plain timer-like tween.
func fade_to(alpha: float, time := 0.35) -> Tween:
	if _changing:
		var wait := create_tween()
		wait.tween_interval(time)
		return wait
	return _fade(alpha, time)


func _fade(alpha: float, time: float) -> Tween:
	if _fade_tween:
		_fade_tween.kill()
	_fade_tween = create_tween()
	_fade_tween.tween_property(_overlay, "color:a", alpha, time)
	return _fade_tween


func set_paused(paused: bool) -> void:
	if paused:
		if session.pause():
			get_tree().paused = true
	else:
		if session.resume():
			get_tree().paused = false


func _change_scene(path: String) -> void:
	if _changing:
		return
	_changing = true
	await _fade(1.0, 0.3).finished
	get_tree().paused = false
	get_tree().change_scene_to_file(path)
	await get_tree().process_frame
	await get_tree().process_frame
	_changing = false
	_fade(0.0, 0.4)
