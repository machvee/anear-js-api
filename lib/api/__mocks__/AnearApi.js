"use strict"

class AnearApi {

  getAccount() {
  }

  async transitionEvent(eventId, eventName='next') {
    return {state: "announce"}
  }

  getEventParticipant(participantId, geoLocation) {
    return Promise.resolve(new AnearParticipant({}, {}))
  }
}

module.exports = AnearApi
