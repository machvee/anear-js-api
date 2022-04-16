"use strict"

const logger = require('./Logger')

const Off = "off"
const Running = "running"
const Paused = "paused"
const Expired = "expired"

class ParticipantTimer {
  constructor(participantId, expireCallback) {
    this.participantId = participantId
    this.expireCallback = expireCallback

    this.turnOff()
  }
  
  start(timeoutMsecs, now = Date.now()) {
    logger.debug(`starting ${timeoutMsecs} msec timer for participant ${this.participantId}`)
    this.runTimer(now, timeoutMsecs)
  }

  timerExpired() {
    logger.debug(`TIMEOUT!! timer expired for participant ${this.participantId}`)
    this.state = Expired
    this.expireCallback()
  }

  runTimer(now, timeoutMsecs) {
    this.startedAt = now
    this.timeRemaining = timeoutMsecs
    this.state = Running
    this.id = setTimeout(() => this.timerExpired(), timeoutMsecs)
  }

  interrupt(now = Date.now()) {
    // pause the timer to set the timeRemaining and then resume
    // This is useful when a Participant does a quick LEAVE then rejoins with a REFRESH
    this.pause(now)
    this.resume(now)

    return this.timeRemaining
  }

  pause(now = Date.now()) {
    // if running, stop the timer
    this.checkTimerIs(Running)

    clearTimeout(this.id)
    this.id = null
    this.timeRemaining -= (now - this.startedAt)

    logger.debug(`pausing timer for participant ${this.participantId}. Time remaining: ${this.timeRemaining}`)
    this.state = Paused
  }

  resume(now = Date.now()) {
    // if paused, restarts the timer with the timeRemaining
    this.checkTimerIs(Paused)

    if (this.timeRemaining > 0) {
      logger.debug(`resuming ${this.timeRemaining} msec timer for participant ${this.participantId}`)
      this.runTimer(now, this.timeRemaining)
    } else {
      logger.debug(`resume() detects timeRemaining of ${this.timeRemaining} so is calling timerExpired() for participant ${this.participantId}`)
      this.timerExpired()
    }
  }

  reset() {
    // if running, stops the timer and/or sets the timer state to Off
    logger.debug(`resetting timer for participant ${this.participantId}`)

    if (this.id) clearTimeout(this.id)

    this.turnOff()
  }

  turnOff() {
    this.id = null
    this.state = Off
    this.startedAt = null
  }

  checkTimerIs(state) {
    if (this.state !== state) throw new Error(`timer is not ${state}`)
  }

  get isRunning() {
    return this.state === Running
  }

  get isPaused() {
    return this.state === Paused
  }

  get isOff() {
    return this.state === Off
  }

  get isExpired() {
    return this.state === Expired
  }
}

module.exports = ParticipantTimer
