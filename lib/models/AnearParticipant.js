"use strict"

const JsonApiResource = require('./JsonApiResource')

const HostUserType = "host"

class AnearParticipant extends JsonApiResource {
  constructor(json) {
    super(json)
    this.send = () => {} // until initialized with setActor
  }

  get publicAttrs() {
    // safe for public consumption
    return {
      type: this.userType,
      id: this.data.id,
      name: this.name,
      avatarUrl: this.avatarUrl
    }
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

  setMachine(service) {
    this.send = service.send.bind(service)
  }


  isHost() {
    return this.userType === HostUserType
  }
}

module.exports = AnearParticipant
