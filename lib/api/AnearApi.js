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

  async transitionEvent(eventId, newStateName) {
    logger.debug(`API: POST transition event ${newStateName}`)

    const relationships = {event: eventId}
    const json = await this.post("transitions", {state: newStateName}, relationships)
    const attrs = json.data.attributes
    return attrs
  }

  async uploadAppCss(appId, cssContent, fileSuffix) {
    logger.debug(`API: POST upload app css ${appId} with suffix ${fileSuffix}`)

    const postAttrs = {
      body: cssContent,
      suffix: fileSuffix
    }
    const relationships = {app: appId}

    const json = await this.post("app_css", postAttrs, relationships)
    const attrs = json.data.attributes
    return attrs
  }

  async uploadAppImageAssets(appId, b64EncodedGzippedTarBall) {
    logger.debug(`API: POST upload image assets for ${appId}`)

    const postAttrs = {
      body: b64EncodedGzippedTarBall
    }
    const relationships = {app: appId}

    const json = await this.post("app_image_assets", postAttrs, relationships)
    const attrs = json.data.attributes
    return attrs
  }

  getEventParticipantJson(participantId) {
    logger.debug(`API: GET event_participant ${participantId}`)

    return this.get("event_participants", {id: participantId})
  }

  getUser(userId) {
    logger.debug(`API: GET user ${userId}`)

    return this.get("users", {id: userId})
  }
}

module.exports = AnearApi
