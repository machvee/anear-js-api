"use strict"

const constants = require('../utils/Constants')

const buildTimeout = (timeoutType, timeoutConfig, executionContext) => {
  //
  // The provided timeoutConfig can be a function that returns an array
  // containing the msecs for the timeout, and the participantId to set the timeout for
  //
  // --or-- it can be a number of msecs
  //
  // meta: {
  //   participants: {
  //     timeout: (executionContext) => return calcMsecs(context, event)
  //   -or-
  //     timeout: 32000
  //   },
  //   participant: {
  //     timeout: (executionContext) => [participantId, msecs]
  //   }
  // }
  let timeout = null
  let msecs = null
  let participantId = null

  switch(typeof timeoutConfig) {
    case 'function':
      [msecs, participantId] = timeoutConfig(executionContext)
      break
    case 'number':
      msecs = timeoutConfig
      break
    default:
      throw new Error(`unknown timeout config ${typeof timeoutConfig}`)
  }

  switch(timeoutType) {
    case 'participant':
      return { type: timeoutType, msecs, participantId }
      break
    case 'participants':
      return { type: timeoutType, msecs }
      break
    default:
      throw new Error(`unknown timeout type ${timeoutType}`)
  }
}

const metaConfig = (meta, timeoutType, executionContext) => {
  //  meta =>
  //    participant[s]: 'view path' | {
  //      view: 'view path',
  //      timeout: number | (c) => { return [msecs[, participantId]] } // id of participant on whom to set timeout
  //    }
  let timeout = null
  let view = null

  switch(typeof meta) {
    case 'string':
      view = meta
      break
    case 'object':
      view = meta.view
      if (meta.timeout) {
        timeout = buildTimeout(timeoutType, meta.timeout, executionContext)
      }
      break
    default:
      throw new Error(`unknown ${timeoutType} meta format ${meta}`)
  }
  return [view, timeout]
}

const participantsMetaConfig = (participantsMeta, executionContext) => {
  // participantsMeta:
  //    'path' | {
  //      view: 'path',
  //      timeout: (c, e) => { return msecs } // all participants must respond before else be timed out
  //    },
  return metaConfig(participantsMeta, 'participants', executionContext)
}

const participantMetaConfig = (participantMeta, executionContext) => {
  // participantsMeta:
  //    'path' | {
  //      view: 'path',
  //      timeout: (c, e) => { return participantId, msecs } // only participantId timed out
  //    },
  return metaConfig(participantMeta, 'participant', executionContext)
}

const spectatorMetaConfig = config => {
  if (typeof config === 'string')
    return config
  else if (typeof config === 'object') {
    return config.view
  }
}

const Stringified = (stateValue) => {
  switch(typeof stateValue) {
    case 'string':
      return stateValue
      break
    case 'object':
      return Object.entries(stateValue)
        .map(([key, nested]) => `${key}.${Stringified(nested)}`)
        .join('.')
      break
    default:
      throw new Error(`unknown Xstate state value type ${typeof stateValue}`)
  }
}

const MetaViewPathEventProcessing = appEventMachineState => {
  //
  //  meta: {
  //    participant: 'path' | {
  //      view: 'path',
  //      timeout: (c, e) => { return participantId, msecs } // its this participant's turn
  //    },
  //    participants: 'path' | {
  //      view: 'path',
  //      timeout: (c, e) => { return msecs } // all participants must respond before else be timed out
  //    },
  //    spectators: 'path' | {
  //      view: 'path'
  //    }
  //  }
  const { context: appEventContext, meta } = appEventMachineState

  if (!meta) return
  if (!meta.participants && !meta.participant && !meta.spectators) return

  const xStateEvent = appEventMachineState.event
  const anearEventMachine = appEventContext.anearEvent.anearEventMachine
  const anearEventMachineContext = anearEventMachine.state.context
  const compiledTemplates = anearEventMachineContext.pugTemplates
  const anearEvent = anearEventMachineContext.anearEvent

  const commonTemplateExecutionContext = {
    // This is the context available for reference directly
    // from within .pug templates.  Developers can reference
    // the AppEventMachine Xstate context like "context.board" or "context.players[1].name"
    context: appEventContext,
    event: xStateEvent,
    state: Stringified(appEventMachineState.value), // state name e.g. "live.in_progress.waiting_for_opponent"
    meta,
    anearEvent
  }

  const findTemplate = (templateDefinition) => {
    if (typeof templateDefinition === "string") {
      // Ensure the template path ends with ".pug"
      const normalizedPath = templateDefinition.endsWith(C.PugSuffix)
        ? templateDefinition
        : `${templateDefinition}${C.PugSuffix}`

      // Retrieve the compiled template
      const template = compiledTemplates[normalizedPath]
      if (!template) {
        throw new Error(`Template not found for path "${normalizedPath}".`)
      }
      return template
    } else {
      throw new Error(`Invalid template definition: ${templateDefinition}`)
    }
  }

  const formattedDisplayContent = (renderedTemplate, timeout) => {
    const displayContent = {
      content: renderedTemplate
    }

    if (timeout) {
      displayContent['timeout'] = timeout
    }
    return displayContent
  }

  const processParticipantsDisplay = (meta, anearEventMachine) => {
    // Sends display message simultaneously to ALL participants via the
    // participants channel
    //
    const [viewPath, timeout] = participantsMetaConfig(meta.participants, commonTemplateExecutionContext)
    const compiledTemplate = findTemplate(viewPath)
    const renderedMessage = compiledTemplate(commonTemplateExecutionContext)

    anearEventMachine.send(
      constants.ParticipantsDisplayEventName,
      formattedDisplayContent(renderedMessage, timeout)
    )
  }

  const processParticipantDisplay = (meta, anearEventMachine) => {
    // Sends a custom display message to all ACTIVE participants
    //
    const [viewPath, timeout] = participantMetaConfig(meta.participant, commonTemplateExecutionContext)
    const compiledTemplate = findTemplate(viewPath)
    const { participantMachines } = commonTemplateExecutionContext.anearEventMachine.state.context

    Object.values(participantMachines).forEach((machine) => {
      const participantState = machine.state
      if (participantState.matches(constants.ActiveStateName)) {
        const participantContext = participantState.context
        const privateContext = {
          anearParticipant: participantContext.anearParticipant,
          participantContext,
          ...commonTemplateExecutionContext,
        }
        const renderedMessage = compiledTemplate(privateContext)

        machine.send(
          constants.PrivateDisplayEventName,
          formattedDisplayContent(renderedMessage, timeout)
        )
      }
    })
  }

  const processSpectatorsDisplay = (meta, anearEventMachine) => {
    // Sends a display message simultaneously to all spectators
    //
    const spectatorViewPath = spectatorMetaConfig(meta.spectators)
    const viewTemplate = findTemplate(spectatorViewPath)
    const spectatorsDisplayMessage = viewTemplate(commonTemplateExecutionContext)

    anearEventMachine.send(
      constants.SpectatorsDisplayEventName,
      formattedDisplayContent(spectatorsDisplayMessage)
    )
  }

  if (meta.participants) processParticipantsDisplay(meta, anearEventMachine)
  if (meta.participant) processParticipantDisplay(meta, anearEventMachine)
  if (meta.spectators) processSpectatorsDisplay(meta, anearEventMachine)
}

module.exports = MetaViewPathEventProcessing
