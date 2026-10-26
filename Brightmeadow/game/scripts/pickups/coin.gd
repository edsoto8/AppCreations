class_name Coin
extends Area3D
## Spinning collectible. Reports to the level through [signal collected].

signal collected(coin: Coin)

const SPIN_SPEED := 2.6

var _taken := false
var _base_y := 0.0
var _phase := 0.0

@onready var visual: Node3D = $Visual


func _ready() -> void:
	visual.add_child(ModelLib.instance("coin"))
	_base_y = position.y
	# Neighbouring coins spin and bob slightly out of step, which reads as a little wave.
	_phase = position.x * 0.45
	body_entered.connect(_on_body_entered)


func _physics_process(delta: float) -> void:
	if _taken:
		return
	_phase += delta
	visual.rotation.y = _phase * SPIN_SPEED
	visual.position.y = sin(_phase * 3.0) * 0.07


func _on_body_entered(body: Node3D) -> void:
	if _taken or not body.is_in_group("player"):
		return
	collect()


func collect() -> void:
	if _taken:
		return
	_taken = true
	set_deferred("monitoring", false)
	collected.emit(self)
	Audio.play_sfx("coin", 0.03)
	Fx.burst(get_parent(), global_position, Color(1.0, 0.85, 0.3), 8, 0.08, 3.0)
	var tw := create_tween().set_process_mode(Tween.TWEEN_PROCESS_PHYSICS).set_parallel()
	tw.tween_property(visual, "position:y", visual.position.y + 0.8, 0.25) \
			.set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
	tw.tween_property(visual, "rotation:y", visual.rotation.y + TAU * 1.5, 0.25)
	tw.tween_property(visual, "scale", Vector3(0.01, 0.01, 0.01), 0.12).set_delay(0.18)
	tw.chain().tween_callback(queue_free)


func is_taken() -> bool:
	return _taken
