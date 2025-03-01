"use strict"

const JsonApiResource = require('./JsonApiResource')
const logger = require('../utils/Logger')

const HostUserType = "host"
const PrivateDisplayChannelEventName = 'PRIVATE_DISPLAY'

class AnearParticipant extends JsonApiResource {
  constructor(json) {
    super(json)
    logger.debug(`Creating AnearParticipant for user ${this.user.attributes.name}`)
  }

  get userId() {
    return this.relationships.user.data.id
  }

  get userType() {
    return this.attributes["user-type"]
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

  get anearParticipantMachine() {
    return this._anearParticipantMachine
  }

  set anearParticipantMachine(val) {
    this._anearParticipantMachine = val
  }

  isHost() {
    return this.userType === HostUserType
  }

  publish(context, message) {
    // returns a Promise
    return context.privateChannel.publish(PrivateDisplayChannelName, message)
  }
}

module.exports = AnearParticipant
