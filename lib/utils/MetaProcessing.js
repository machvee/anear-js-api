"use strict"

const C = require('../utils/Constants')
const logger = require('./Logger')

// Helper functions for processing meta configurations
const buildTimeout = (timeoutType, timeoutConfig, executionContext) => {
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
  else if (typeof config === 'object')
    return config.view
  else
    throw new Error(`unknown spectator meta format ${config}`)
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
 * MetaProcessing is now a higher-order function that takes the anearEvent (which includes the parent's anearEventMachine)
 * and returns a function that processes the current appEventMachine state. It computes the view path and optional timeout
 * using the metaConfig helpers and sends a RENDER_DISPLAY event to the anearEventMachine.
 */
const MetaProcessing = anearEvent => {
  return appEventMachineState => {
    const { context: appEventContext, meta: rawMeta } = appEventMachineState
    const appStateName = Stringified(appEventMachineState.value)
    const fullyQualifiedStateName = `${appEventMachineState.machine.id}.${appStateName}`
    const meta = rawMeta[fullyQualifiedStateName]

    if (!meta) return

    logger.debug(`Meta for ${fullyQualifiedStateName}:`, meta)
    logger.debug("App Context:", appEventContext)

    // Only proceed if there's at least one display meta defined.
    if (!meta.participants && !meta.participant && !meta.spectators) return

    // Build a common execution context for meta functions.
    const executionContext = {
      context: appEventContext,
      state: appStateName,
      event: appEventMachineState.event,
      meta
    }

    const sendDisplayMessage = (displayType, viewPath, timeout = null ) => {
      logger.debug(`sending ${C.RenderDisplayEventName} to ${anearEvent.anearEventMachine.id} with displayType ${displayType}`)
      anearEvent.anearEventMachine.send(
        C.RenderDisplayEventName, {
        displayType,
        viewPath,
        timeout,
        executionContext
      })
    }

    if (meta.participants) {
      const [viewPath, timeout] = participantsMetaConfig(meta.participants, executionContext)
      sendDisplayMessage('participants', viewPath, timeout)
    }

    if (meta.participant) {
      const [viewPath, timeout] = participantMetaConfig(meta.participant, executionContext)
      sendDisplayMessage('participant', viewPath, timeout)
    }

    if (meta.spectators) {
      const viewPath = spectatorMetaConfig(meta.spectators)
      sendDisplayMessage('spectators', viewPath)
    }
  }
}

module.exports = MetaProcessing
