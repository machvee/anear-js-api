"use strict"
const logger = require('../utils/Logger')
const ApiService = require('./ApiService')

class AnearApi extends ApiService {

  async getAccount() {
    logger.debug("API: GET /accounts")

    return await this.get("accounts")
  }

  async getEvent(eventId) {
    logger.debug(`API: GET event ${eventId}`)

    const json = await this.get("events", {id: eventId})
    return json
  }

  async getAppZones(appId) {
    logger.debug(`API: GET app_zones ${appId}`)

    const json = await this.get("app_zones", {id: appId})
    return json
  }

  async getZoneEvents(zoneId) {
    logger.debug(`API: GET zone_events ${zoneId}`)

    const json = await this.get("zone_events", {id: zoneId})
    return json
  }

  async transitionEvent(eventId, eventName='next') {
    logger.debug(`API: POST transition event ${eventName}`)

    const relationships = {event: eventId}
    try {
      const json = await this.post("transitions", {event_name: eventName}, relationships)
      const attrs = json.data.attributes
      logger.info(`newState is ${attrs.state}`)
      return attrs
    } catch(err) {
      logger.error(err)
    }
  }

  async getEventParticipantJson(participantId, geoLocation) {
    logger.debug(`API: GET event_participant ${participantId}`)

    const json = await this.get("event_participants", {id: participantId})
    return json
  }
}

module.exports = AnearApi
