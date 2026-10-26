extends Node
## Headless test runner. Run from the game/ folder:
##   godot --headless --path . res://tests/run_tests.tscn                     (all tests)
##   godot --headless --path . res://tests/run_tests.tscn -- --filter=session (file name filter)
## Exit code 0 = all passed.

const DIRS := ["res://tests/unit/", "res://tests/integration/"]


func _ready() -> void:
	var filter := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--filter="):
			filter = arg.substr(9)
	await get_tree().process_frame
	var total := 0
	var failed := 0
	var all_failures: PackedStringArray = []
	for dir in DIRS:
		for file in _list(dir):
			if filter != "" and not file.contains(filter):
				continue
			var script: GDScript = load(dir + file)
			if script == null:
				all_failures.append("%s: failed to load" % file)
				failed += 1
				continue
			var suite: TestCase = script.new()
			add_child(suite)
			print("▶ ", file)
			for m in script.get_script_method_list():
				var method_name: String = m["name"]
				if not method_name.begins_with("test_"):
					continue
				total += 1
				suite.current_test = "%s::%s" % [file.get_basename(), method_name]
				var before := suite.failures.size()
				await suite.before_each()
				await suite.call(method_name)
				await suite.after_each()
				var ok := suite.failures.size() == before
				if not ok:
					failed += 1
				print("   %s %s" % ["✔" if ok else "✘", method_name])
			all_failures.append_array(suite.failures)
			suite.queue_free()
			await get_tree().process_frame
	print("")
	for f in all_failures:
		print("FAIL ", f)
	print("Tests: %d, passed: %d, failed: %d" % [total, total - failed, failed])
	get_tree().paused = false
	get_tree().quit(1 if failed > 0 or total == 0 else 0)


func _list(dir: String) -> PackedStringArray:
	var out: PackedStringArray = []
	var d := DirAccess.open(dir)
	if d == null:
		return out
	for f in d.get_files():
		if f.begins_with("test_") and f.ends_with(".gd"):
			out.append(f)
	out.sort()
	return out
