"use strict"
const JsonApiResource = require('./JsonApiResource')

class AnearParticipant extends JsonApiResource {
  toJSON() {
    return {
      ...super.toJSON(),
      geoLocation: this._geoLocation || null,
    }
  }

  set geoLocation(loc) {
    this._geoLocation = loc
  }

  get geoLocation() {
    return this._geoLocation
  }

  get identity() {
    return (({ id, userId, name, avatarUrl, geoLocation }) => ({ id, userId, name, avatarUrl, geoLocation }))(this)
  }

  get userId() {
    return this.relationships.user.data.id
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
