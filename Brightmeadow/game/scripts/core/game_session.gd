class_name GameSession
extends RefCounted
## Pure game-state rules for one play of the level: coins, health, lives, checkpoints and the
## state machine. The Game autoload owns one instance and connects nodes to its signals; tests
## drive it directly.

signal coins_changed(coins: int)
signal health_changed(health: int, max_health: int)
signal lives_changed(lives: int)
signal checkpoint_changed(index: int)
signal state_changed(new_state: State, old_state: State)

enum State { READY, PLAYING, PAUSED, RESPAWNING, GAME_OVER, COMPLETE }

const MAX_HEALTH := 3
const START_LIVES := 3

var state: State = State.READY
var coins := 0
var total_coins := 0
var health := MAX_HEALTH
var lives := START_LIVES
## -1 = level start.
var checkpoint_index := -1
var time_elapsed := 0.0
var enemies_stomped := 0


func start(level_total_coins: int) -> void:
	coins = 0
	total_coins = level_total_coins
	health = MAX_HEALTH
	lives = START_LIVES
	checkpoint_index = -1
	time_elapsed = 0.0
	enemies_stomped = 0
	coins_changed.emit(coins)
	health_changed.emit(health, MAX_HEALTH)
	lives_changed.emit(lives)
	checkpoint_changed.emit(checkpoint_index)
	_set_state(State.PLAYING)


func is_playing() -> bool:
	return state == State.PLAYING


func tick(delta: float) -> void:
	if state == State.PLAYING:
		time_elapsed += delta


func collect_coin() -> void:
	if state != State.PLAYING:
		return
	coins += 1
	coins_changed.emit(coins)


func record_stomp() -> void:
	enemies_stomped += 1


## Removes health. Returns true when this hit used up the last heart (the caller then plays the
## defeat and calls [method lose_life]).
func damage(amount := 1) -> bool:
	if state != State.PLAYING or amount <= 0:
		return false
	health = maxi(0, health - amount)
	health_changed.emit(health, MAX_HEALTH)
	return health == 0


## Spends a life after a fall or running out of health. Moves to RESPAWNING, or GAME_OVER when
## no lives remain. Returns true on game over.
func lose_life() -> bool:
	if state != State.PLAYING:
		return state == State.GAME_OVER
	lives = maxi(0, lives - 1)
	lives_changed.emit(lives)
	if lives == 0:
		_set_state(State.GAME_OVER)
		return true
	_set_state(State.RESPAWNING)
	return false


## Called once the player is back at the checkpoint.
func respawned() -> void:
	if state != State.RESPAWNING:
		return
	health = MAX_HEALTH
	health_changed.emit(health, MAX_HEALTH)
	_set_state(State.PLAYING)


## Activates checkpoint [param index]. Only moves forward; returns true if it changed.
func activate_checkpoint(index: int) -> bool:
	if state != State.PLAYING or index <= checkpoint_index:
		return false
	checkpoint_index = index
	checkpoint_changed.emit(index)
	return true


func complete() -> bool:
	if state != State.PLAYING:
		return false
	_set_state(State.COMPLETE)
	return true


func pause() -> bool:
	if state != State.PLAYING:
		return false
	_set_state(State.PAUSED)
	return true


func resume() -> bool:
	if state != State.PAUSED:
		return false
	_set_state(State.PLAYING)
	return true


func _set_state(new_state: State) -> void:
	if new_state == state:
		return
	var old := state
	state = new_state
	state_changed.emit(new_state, old)
