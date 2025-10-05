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
    return this.get("events", { id: eventId })
  }

  getAppZones(appId) {
    logger.debug(`API: GET app_zones ${appId}`)
    return this.get("app_zones", { id: appId })
  }

  getApp(appId) {
    logger.debug(`API: GET app ${appId}`)
    return this.get("apps", { id: appId })
  }

  getZoneEvents(zoneId) {
    logger.debug(`API: GET zone_events ${zoneId}`)
    return this.get("zone_events", { id: zoneId })
  }

  async transitionEvent(eventId, newStateName) {
    logger.debug(`API: POST transition event ${newStateName}`)
    const relationships = { event: eventId }
    const json = await this.post("transitions", { state: newStateName }, relationships)
    const attrs = json.data.attributes
    return attrs
  }

  getEventParticipantJson(participantId) {
    logger.debug(`API: GET event_participant ${participantId}`)
    return this.get("event_participants", { id: participantId })
  }

  getUser(userId) {
    logger.debug(`API: GET user ${userId}`)
    return this.get("users", { id: userId })
  }

  async getAppCssUploadUrl(appId, contentHash, fileSuffix = ".min.css") {
    logger.debug(`API: POST get app styles upload URL for app ${appId} with suffix ${fileSuffix} and content_hash ${contentHash}`)
    const postAttrs = { content_hash: contentHash, suffix: fileSuffix }
    const relationships = { app: appId }
    const json = await this.post("app_styles", postAttrs, relationships)
    const attrs = json.data.attributes
    logger.debug('getAppCssUploadUrl response:', attrs)
    return attrs
  }

  async getAppImageAssetsUploadUrls(appId, files) {
    logger.debug(`API: POST get image assets upload URLs for app ${appId}`)
    const postAttrs = { files }
    const relationships = { app: appId }
    const json = await this.post("app_image_assets", postAttrs, relationships)
    const attrs = json.data.attributes
    logger.debug('getAppImageAssetsUploadUrls response:', attrs)
    return attrs
  }

  async getAppFontAssetsUploadUrls(appId, files) {
    logger.debug(`API: POST get font assets upload URLs for app ${appId}`)
    const postAttrs = { files }
    const relationships = { app: appId }
    const json = await this.post("app_font_assets", postAttrs, relationships)
    const attrs = json.data.attributes
    logger.debug('getAppFontAssetsUploadUrls response:', attrs)
    return attrs
  }

  async saveAppEventContext(eventId, appmContext) {
    logger.debug(`API: POST developer events/${eventId}/app_event_context`)
    const path = `events/${eventId}/app_event_context`
    return this.postRaw(path, { appm_context: appmContext })
  }

  async getLatestAppEventContext(eventId) {
    logger.debug(`API: GET developer events/${eventId}/app_event_context`)
    const path = `events/${eventId}/app_event_context`
    const json = await this.get(path)
    const attrs = json.data && json.data.attributes ? json.data.attributes : {}
    const eventIdAttr = attrs['event-id']
    const raw = attrs['appm-context']
    let appmContext = null
    try {
      appmContext = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch (e) {
      // leave appmContext as null if parsing fails
    }
    return { eventId: eventIdAttr, appmContext }
  }
}

// Instantiate and export the API immediately
const apiKey = process.env.ANEARAPP_API_KEY
const apiVersion = process.env.ANEARAPP_API_VERSION

if (!apiKey || !apiVersion) {
  throw new Error("API_KEY and API_VERSION must be defined in environment variables")
}

const anearApiInstance = new AnearApi(apiKey, apiVersion)

module.exports = anearApiInstance
