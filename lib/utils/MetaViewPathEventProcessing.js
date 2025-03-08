"use strict"

const C = require('../utils/Constants')
const logger = require('./Logger')

const buildTimeout = (timeoutType, timeoutConfig, executionContext) => {
  let timeout = null
  let msecs = null
  let participantId = null

  switch (typeof timeoutConfig) {
    case 'function':
      [msecs, participantId] = timeoutConfig(executionContext)
      break
    case 'number':
      msecs = timeoutConfig
      break
    default:
      throw new Error(`unknown timeout config ${typeof timeoutConfig}`)
  }

  switch (timeoutType) {
    case 'participant':
      return { type: timeoutType, msecs, participantId }
    case 'participants':
      return { type: timeoutType, msecs }
    default:
      throw new Error(`unknown timeout type ${timeoutType}`)
  }
}

const metaConfig = (meta, timeoutType, executionContext) => {
  let timeout = null
  let view = null

  switch (typeof meta) {
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
  return metaConfig(participantsMeta, 'participants', executionContext)
}

const participantMetaConfig = (participantMeta, executionContext) => {
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
  switch (typeof stateValue) {
    case 'string':
      return stateValue
    case 'object':
      return Object.entries(stateValue)
        .map(([key, nested]) => `${key}.${Stringified(nested)}`)
        .join('.')
    default:
      throw new Error(`unknown Xstate state value type ${typeof stateValue}`)
  }
}

/**
 * MetaViewPathEventProcessing is now a higher-order function that takes anearEvent
 * and returns a function that processes the appEventMachineState.
 */
const MetaViewPathEventProcessing = anearEvent => {
  return appEventMachineState => {
    // Extract raw meta and determine the fully qualified state name.
    const { context: appEventContext, meta: rawMeta } = appEventMachineState
    const appStateName = Stringified(appEventMachineState.value)
    const fullyQualifiedStateName = `${appEventMachineState.machine.id}.${appStateName}`
    const meta = rawMeta[fullyQualifiedStateName]

    if (!meta) return

    logger.debug(`current State Meta for ${fullyQualifiedStateName}: `, meta)
    logger.debug("App Context: ", appEventContext)

    if (!meta.participants && !meta.participant && !meta.spectators) return

    const xStateEvent = appEventMachineState.event
    const anearEventMachine = anearEvent.anearEventMachine
    const compiledTemplates = anearEventMachineContext.pugTemplates

    // Here, instead of pulling anearEvent from the machine context,
    // we use the injected anearEvent from the outer function.
    const commonTemplateExecutionContext = {
      context: appEventContext,
      event: xStateEvent,
      state: appStateName,
      meta,
      anearEvent
    }

    const findTemplate = (templateDefinition) => {
      if (typeof templateDefinition === "string") {
        const normalizedPath = templateDefinition.endsWith(C.PugSuffix)
          ? templateDefinition
          : `${templateDefinition}${C.PugSuffix}`

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
      const displayContent = { content: renderedTemplate }
      if (timeout) {
        displayContent['timeout'] = timeout
      }
      return displayContent
    }

    const processParticipantsDisplay = (meta, anearEventMachine) => {
      const [viewPath, timeout] = participantsMetaConfig(meta.participants, commonTemplateExecutionContext)
      const compiledTemplate = findTemplate(viewPath)
      const renderedMessage = compiledTemplate(commonTemplateExecutionContext)

      anearEventMachine.send(
        C.ParticipantsDisplayEventName,
        formattedDisplayContent(renderedMessage, timeout)
      )
    }

    const processParticipantDisplay = (meta, anearEventMachine) => {
      const [viewPath, timeout] = participantMetaConfig(meta.participant, commonTemplateExecutionContext)
      const compiledTemplate = findTemplate(viewPath)
      const { anearParticipantMachines } = anearEventMachine.state.context

      logger.debug("anearParticipantMachines: ", anearParticipantMachines)

      Object.values(anearParticipantMachines).forEach((machine) => {
        const participantState = machine.state

        if (Stringified(participantState.value).matches(C.ActiveStateName)) {
          const participantContext = participantState.context
          const privateContext = {
            anearParticipant: participantContext.anearParticipant,
            participantContext,
            ...commonTemplateExecutionContext,
          }
          const renderedMessage = compiledTemplate(privateContext)

          logger.debug("rendered Message: ", renderedMessage)

          machine.send(
            C.PrivateDisplayEventName,
            formattedDisplayContent(renderedMessage, timeout)
          )
        }
      })
    }

    const processSpectatorsDisplay = (meta, anearEventMachine) => {
      const spectatorViewPath = spectatorMetaConfig(meta.spectators)
      const viewTemplate = findTemplate(spectatorViewPath)
      const spectatorsDisplayMessage = viewTemplate(commonTemplateExecutionContext)

      anearEventMachine.send(
        C.SpectatorsDisplayEventName,
        formattedDisplayContent(spectatorsDisplayMessage)
      )
    }

    if (meta.participants) processParticipantsDisplay(meta, anearEventMachine)
    if (meta.participant) processParticipantDisplay(meta, anearEventMachine)
    if (meta.spectators) processSpectatorsDisplay(meta, anearEventMachine)
  }
}

module.exports = MetaViewPathEventProcessing
