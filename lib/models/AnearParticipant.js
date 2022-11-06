"use strict"
const JsonApiResource = require('./JsonApiResource')
const HostUserType = "host"

class AnearParticipant extends JsonApiResource {
  constructor(json, anearEvent) {
    super(json)
    this.anearEvent = anearEvent
    this._state = json.state
    this._timestamp = json.timestamp
  }

  toJSON() {
    return {
      ...super.toJSON(),
      geoLocation: this._geoLocation || null,
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
}

module.exports = AnearParticipant
