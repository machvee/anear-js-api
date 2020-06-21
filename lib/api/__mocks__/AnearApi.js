"use strict"

class AnearApi {

  async getAccount() {
  }

  async transitionEvent(eventId, eventName='next') {
    return {state: "announce"}
  }

  getEventParticipant(participantId, geoLocation) {
    return Promise.resolve(new AnearParticipant({}, {}))
  }
}

module.exports = AnearApi
