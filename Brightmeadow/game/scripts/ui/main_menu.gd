extends Node3D
## Title screen: the start of the real level as a living diorama behind the menu.

const LAYOUT := "res://levels/level_01.json"

var _t := 0.0
var _menu_box: VBoxContainer
var _ui: CanvasLayer

@onready var world: Node3D = $World
@onready var camera: Camera3D = $Camera


func _ready() -> void:
	get_tree().paused = false
	var data := LevelData.load_file(LAYOUT)
	LevelBuilder.new().build(data, world, false)
	var juni := ModelLib.instance("explorer")
	world.add_child(juni)
	juni.position = Vector3(6.5, 0, 0.6)
	juni.rotation.y = -0.35
	var anim := ModelLib.find_animation_player(juni)
	ModelLib.set_looping(anim, ["idle"])
	if anim and anim.has_animation("idle"):
		anim.play("idle")
	_build_ui()
	Audio.play_music("music_menu")


func _process(delta: float) -> void:
	_t += delta
	camera.position = Vector3(8.5 + sin(_t * 0.12) * 1.5, 2.6 + sin(_t * 0.2) * 0.2, 11.5)
	camera.rotation = Vector3(deg_to_rad(-5.0), deg_to_rad(4.0 + sin(_t * 0.12) * 2.0), 0)


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	add_child(_ui)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_ui.add_child(root)

	var title_box := VBoxContainer.new()
	title_box.set_anchors_preset(Control.PRESET_CENTER_TOP)
	title_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	title_box.offset_top = 48
	title_box.add_theme_constant_override("separation", -10)
	root.add_child(title_box)
	title_box.add_child(UiKit.title("Brightmeadow", 112, UiKit.GOLD, 26))
	title_box.add_child(UiKit.title("Juni's Trail", 44, UiKit.CREAM, 16))

	_menu_box = VBoxContainer.new()
	_menu_box.set_anchors_preset(Control.PRESET_CENTER_LEFT)
	_menu_box.offset_left = 120
	_menu_box.offset_top = 40
	_menu_box.grow_vertical = Control.GROW_DIRECTION_BOTH
	_menu_box.add_theme_constant_override("separation", 14)
	root.add_child(_menu_box)
	_show_main()

	var hint := UiKit.text("Arrow keys / Enter or mouse to choose  ·  F fullscreen  ·  M mute",
			20, UiKit.CREAM)
	hint.add_theme_constant_override("outline_size", 8)
	hint.add_theme_color_override("font_outline_color", UiKit.INK)
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.offset_top = -48
	root.add_child(hint)


func _clear() -> void:
	for c in _menu_box.get_children():
		c.queue_free()


func _show_main() -> void:
	_clear()
	var start := UiKit.button("Start Adventure", Game.start_level)
	_menu_box.add_child(start)
	_menu_box.add_child(UiKit.button("Controls", _show_controls))
	_menu_box.add_child(UiKit.button("Quit", Game.quit))
	start.call_deferred("grab_focus")


func _show_controls() -> void:
	_clear()
	var panel := PanelContainer.new()
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(UiKit.title("Controls", 48))
	box.add_child(UiKit.controls_grid())
	box.add_child(UiKit.text("Stomp enemies from above. Touching them from\nthe side costs a heart. Flags are checkpoints.", 22, UiKit.TEAL))
	var back := UiKit.button("Back", _show_main)
	box.add_child(back)
	_menu_box.add_child(panel)
	back.call_deferred("grab_focus")
