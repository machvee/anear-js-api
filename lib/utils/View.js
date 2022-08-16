"use strict"
const pug = require("pug")


class View {
  constructor(anearEvent) {
    this.anearEvent = anearEvent
    this.templateFuncs = new Map()
  }
  // View Display Types:
  //    - participant ALL (all participants receive at once)
  //    - participant individual private (custom tailored for individual participant)
  //    - spectator ALL (all spectators get non-interactive game status, plus JOIN if possible)
  //
  // AppDevs define View templates for each display type
  //    host, participant_private(p), participant_all, spectator
  //
  //    - Use partials with passed params to eliminate duplication of template layout
  //    - each template has the following context passed in:
  //      - xState context
  //      - xStateEVent event data (e.g. participant Action payload)
  //      - Anear event metadata (id attributes app zone user)
  //      - participant metadata (attributes if participant(s) view)
  //      - current participants
  //      - spectator count
  //
  renderAllParticipants(template, xStateContext, xStateEvent, renderOptions) {
    // one message body sent to the (all) participants channel
    const timeout = this.getTimeout(renderOptions)
    const body = this.genMsgBody(template, xStateContext, xStateEvent, renderOptions)
    return this.anearEvent.publishEventParticipantsMessage(body, timeout)
  }

  renderEachParticipant(participants, template, xStateContext, xStateEvent, renderOptions) {
    // a message body generated distinctly for each participant and sent to their respective private channels
    const privateDisplayRequests = participants.map(
      participant => this.renderParticipant(participant, template, xStateContext, xStateEvent, renderOptions)
    )
    return Promise.all(privateDisplayRequests)
  }

  renderParticipant(participant, template, xStateContext, xStateEvent, renderOptions) {
    // a message body generated distinctly for the participant and sent to their private channel
    const timeout = this.getTimeout(renderOptions)

    const body = this.genMsgBody(template, xStateContext, xStateEvent, renderOptions, participant)
    return this.anearEvent.publishEventPrivateMessage(participant, body, timeout)
  }

  renderSpectators(template, xStateContext, xStateEvent, renderOptions) {
    // one message body sent to the spectators channel
    const body = this.genMsgBody(template, xStateContext, xStateEvent, renderOptions)
    return this.anearEvent.publishEventSpectatorsMessage(body)
  }

  genMsgBody(template, xStateContext, xStateEvent, renderOptions, participant = null) {
    const viewContext = this.genViewContext(participant, xStateContext, xStateEvent, renderOptions)
    const templateFunc = this.getTemplateFunc(template)
    return templateFunc(viewContext)
  }

  genViewContext(participant, xStateContext, xStateEvent, renderOptions) {
    const participantData = participant ? {participant} : null
    return {
      event: xStateEvent,
      context: xStateContext,
      attributes: this.anearEvent.attributes,
      ...participantData,
      options: {...renderOptions}
    }
  }

  getTimeout(renderOptions) {
    const timeout = renderOptions.timeout || 0
    delete renderOptions.timeout
    return timeout
  }

  getTemplateFunc(templatePath) {
    let func = this.templateFuncs.get(templatePath)
    if (!func) {
      func = this.compile(templatePath)
      this.templateFuncs.set(templatePath, func)
    }
    return func
  }

  compile(template) {
    // temptate - path to pug file  e.g. 'app/views/ParticipantBoard.pug'
    return pug.compileFile(template)
  }
}

module.exports = View
