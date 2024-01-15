"use strict"

const ParticipantsDisplayEventName = 'PARTICIPANTS_DISPLAY'
const PrivateDisplayEventName = 'PRIVATE_DISPLAY'
const SpectatorsDisplayEventName = 'SPECTATORS_DISPLAY'
const PublicDisplayEventName = 'PUBLIC_DISPLAY'
const ActiveStateName = 'active'

const MetaViewPathProcessing = eventAppMachineState => {
  const { context: eventAppContext, meta } = eventAppMachineState

  // meta.viewPath.
  //   allParticipants - one message sent to all active particpants
  //   privateParticipant - a potentially customized message sent to each active participant
  //   spectators - one message sent to all spectators
  //   public - one message sent to the on-premise public display

  if (!meta.viewPath) return

  const xStateEvent = eventAppContext._event
  const anearEventMachine = eventAppContext.anearEvent.anearEventMachine
  const anearEventMachineContext = anearEventMachine.state.context
  const compiledTemplates = anearEventMachineContext.pugTemplates
  const commonTemplateExecutionContext = {
    currentState: eventAppMachineState.value,
    context: eventAppContext,
    event: xStateEvent
  }

  if (meta.viewPath.allParticipants) {
    const allParticipantsDisplayMessage = compiledTemplates[meta.viewPath.allParticipants](commonTemplateExecutionContext)
    anearEventMachine.send(ParticipantsDisplayEventName, {displayMessage: allParticipantsDisplayMessage})
  }

  if (meta.viewPath.privateParticipant) {
    const compiledTemplate = compiledTemplates[meta.viewPath.privateParticipant]
    const { participantMachines } = anearEventMachineContext

    for (const participantMachine in participantMachines) {
      const participantState = participantMachine.state
      if (participantState.matches(ActiveStateName)) {
        const participantContext = participantState.context;
        const privateTemplateExecutionContext = {
          anearParticipant: participantContext.anearParticipant,
          participantContext,
          ...commonTemplateExecutionContext
        }
        let privateParticipantDisplayMessage = compiledTemplate(privateTemplateExecutionContext)
        participantMachine.send(PrivateDisplayEventName, {displayMessage: privateParticipantDisplayMessage})
      }
    }
  }

  if (meta.viewPath.spectators) {
    const spectatorsDislpayMessage = compiledTemplates[meta.viewPath.spectators](commonTemplateExecutionContext)
    anearEventMachine.send(SpectatorsDisplayEventName, { displayMessage: spectatorsDisplayMessage })
  }

  if (meta.viewPath.public) {
    const publicDisplayMessage = compiledTemplates[meta.viewPath.public](commonTemplateExecutionContext)
    anearEventMachine.send(PublicDisplayEventName, {displayMessage: publicDisplayMessage})
  }
}

module.exports = MetaViewPathProcessing
