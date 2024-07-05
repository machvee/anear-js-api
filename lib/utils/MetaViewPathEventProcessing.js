"use strict"

const constants = require('../utils/Constants')

const MetaViewPathEventProcessing = appEventMachineState => {
  const { context: appEventContext, meta } = appEventMachineState

  // meta.view
  //   allParticipants - one message sent to all active particpants
  //   privateParticipant - a potentially customized message sent to each active participant
  //   spectators - one message sent to all spectators
  //   public - one message sent to the on-premise public display
  // meta.eventTimeout - in milliseconds. A single timer set for all participants.   First participant to send ACTION stops timer
  // meta.participantTimeout - in milliseconds.  Individual timer set for each participant.   Each participant must respond

  const view = meta.view

  if (!view) return

  const xStateEvent = appEventMachineState.event
  const anearEventMachine = appEventContext.anearEvent.anearEventMachine
  const anearEventMachineContext = anearEventMachine.state.context
  const compiledTemplates = anearEventMachineContext.pugTemplates
  const anearEvent = anearEventMachineContext.anearEvent

  const commonTemplateExecutionContext = {
    anearEvent,
    stateMetadata: meta,
    appEventContext,
    currentState: appEventMachineState.value,
    event: xStateEvent
  }

  const timeout = meta.eventTimeout
    ? { type: 'event', msecs: meta.eventTimeout }
    : meta.participantTimeout
    ? { type: 'participant', msecs: meta.participantTimeout }
    : null

  const formattedDisplayContent = renderedTemplate => ({
    content: renderedTemplate,
    timeout
  })

  if (view.allParticipants) {
    // all participants common view.  One publish to participants channel ... all participants receive same view
    const allParticipantsDisplayMessage = compiledTemplates[view.allParticipants](commonTemplateExecutionContext)

    anearEventMachine.send(constants.ParticipantsDisplayEventName, formattedDisplayContent(allParticipantsDisplayMessage))
  }

  if (view.privateParticipant) {
    // private participants view ... iterate over active participants ... send distinct view to each
    const compiledTemplate = compiledTemplates[view.privateParticipant]
    const { participantMachines } = anearEventMachineContext

    for (const participantMachine in participantMachines) {
      const participantState = participantMachine.state
      if (participantState.matches(constants.ActiveStateName)) {
        const participantContext = participantState.context;

        const privateTemplateExecutionContext = {
          anearParticipant: participantContext.anearParticipant,
          appParticipantContext,
          ...commonTemplateExecutionContext
        }

        let privateParticipantDisplayMessage = compiledTemplate(privateTemplateExecutionContext)

        participantMachine.send(constants.PrivateDisplayEventName, formattedDisplayContent(privateParticipantDisplayMessage))
      }
    }
  }

  if (view.spectators) {
    // registered spectators of the event (non-participants)
    const spectatorsDislpayMessage = compiledTemplates[view.spectators](commonTemplateExecutionContext)

    anearEventMachine.send(constants.SpectatorsDisplayEventName, formattedDisplayContent(spectatorsDisplayMessage))
  }

  if (view.public) {
    // in merchant TV display
    const publicDisplayMessage = compiledTemplates[view.public](commonTemplateExecutionContext)

    anearEventMachine.send(constants.PublicDisplayEventName, formattedDisplayContent(publicDisplayMessage))
  }
}

module.exports = MetaViewPathEventProcessing
