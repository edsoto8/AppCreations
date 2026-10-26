class_name InputSetup
extends RefCounted
## Registers the game's input actions in code (keyboard by physical key position, plus
## gamepad). Doing it here keeps project.godot readable and the bindings in one place.
## Controls are documented in docs/CONTROLS.md.

const KEYS := {
	"move_left": [KEY_A, KEY_LEFT],
	"move_right": [KEY_D, KEY_RIGHT],
	"jump": [KEY_SPACE, KEY_W, KEY_UP, KEY_Z, KEY_K],
	"run": [KEY_SHIFT, KEY_X, KEY_J],
	"pause": [KEY_ESCAPE, KEY_P],
	"restart": [KEY_R],
	"toggle_fullscreen": [KEY_F],
	"toggle_mute": [KEY_M],
}

const PAD_BUTTONS := {
	"move_left": [JOY_BUTTON_DPAD_LEFT],
	"move_right": [JOY_BUTTON_DPAD_RIGHT],
	"jump": [JOY_BUTTON_A],
	"run": [JOY_BUTTON_X, JOY_BUTTON_RIGHT_SHOULDER],
	"pause": [JOY_BUTTON_START],
	"restart": [JOY_BUTTON_BACK],
}


static func ensure() -> void:
	for action in KEYS:
		if not InputMap.has_action(action):
			InputMap.add_action(action, 0.25)
		for key in KEYS[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			if not InputMap.action_has_event(action, ev):
				InputMap.action_add_event(action, ev)
		for button in PAD_BUTTONS.get(action, []):
			var jb := InputEventJoypadButton.new()
			jb.button_index = button
			if not InputMap.action_has_event(action, jb):
				InputMap.action_add_event(action, jb)
	for pair in [["move_left", -1.0], ["move_right", 1.0]]:
		var axis := InputEventJoypadMotion.new()
		axis.axis = JOY_AXIS_LEFT_X
		axis.axis_value = pair[1]
		if not InputMap.action_has_event(pair[0], axis):
			InputMap.action_add_event(pair[0], axis)
