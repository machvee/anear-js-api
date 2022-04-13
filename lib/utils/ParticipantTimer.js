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
    this.startedAt = now
    logger.debug(`starting ${timeoutMsecs} msec timer for participant ${this.participantId}`)
    this.runTimer(timeoutMsecs)
  }

  runTimer(timeoutMsecs) {
    const timerExpired = () => {
      this.state = Expired
      this.expireCallback()
    }
    this.state = Running
    this.id = setTimeout(timerExpired, timeoutMsecs)
  }

  pause(now = Date.now()) {
    // if running, stop the timer
    if (!this.isRunning) throw new Error("timer not running")

    clearTimeout(this.id)
    this.id = null
    this.timeRemaining = now - this.startedAt

    logger.debug(`pausing timer for participant ${this.participantId}. Time remaining: ${this.timeRemaining}`)
    this.state = Paused
  }

  resume() {
    // if paused, restarts the timer with the timeRemaining
    if (!this.isPaused) throw new Error("timer not paused")

    if (this.timeRemaining > 0) {
      logger.debug(`resuming ${this.timeRemaining} msec timer for participant ${this.participantId}`)
      this.runTimer(this.timeRemaining)
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
