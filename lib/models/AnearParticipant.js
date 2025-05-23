"use strict"

const JsonApiResource = require('./JsonApiResource')

const HostUserType = "host"

class AnearParticipant extends JsonApiResource {
  constructor(json, geoLocation = {}) {
    super(json)
    this._geoLocation = geoLocation
    this.send = () => {} // until initialized
  }

  get participantInfo() {
    // safe for app/view display
    return {
      type: this.userType,
      id: this.data.id,
      name: this.name,
      avatarUrl: this.avatarUrl,
      geoLocation: this.geoLocation
    }
  }

  set geoLocation(geoLocation) {
    this._geoLocation = geoLocation
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
    if (service) {
      this.send = service.send.bind(service)
    } else {
      this.send = () => {}
    }
  }


  isHost() {
    return this.userType === HostUserType
  }
}

module.exports = AnearParticipant
