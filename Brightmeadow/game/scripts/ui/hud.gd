class_name Hud
extends CanvasLayer
## In-game HUD: hearts and lives (top left), coins and time (top right), and a toast with the
## section name when the player enters a new part of the level.

var _session: GameSession
var _data: LevelData
var _player: Node3D
var _hearts: Array[HudIcon] = []
var _lives_label: Label
var _coins_label: Label
var _time_label: Label
var _coin_icon: HudIcon
var _toast: Label
var _section := ""
var _toast_tween: Tween
var _debug: Label


func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	var left := _pill(root)
	left.set_anchors_preset(Control.PRESET_TOP_LEFT)
	left.position = Vector2(24, 20)
	var lrow := left.get_child(0) as HBoxContainer
	for i in GameSession.MAX_HEALTH:
		var h := HudIcon.new(HudIcon.Kind.HEART, 38)
		lrow.add_child(h)
		_hearts.append(h)
	lrow.add_child(_spacer(14))
	lrow.add_child(HudIcon.new(HudIcon.Kind.HEAD, 38))
	_lives_label = _value_label("× 3")
	lrow.add_child(_lives_label)

	var right := _pill(root)
	right.anchor_left = 1.0
	right.anchor_right = 1.0
	right.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	right.offset_right = -24
	right.offset_top = 20
	var rrow := right.get_child(0) as HBoxContainer
	_coin_icon = HudIcon.new(HudIcon.Kind.COIN, 38)
	rrow.add_child(_coin_icon)
	_coins_label = _value_label("0 / 0")
	rrow.add_child(_coins_label)
	rrow.add_child(_spacer(18))
	_time_label = _value_label("0:00.0")
	_time_label.custom_minimum_size.x = 96
	rrow.add_child(_time_label)

	_toast = UiKit.title("", 44, UiKit.CREAM, 12)
	_toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_toast.offset_top = 92
	_toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toast.modulate.a = 0.0
	root.add_child(_toast)

	_debug = UiKit.text("", 18, Color.WHITE)
	_debug.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	_debug.add_theme_constant_override("outline_size", 6)
	_debug.add_theme_color_override("font_outline_color", Color.BLACK)
	_debug.position = Vector2(28, 100)
	_debug.visible = false
	root.add_child(_debug)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_debug"):
		_debug.visible = not _debug.visible


func bind(session: GameSession, data: LevelData, player: Node3D) -> void:
	_session = session
	_data = data
	_player = player
	session.coins_changed.connect(_on_coins)
	session.health_changed.connect(_on_health)
	session.lives_changed.connect(_on_lives)
	_on_coins(session.coins)
	_on_health(session.health, GameSession.MAX_HEALTH)
	_on_lives(session.lives)


func _process(_delta: float) -> void:
	if _session == null:
		return
	_time_label.text = UiKit.format_time(_session.time_elapsed)
	if _debug.visible and _player is Player:
		var p := _player as Player
		_debug.text = "pos %.2f, %.2f\nvel %.2f, %.2f\nstate %s  floor %s\n%d fps" % [
				p.global_position.x, p.global_position.y, p.velocity.x, p.velocity.y,
				Player.State.keys()[p.state], p.is_on_floor(), Engine.get_frames_per_second()]
	if _player and _data:
		var sec := _data.section_name_at(_player.global_position.x)
		if sec != _section:
			_section = sec
			show_toast(sec)


func show_toast(message: String) -> void:
	if message.is_empty():
		return
	_toast.text = message
	if _toast_tween:
		_toast_tween.kill()
	_toast_tween = create_tween()
	_toast.scale = Vector2(0.9, 0.9)
	_toast.pivot_offset = _toast.size * 0.5
	_toast_tween.tween_property(_toast, "modulate:a", 1.0, 0.35)
	_toast_tween.parallel().tween_property(_toast, "scale", Vector2.ONE, 0.35) \
			.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_toast_tween.tween_interval(1.8)
	_toast_tween.tween_property(_toast, "modulate:a", 0.0, 0.6)


func _on_coins(coins: int) -> void:
	_coins_label.text = "%d / %d" % [coins, _session.total_coins if _session else 0]
	if coins > 0:
		var tw := create_tween()
		_coin_icon.pivot_offset = _coin_icon.size * 0.5
		tw.tween_property(_coin_icon, "scale", Vector2(1.3, 1.3), 0.06)
		tw.tween_property(_coin_icon, "scale", Vector2.ONE, 0.12)


func _on_health(health: int, _max_health: int) -> void:
	for i in _hearts.size():
		var was := _hearts[i].filled
		_hearts[i].filled = i < health
		if was and not _hearts[i].filled:
			var tw := create_tween()
			_hearts[i].pivot_offset = _hearts[i].size * 0.5
			tw.tween_property(_hearts[i], "scale", Vector2(1.5, 1.5), 0.08)
			tw.tween_property(_hearts[i], "scale", Vector2.ONE, 0.2)


func _on_lives(lives: int) -> void:
	_lives_label.text = "× %d" % lives


func _pill(parent: Control) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(1, 0.97, 0.9, 0.88)
	sb.set_corner_radius_all(26)
	sb.content_margin_left = 18
	sb.content_margin_right = 20
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	sb.shadow_color = Color(0, 0, 0, 0.18)
	sb.shadow_size = 6
	sb.shadow_offset = Vector2(0, 3)
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	p.add_child(row)
	parent.add_child(p)
	return p


func _value_label(t: String) -> Label:
	var l := UiKit.text(t, 30)
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return l


func _spacer(w: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, 0)
	return c
