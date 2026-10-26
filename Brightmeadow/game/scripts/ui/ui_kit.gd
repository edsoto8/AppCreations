class_name UiKit
extends RefCounted
## Builders for the game's menus so every screen shares spacing, fonts and sounds.
## Colours and button styles come from res://ui/theme.tres.

const TITLE_FONT := preload("res://assets/fonts/fredoka-latin-700-normal.woff2")
const INK := Color(0.23, 0.16, 0.12)
const TEAL := Color(0.14, 0.65, 0.65)
const GOLD := Color(1.0, 0.77, 0.24)
const CREAM := Color(1, 0.97, 0.9)


## A full-screen dimmer with a centred panel; returns the panel's content VBox.
static func overlay(parent: Node, dim := 0.45) -> VBoxContainer:
	var dimmer := ColorRect.new()
	dimmer.name = "Dimmer"
	dimmer.color = Color(0.06, 0.1, 0.18, dim)
	dimmer.set_anchors_preset(Control.PRESET_FULL_RECT)
	parent.add_child(dimmer)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	dimmer.add_child(center)
	var panel := PanelContainer.new()
	center.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 16)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.custom_minimum_size = Vector2(440, 0)
	panel.add_child(box)
	return box


static func title(text: String, size := 64, color := INK, outline := 0) -> Label:
	var l := Label.new()
	l.text = text
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_override("font", TITLE_FONT)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if outline > 0:
		l.add_theme_constant_override("outline_size", outline)
		l.add_theme_color_override("font_outline_color", INK)
	return l


static func text(content: String, size := 26, color := INK) -> Label:
	var l := Label.new()
	l.text = content
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func button(label: String, on_pressed: Callable) -> Button:
	var b := Button.new()
	b.text = label
	b.custom_minimum_size = Vector2(320, 0)
	b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	b.focus_entered.connect(func(): Audio.play_sfx("ui_move"))
	b.mouse_entered.connect(func(): b.grab_focus())
	b.pressed.connect(func():
		Audio.play_sfx("ui_select")
		on_pressed.call())
	return b


## Two-column key/action table for the controls screen.
static func controls_grid() -> GridContainer:
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 36)
	grid.add_theme_constant_override("v_separation", 8)
	var rows := [
		["A / D  or  ← →", "Walk"],
		["Hold Shift  (or X)", "Run"],
		["Space  (or W / ↑ / Z)", "Jump — hold for higher"],
		["Esc  or  P", "Pause / resume"],
		["R", "Restart level"],
		["F", "Toggle fullscreen"],
		["M", "Mute sound"],
	]
	for r in rows:
		var k := text(r[0], 24, TEAL)
		k.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		grid.add_child(k)
		var a := text(r[1], 24)
		a.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		grid.add_child(a)
	return grid


static func format_time(seconds: float) -> String:
	var s := int(seconds)
	return "%d:%02d.%d" % [s / 60, s % 60, int(fmod(seconds, 1.0) * 10.0)]
