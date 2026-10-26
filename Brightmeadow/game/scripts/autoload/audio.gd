extends Node
## Audio autoload: a small pool of SFX players plus a music player with crossfades.
## Every sound is optional. A missing file logs one warning and is skipped, so the game still
## runs if audio generation failed.

const AUDIO_DIR := "res://assets/audio/"
const SFX := ["jump", "coin", "stomp", "hurt", "checkpoint", "land", "fall", "level_complete",
		"game_over", "ui_move", "ui_select"]
const MUSIC := ["music_meadow", "music_menu"]
const POOL_SIZE := 10

var music_volume_db := -6.0
var muted := false

var _streams := {}
var _pool: Array[AudioStreamPlayer] = []
var _next := 0
var _music: AudioStreamPlayer
var _music_name := ""
var _music_tween: Tween


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_ensure_bus("Music")
	_ensure_bus("SFX")
	for sfx_name in SFX:
		_streams[sfx_name] = _load(sfx_name + ".wav")
	for music_name in MUSIC:
		var stream: AudioStream = _load(music_name + ".ogg")
		if stream is AudioStreamOggVorbis:
			stream.loop = true
		_streams[music_name] = stream
	for i in POOL_SIZE:
		var p := AudioStreamPlayer.new()
		p.bus = "SFX"
		add_child(p)
		_pool.append(p)
	_music = AudioStreamPlayer.new()
	_music.bus = "Music"
	add_child(_music)


func _exit_tree() -> void:
	# Release playing streams before shutdown so nothing outlives the audio server.
	if _music_tween:
		_music_tween.kill()
		_music_tween = null  # its callback closure holds a stream reference
	_music.stop()
	_music.stream = null
	for p in _pool:
		p.stop()
		p.stream = null
	_streams.clear()


func has_sound(sound_name: String) -> bool:
	return _streams.get(sound_name) != null


## Plays a one-shot. [param pitch_jitter] randomises pitch by ± that fraction.
func play_sfx(sound_name: String, pitch_jitter := 0.0, volume_db := 0.0, pitch := 1.0) -> void:
	var stream: AudioStream = _streams.get(sound_name)
	if stream == null:
		return
	var p := _pool[_next]
	_next = (_next + 1) % _pool.size()
	p.stream = stream
	p.volume_db = volume_db
	p.pitch_scale = pitch * (1.0 + randf_range(-pitch_jitter, pitch_jitter))
	p.play()


func play_music(music_name: String, fade := 0.8) -> void:
	if music_name == _music_name and _music.playing:
		# Same track (e.g. "Play Again"): just undo any ducking.
		if _music_tween:
			_music_tween.kill()
		_music_tween = create_tween()
		_music_tween.tween_property(_music, "volume_db", music_volume_db, fade)
		return
	_music_name = music_name
	var stream: AudioStream = _streams.get(music_name)
	if _music_tween:
		_music_tween.kill()
	_music_tween = create_tween()
	if _music.playing:
		_music_tween.tween_property(_music, "volume_db", -40.0, fade * 0.5)
	_music_tween.tween_callback(func():
		_music.stop()
		if stream:
			_music.stream = stream
			_music.volume_db = -40.0
			_music.play())
	if stream:
		_music_tween.tween_property(_music, "volume_db", music_volume_db, fade)


func stop_music(fade := 0.6) -> void:
	_music_name = ""
	if _music_tween:
		_music_tween.kill()
	_music_tween = create_tween()
	_music_tween.tween_property(_music, "volume_db", -40.0, fade)
	_music_tween.tween_callback(_music.stop)


## Ducks the music (e.g. under the level-complete fanfare).
func duck_music(amount_db := -14.0, time := 0.3) -> void:
	if _music_tween:
		_music_tween.kill()
	_music_tween = create_tween()
	_music_tween.tween_property(_music, "volume_db", music_volume_db + amount_db, time)


func toggle_mute() -> void:
	muted = not muted
	AudioServer.set_bus_mute(0, muted)


func _load(file: String) -> AudioStream:
	var path := AUDIO_DIR + file
	if not ResourceLoader.exists(path):
		push_warning("Audio: %s not found, continuing without it" % path)
		return null
	return load(path)


func _ensure_bus(bus_name: String) -> void:
	if AudioServer.get_bus_index(bus_name) == -1:
		AudioServer.add_bus()
		var idx := AudioServer.bus_count - 1
		AudioServer.set_bus_name(idx, bus_name)
		AudioServer.set_bus_send(idx, "Master")
