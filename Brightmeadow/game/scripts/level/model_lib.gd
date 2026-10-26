class_name ModelLib
extends RefCounted
## Instances the generated GLB models from res://assets/models by contract name
## (see docs/ASSET_CONTRACT.md). A missing model is never silently hidden: it is logged as an
## error, recorded in [member missing], and drawn as a bright magenta box so it stands out.

const MODEL_DIR := "res://assets/models/"

static var missing: PackedStringArray = []
static var _cache := {}


static func path_for(model_name: String) -> String:
	return MODEL_DIR + model_name + ".glb"


static func exists(model_name: String) -> bool:
	return ResourceLoader.exists(path_for(model_name))


static func instance(model_name: String) -> Node3D:
	if not _cache.has(model_name):
		var path := path_for(model_name)
		_cache[model_name] = load(path) if ResourceLoader.exists(path) else null
	var scene: PackedScene = _cache[model_name]
	if scene == null:
		if not missing.has(model_name):
			missing.append(model_name)
			push_error("ModelLib: missing model %s — drawing a placeholder" % path_for(model_name))
		return _placeholder(model_name)
	var node := scene.instantiate() as Node3D
	node.name = model_name.to_pascal_case()
	return node


## Finds the first AnimationPlayer anywhere under [param root].
static func find_animation_player(root: Node) -> AnimationPlayer:
	if root is AnimationPlayer:
		return root
	for child in root.get_children():
		var found := find_animation_player(child)
		if found:
			return found
	return null


## Sets the loop mode of the named animations (glTF doesn't carry loop flags).
static func set_looping(player: AnimationPlayer, names: Array, loop := true) -> void:
	if player == null:
		return
	for anim_name in names:
		if player.has_animation(anim_name):
			player.get_animation(anim_name).loop_mode = (
					Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE)


## Puts every mesh under [param root] on the given visual layers (e.g. so the player's blob
## shadow decal, which only affects layer 1, doesn't land on the player).
static func set_visual_layers(root: Node, layers: int) -> void:
	if root is VisualInstance3D:
		(root as VisualInstance3D).layers = layers
	for child in root.get_children():
		set_visual_layers(child, layers)


static func _placeholder(model_name: String) -> Node3D:
	var root := Node3D.new()
	root.name = "Missing_" + model_name
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.8, 0.8, 0.8)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1, 0, 1)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	box.material = mat
	mesh.mesh = box
	mesh.position.y = 0.4
	root.add_child(mesh)
	return root
