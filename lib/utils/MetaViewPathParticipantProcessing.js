"use strict"

const constants = require('../utils/Constants')

const MetaViewPathParticipantProcessing = appParticipantMachineState => {
  const { context: appParticipantContext, meta, event: xStateEvent } = appParticipantMachineState

  // meta.view - a potentially customized message sent to each active participant
  // meta.timeout - in milliseconds.  Individual timer set for each participant.   Each participant must respond

  if (!meta.view) return

  const anearParticipantMachine = appParticipantContext.anearParticipant.anearParticipantMachine
  const anearParticipantMachineContext = anearParticipantMachine.state.context
  const anearEventMachine = appParticipantContext.anearParticipant.anearEvent.anearEventMachine
  const anearEventMachineContext = anearEventMachine.state.context
  const appEventContext = anearEventMachineContext.appEventMachine.state.context
  const compiledTemplates = anearEventMachineContext.pugTemplates
  const anearEvent = anearEventMachineContext.anearEvent

  const templateExecutionContext = {
    anearEvent,
    anearParticipant,
    appEventContext,
    appParticipantContext,
    stateMetadata: meta,
    currentState: appParticipantMachineState.value,
    event: xStateEvent
  }

  const commonTemplateExecutionContext = {
    eventMetadata: anearEvent,
    participantMetadata: anearParticipant,
    currentState: appEventMachineState.value,
    stateMetadata: meta,
    appContext: appEventContext,
    event: xStateEvent
  }

  const timeout = meta.timeout ? { type: 'participant', msecs: meta.timeout } : null

  const formattedDisplayContent = renderedTemplate => ({
    content: renderedTemplate,
    timeout
  })

  const compiledTemplate = compiledTemplates[meta.view]
  const privateParticipantDisplayMessage = compiledTemplate(templateExecutionContext)

  anearParticipantMachine.send(constants.PrivateDisplayEventName, formattedDisplayContent(privateParticipantDisplayMessage))
}

module.exports = MetaViewPathParticipantProcessing
