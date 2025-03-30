"use strict"

const JsonApiResource = require('./JsonApiResource')

const HostUserType = "host"

class AnearParticipant extends JsonApiResource {
  constructor(json) {
    super(json)
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

  get machineRef() {
    return this._machineRef
  }

  set machineRef(val) {
    this._machineRef = val
  }

  isHost() {
    return this.userType === HostUserType
  }
}

module.exports = AnearParticipant
