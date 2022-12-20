"use strict"
const logger = require('../utils/Logger')
const ApiService = require('./ApiService')

class AnearApi extends ApiService {

  constructor(apiKey, apiVersion) {
    super(apiKey, apiVersion)
  }

  getAccount() {
    logger.debug("API: GET /accounts")

    return this.get("accounts")
  }

  getEvent(eventId) {
    logger.debug(`API: GET event ${eventId}`)

    return this.get("events", {id: eventId})
  }

  getAppZones(appId) {
    logger.debug(`API: GET app_zones ${appId}`)

    return this.get("app_zones", {id: appId})
  }

  getApp(appId) {
    logger.debug(`API: GET app ${appId}`)

    return this.get("apps", {id: appId})
  }

  getZoneEvents(zoneId) {
    logger.debug(`API: GET zone_events ${zoneId}`)

    return this.get("zone_events", {id: zoneId})
  }

  async transitionEvent(eventId, eventName='next') {
    logger.debug(`API: POST transition event ${eventName}`)

    const relationships = {event: eventId}
    const json = await this.post("transitions", {event_name: eventName}, relationships)
    const attrs = json.data.attributes
    logger.debug(`API: newState is ${attrs.state}`)
    return attrs
  }

  getEventParticipantJson(participantId, geoLocation) {
    logger.debug(`API: GET event_participant ${participantId}`)

    return this.get("event_participants", {id: participantId})
  }
}

module.exports = AnearApi
