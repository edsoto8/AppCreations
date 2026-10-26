extends Node
## Screenshot capture for visual inspection (needs a real renderer, not --headless):
##   xvfb-run -a -s "-screen 0 1600x900x24" godot --path . res://tests/capture.tscn -- \
##       --out=/abs/dir --shots=2,40,120 [--menu] [--size=1600x900]
## Each shot places the player on the surface at that x, lets the camera settle, and saves
## level_<x>.png. --menu also saves menu.png. Used by scripts/screenshots.sh.

const LEVEL := preload("res://scenes/level_01.tscn")
const MENU := preload("res://scenes/main_menu.tscn")


func _ready() -> void:
	var out := "user://shots"
	var shots: Array[float] = [2.0]
	var menu := false
	var size := Vector2i(1600, 900)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			out = arg.substr(6)
		elif arg.begins_with("--shots="):
			shots.clear()
			for s in arg.substr(8).split(","):
				shots.append(float(s))
		elif arg == "--menu":
			menu = true
		elif arg.begins_with("--size="):
			var p := arg.substr(7).split("x")
			size = Vector2i(int(p[0]), int(p[1]))
	DirAccess.make_dir_recursive_absolute(out)
	get_window().size = size
	await _frames(5)

	if menu:
		var m := MENU.instantiate()
		add_child(m)
		await _frames(90)
		_save(out + "/menu.png")
		m.queue_free()
		await _frames(5)

	var level: Level = LEVEL.instantiate()
	add_child(level)
	level.player.input = ScriptedInput.new()
	await _frames(30)
	for x in shots:
		var s := level.data.surface_under(x, 100.0)
		var y := s.top if s else 0.0
		level.player.respawn_at(Vector3(x, y, 0), 0.0)
		level.camera.snap_to_target()
		await _frames(50)
		_save(out + "/level_%04d.png" % int(x))
	get_tree().quit()


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _save(path: String) -> void:
	var img := get_viewport().get_texture().get_image()
	img.save_png(path)
	print("saved ", path)
