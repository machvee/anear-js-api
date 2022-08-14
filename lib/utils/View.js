"use strict"
const pug = require("pug")

class View {
  initialize(anearEvent) {
    this.anearEvent = anearEvent
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
  async render(xStateContext, xStateEvent, renderings) {
    const asyncsArray = this.pubFunctions(xStateContext, xStateEvent, renderings)
    await Promise.all(asyncsArray)
  }

  genMsgBody(xStateContext, xStateEvent, renderOptions, participant = null) {
    const viewContext = this.genViewContext(xStateContext, xStateEvent, renderOptions, participant)
    const templateFunc = this.compile(renderOptions.template)
    return templateFunc(viewContext)
  }

  pubFunctions(xStateContext, xStateEvent, renderings) {
    return Object.entries(renderings).map((userType, renderOptions) => {
      let timeout = renderOptions.timeout || 0

      switch(userType) {
        case "participant":
          // use the explicit participant passed in, or defaqult to the participant
          // that triggered the xState event
          let participant = renderOptions.participant || xStateEvent.participant

          return this.anearEvent.publishEventPrivateMessage(
            participant,
            genMsgBody(xStateContext, xStateEvent, renderOptions, participant),
            timeout
          )
        case "participants":
          return this.anearEvent.publishEventParticipantsMessage(
            genMsgBody(xStateContext, xStateEvent, renderOptions),
            timeout
          )
        case "spectators":
          return this.anearEvent.publishEventSpectatorsMessage(
            genMsgBody(xStateContext, xStateEvent, renderOptions),
          )
        default:
          throw new Error(`invalid render userType '${userType}'`)
      }
    })
  }

  genViewContext(xStateContext, xStateEvent, renderOptions, participant = null) {
    const participantInfo = participant
    const optionViewData = renderOptions.options ? {options: renderOptions.options} : {}

    return {
      participant,
      event: xStateEvent,
      context: xStateContext,
      attributes: this.anearEvent.attributes,
      ...optionalViewData,
    }
  }

  compile(template) {
    // temptate - path to pug file  e.g. 'app/views/ParticipantBoard.pug'
    return pug.compileFile(template)
  }
}

module.exports = View
