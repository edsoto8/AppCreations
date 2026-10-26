class_name HudIcon
extends Control
## Vector-drawn HUD icons (heart, coin, explorer head) so the HUD needs no image files.

enum Kind { HEART, COIN, HEAD }

var kind: Kind = Kind.HEART
## For hearts: false draws an empty heart.
var filled := true:
	set(value):
		filled = value
		queue_redraw()


func _init(k: Kind = Kind.HEART, icon_size := 40.0) -> void:
	kind = k
	custom_minimum_size = Vector2(icon_size, icon_size)


func _draw() -> void:
	var s := minf(size.x, size.y)
	var c := size * 0.5
	match kind:
		Kind.HEART:
			_draw_heart(c, s)
		Kind.COIN:
			draw_circle(c, s * 0.46, Color("8a5a12"))
			draw_circle(c, s * 0.42, Color("e09a1a"))
			draw_circle(c, s * 0.33, Color("ffc53d"))
			draw_rect(Rect2(c + Vector2(-s * 0.05, -s * 0.18), Vector2(s * 0.1, s * 0.36)),
					Color("fff1b8"))
		Kind.HEAD:
			draw_circle(c + Vector2(0, s * 0.04), s * 0.42, Color("3b2a20"))
			draw_circle(c + Vector2(0, s * 0.04), s * 0.37, Color("f2c29b"))
			draw_circle(c + Vector2(0, -s * 0.2), s * 0.3, Color("4a2c1d"))
			draw_circle(c + Vector2(0, s * 0.1), s * 0.27, Color("f2c29b"))
			draw_circle(c + Vector2(-s * 0.12, s * 0.06), s * 0.06, Color("1e1a2e"))
			draw_circle(c + Vector2(s * 0.12, s * 0.06), s * 0.06, Color("1e1a2e"))
			draw_circle(c + Vector2(-s * 0.2, s * 0.2), s * 0.05, Color("f49a8c"))
			draw_circle(c + Vector2(s * 0.2, s * 0.2), s * 0.05, Color("f49a8c"))


func _draw_heart(c: Vector2, s: float) -> void:
	var pts := PackedVector2Array()
	for i in 48:
		var t := TAU * i / 48.0
		# Classic heart curve, scaled into the box.
		var x := 16.0 * pow(sin(t), 3)
		var y := -(13.0 * cos(t) - 5.0 * cos(2 * t) - 2.0 * cos(3 * t) - cos(4 * t))
		pts.append(c + Vector2(x, y + 1.5) * s / 36.0)
	var outline := Color("3b2a20")
	var fill := Color("e8483b") if filled else Color(0.85, 0.8, 0.75, 0.7)
	var big := PackedVector2Array()
	for p in pts:
		big.append(c + (p - c) * 1.18)
	draw_colored_polygon(big, outline)
	draw_colored_polygon(pts, fill)
	if filled:
		draw_circle(c + Vector2(-s * 0.17, -s * 0.12), s * 0.07, Color(1, 1, 1, 0.75))
