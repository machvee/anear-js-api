"use strict"

const JsonApiResource = require('./JsonApiResource')
const logger = require('../utils/Logger')

const HostUserType = "host"

class AnearParticipant extends JsonApiResource {
  constructor(json, anearEvent) {
    super(json)
    this.anearEvent = anearEvent
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
}

module.exports = AnearParticipant
