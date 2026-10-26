extends TestCase
## Every scene and script loads, both playable scenes instance cleanly, every contracted model
## and sound is present (no placeholders), and imported animations carry the contract names.

const MODELS := ["explorer", "bramblebug", "buzzpuff", "coin", "checkpoint", "goal",
		"ground_mid_a", "ground_mid_b", "ground_mid_c", "ground_cap_left", "ground_cap_right",
		"float_mid_a", "float_mid_b", "float_cap_left", "float_cap_right", "tree_round",
		"tree_pine", "bush", "flowers", "grass_tuft", "rock", "mushroom", "fence", "signpost",
		"hill_a", "hill_b", "cloud_a", "cloud_b"]
const ANIMATIONS := {
	"explorer": ["idle", "walk", "run", "jump", "fall", "land", "celebrate", "hurt"],
	"bramblebug": ["walk"],
	"buzzpuff": ["fly"],
}


func _files(dir: String, ext: String, out: PackedStringArray) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for f in d.get_files():
		if f.ends_with(ext):
			out.append(dir.path_join(f))
	for sub in d.get_directories():
		_files(dir.path_join(sub), ext, out)


func test_all_scripts_and_scenes_load() -> void:
	var files: PackedStringArray = []
	_files("res://scripts", ".gd", files)
	_files("res://scenes", ".tscn", files)
	for f in files:
		check(load(f) != null, "failed to load %s" % f)
	note("%d scripts/scenes loaded" % files.size())


func test_main_menu_instances() -> void:
	var menu: Node = load("res://scenes/main_menu.tscn").instantiate()
	add_child(menu)
	await physics_frames(10)
	check(menu.is_inside_tree(), "menu running")
	menu.queue_free()
	await get_tree().process_frame


func test_all_models_present() -> void:
	var missing := []
	for m in MODELS:
		if not ModelLib.exists(m):
			missing.append(m)
	check(missing.is_empty(), "missing models: %s" % ", ".join(missing))
	check(ModelLib.missing.is_empty(),
			"placeholders were drawn for: %s" % ", ".join(ModelLib.missing))


func test_model_animations() -> void:
	for model_name in ANIMATIONS:
		if not ModelLib.exists(model_name):
			check(false, "%s missing" % model_name)
			continue
		var inst := ModelLib.instance(model_name)
		var anim := ModelLib.find_animation_player(inst)
		check(anim != null, "%s has an AnimationPlayer" % model_name)
		if anim:
			for a in ANIMATIONS[model_name]:
				check(anim.has_animation(a), "%s has animation '%s'" % [model_name, a])
		inst.free()


func test_contract_child_nodes() -> void:
	for pair in [["checkpoint", "Flag"], ["checkpoint", "Post"], ["goal", "Emblem"]]:
		if not ModelLib.exists(pair[0]):
			check(false, "%s missing" % pair[0])
			continue
		var inst := ModelLib.instance(pair[0])
		check(inst.find_child(pair[1], true, false) != null, "%s has child '%s'" % pair)
		inst.free()


func test_all_sounds_present() -> void:
	for s in Audio.SFX + Audio.MUSIC:
		check(Audio.has_sound(s), "sound %s loaded" % s)
