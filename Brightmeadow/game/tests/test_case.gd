class_name TestCase
extends Node
## Minimal test base for the headless runner (tests/run_tests.tscn). Methods named test_* run
## in file order; they may await (e.g. physics frames). Failed assertions are recorded and the
## test keeps going so one run shows every problem.

var failures: PackedStringArray = []
var current_test := ""


func before_each() -> void:
	pass


func after_each() -> void:
	pass


func check(condition: bool, message: String) -> bool:
	if not condition:
		failures.append("%s: %s" % [current_test, message])
	return condition


func check_eq(actual: Variant, expected: Variant, message := "") -> bool:
	return check(actual == expected, "%s expected %s, got %s" % [message, expected, actual])


func check_near(actual: float, expected: float, tolerance: float, message := "") -> bool:
	return check(absf(actual - expected) <= tolerance,
			"%s expected %.3f ± %.3f, got %.3f" % [message, expected, tolerance, actual])


func physics_frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


## Log line shown in the runner output (for evidence such as measured numbers).
func note(message: String) -> void:
	print("      · ", message)
