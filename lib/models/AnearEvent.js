"use strict"
const logger = require('../utils/Logger')

const JsonApiResource = require('./JsonApiResource')

const UnplayableStates = ['closing', 'closed', 'canceled']

class AnearEvent extends JsonApiResource {

  constructor(json) {
    super(json)
    this.zone = this.findIncluded(this.relationships.zone)
    this.app = this.findIncluded(this.zone.relationships.app)
    this.send = () => {} // until initialized
  }

  get userId() {
    return this.relationships.user.data.id
  }

  get zoneId() {
    return this.relationships.zone.data.id
  }

  setMachine(service) {
    if (service) {
      this.send = service.send.bind(service)
    } else {
      this.send = () => {}
    }
  }

  announceEvent() {
    this.send("ANNOUNCE")
  }

  startEvent() {
    this.send("START")
  }

  cancelEvent() {
    this.send("CANCEL")
  }

  closeEvent() {
    this.send("CLOSE")
  }

  bootParticipant(participantId, reason) {
    this.send("BOOT_PARTICIPANT", { participantId, reason })
  }

  render(viewPath, displayType, appContext, event, timeout = null, props = {}) {
    // Explicit render method for guaranteed rendering control
    // This complements the meta: {} approach for when you need explicit control
    // 
    // @param {string} viewPath - Template/view path to render
    // @param {string} displayType - 'participants', 'participant', or 'spectators'
    // @param {Object} appContext - The AppM's context object (available in scope)
    // @param {Object} event - The event that triggered this render (available in scope)
    // @param {Function|number|null} timeout - Timeout function or value for participant displays
    // @param {Object} props - Additional properties to merge into meta
    
    const RenderContextBuilder = require('../utils/RenderContextBuilder')
    
    const appRenderContext = RenderContextBuilder.buildAppRenderContext(
      appContext,
      appContext.state || 'render',
      event.type || 'render',
      displayType,
      timeout
    )
    
    // Merge additional props into meta
    if (Object.keys(props).length > 0) {
      Object.assign(appRenderContext.meta, props)
    }
    
    this.send("RENDER_DISPLAY", {
      displayEvents: [{
        viewPath,
        appRenderContext
      }]
    })
  }

  pauseEvent() {
    this.send("PAUSE")
  }

  resumeEvent() {
    this.send("RESUME")
  }

  getClonedFromEvent() {
    // if the current event was a clone of previous event, fetch if from
    // Peristence and return
    const clonedFromEventData = this.relationships["cloned-from"].data
    if (!clonedFromEventData) return null

    return this.constructor.getFromStorage(clonedFromEventData.id)
  }

  async clonedFromEventContext() {
    const clonedFrom = await this.getClonedFromEvent()

    return clonedFrom ? clonedFrom.context : null
  }

  get eventState() {
    return this.attributes.state
  }

  get hosted() {
    return this.attributes.hosted
  }

  get name() {
    return this.attributes.name
  }

  get description() {
    return this.attributes.description
  }

  get createdAt() {
    return this.attributes['created-at']
  }

  get participantTimeout() {
    // TODO: This probably should be set for each publishEventPrivateMessage
    // and then referenceable as an anear-data attribute in the html.  That way
    // the App has explicit control over each interaction.  Each user game prompt
    // can have its own appropriate timeout duration based on the app/game
    // xStateContext/context.
    //
    // In the React Anear Browser, there is no local setTimer that calls back and
    // transitions the participant.  That will now be driven by the app and private
    // display messages.  For example, "Hey, wake up!!  Rejoin? (countdown 3...2....1)"
    // This allows on-premise game participants having a momentary distraction to rejoin
    // the game after a first timeout.
    return this.app.attributes["participant-timeout"]
  }

  hasFlag(flagName) {
    return this.attributes.flags.includes(flagName)
  }

  allowsSpectators() {
    return !this.hasFlag("no_spectators")
  }

  isParticipantEventCreator(participant) {
    return participant.userId === this.userId
  }

  isPlayable() {
    return !UnplayableStates.includes(this.eventState)
  }

  get eventChannelName() {
    return this.getChannelName('event')
  }

  get participantsChannelName () {
    return this.getChannelName('participants')
  }

  get actionsChannelName () {
    return this.getChannelName('actions')
  }

  get spectatorsChannelName () {
    return this.getChannelName('spectators')
  }

  getChannelName (key) {
    return this.attributes[`${key}-channel-name`]
  }
}

module.exports = AnearEvent
