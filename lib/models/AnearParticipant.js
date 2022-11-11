"use strict"

const JsonApiResource = require('./JsonApiResource')
const ParticipantTimer = require('../utils/ParticipantTimer')
const logger = require('../utils/Logger')

const HostUserType = "host"

class AnearParticipant extends JsonApiResource {
  constructor(json, anearEvent) {
    super(json)
    this.anearEvent = anearEvent
    this.timer = null
    this._state = json.state
    this._timestamp = json.timestamp
    this._geoLocation = null
  }

  toJSON() {
    return {
      ...super.toJSON(),
      state: this.state,
      timestamp: this.timestamp
    }
  }

  get state() {
    return this._state
  }

  set state(s) {
    this._state = s
  }

  get timestamp() {
    return this._timestamp
  }

  set timestamp(t) {
    this._timestamp = t
  }

  set geoLocation(loc) {
    this._geoLocation = loc
  }

  get geoLocation() {
    return this._geoLocation
  }

  get userId() {
    return this.relationships.user.data.id
  }

  get userType() {
    return this.attributes["user-type"]
  }

  isHost() {
    return this.userType === HostUserType
  }

  get eventId() {
    return this.relationships.event.data.id
  }

  get user() {
    return this.findIncluded(this.relationships.user)
  }

  get profile() {
    return this.findIncluded(this.user.relationships.profile)
  }

  get name() {
    return this.attributes.name
  }

  get avatarUrl() {
    return this.profile.attributes['avatar-url']
  }

  get privateChannelName() {
    return this.attributes['private-channel-name']
  }

  ensureTimer(timeoutMsecs) {
    // this is called when a new timer is being started for a privateMessage
    // sent to a participant, or public message to all participants
    // If the timer already exists and is paused, it is resumed with the timeRemaining
    // [a starter function, timeRemaining] is returned
    let timeRemaining = timeoutMsecs
    let timerStarter = () => {}

    if (timeoutMsecs > 0) {

      this.timer ||= new ParticipantTimer(
        this.id,
        async () => await this.timerExpired(timeoutMsecs)
      )

      if (this.timer.isRunning) {
        timeRemaining = this.timer.interrupt()
      } else {
        timerStarter = () => this.timer.start(timeoutMsecs)
      }
    }
    logger.debug(`ensureTimer(timeRemaining: ${timeRemaining})`)

    return [timerStarter, timeRemaining]
  }

  destroyTimer() {
    // participant will not be receiving any more display messages
    // so we close out and delete the timer
    if (this.timer) {
      this.timer.reset()
      this.timer = null
    }
  }

  async timerExpired(timeoutMsecs) {
    logger.debug(`participant (${this.anearEvent.id}, ${this.id}) TIMED OUT after ${timeoutMsecs} msecs`)

    this.timer = null

    await this.anearEvent.participantTimedOut(this)
    await this.anearEvent.update()
  }

  interruptTimer() {
    if (this.timer && this.timer.isRunning) this.timer.interrupt()
  }

  resetTimer() {
    // called after participant takes Action before timer expires
    if (this.timer) this.timer.reset()
  }
}

module.exports = AnearParticipant
