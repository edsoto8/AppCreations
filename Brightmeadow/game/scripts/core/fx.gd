class_name Fx
extends RefCounted
## Small one-shot particle effects built in code (CPU particles, so they also work with the
## Compatibility renderer).


static func burst(parent: Node, pos: Vector3, color: Color, amount := 12, size := 0.16,
		speed := 4.0) -> CPUParticles3D:
	if parent == null:
		return null
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.explosiveness = 0.95
	p.amount = amount
	p.lifetime = 0.6
	p.direction = Vector3.UP
	p.spread = 80.0
	p.initial_velocity_min = speed * 0.5
	p.initial_velocity_max = speed
	p.gravity = Vector3(0, -9.0, 0)
	p.damping_min = 1.0
	p.damping_max = 2.0
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.0
	var curve := Curve.new()
	curve.add_point(Vector2(0, 1))
	curve.add_point(Vector2(1, 0))
	p.scale_amount_curve = curve
	var mesh := SphereMesh.new()
	mesh.radius = size
	mesh.height = size * 2.0
	mesh.radial_segments = 8
	mesh.rings = 4
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = 0.6
	mat.roughness = 0.8
	mesh.material = mat
	p.mesh = mesh
	parent.add_child(p)
	p.global_position = pos
	p.emitting = true
	p.finished.connect(p.queue_free)
	return p


## A soft dust-puff emitter for the player's feet (re-triggered with restart()).
static func make_dust() -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.name = "Dust"
	p.one_shot = true
	p.emitting = false
	p.explosiveness = 0.9
	p.amount = 8
	p.lifetime = 0.45
	p.direction = Vector3(0, 1, 0)
	p.spread = 85.0
	p.initial_velocity_min = 1.0
	p.initial_velocity_max = 2.4
	p.gravity = Vector3(0, 1.0, 0)
	p.damping_min = 3.0
	p.damping_max = 4.0
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	p.emission_box_extents = Vector3(0.3, 0.02, 0.15)
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.5))
	curve.add_point(Vector2(0.3, 1))
	curve.add_point(Vector2(1, 0))
	p.scale_amount_curve = curve
	var mesh := SphereMesh.new()
	mesh.radius = 0.12
	mesh.height = 0.24
	mesh.radial_segments = 8
	mesh.rings = 4
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.96, 0.93, 0.85, 0.85)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = 1.0
	mesh.material = mat
	p.mesh = mesh
	return p
