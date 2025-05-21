"use strict"

const logger = require('./Logger')

// Helper functions for processing meta configurations
const buildTimeout = (timeoutType, timeoutConfig, appExecutionContext) => {
  let msecs = null
  let participantId = null

  switch (typeof timeoutConfig) {
    case 'function':
      [msecs, participantId] = timeoutConfig(appExecutionContext)
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

const metaConfig = (meta, timeoutType, appExecutionContext) => {
  let timeout = {msecs: 0}
  let view = null

  switch (typeof meta) {
    case 'string':
      view = meta
      break
    case 'object':
      view = meta.view
      if (meta.timeout) {
        timeout = buildTimeout(timeoutType, meta.timeout, appExecutionContext)
      }

      break
    default:
      throw new Error(`unknown ${timeoutType} meta format ${meta}`)
  }
  return [view, timeout]
}

const participantsMetaConfig = (participantsMeta, appExecutionContext) => {
  return metaConfig(participantsMeta, 'participants', appExecutionContext)
}

const participantMetaConfig = (participantMeta, appExecutionContext) => {
  return metaConfig(participantMeta, 'participant', appExecutionContext)
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

const MetaProcessing = anearEvent => {
  return appEventMachineState => {
    const { context: appContext, meta: rawMeta } = appEventMachineState
    const appStateName = Stringified(appEventMachineState.value)
    const displayEvents = []

    //logger.debug("MetaProcessing invoked on transition to: ", appStateName)
    //logger.debug("stateMeta: ", appEventMachineState.meta)

    if (Object.keys(appEventMachineState.meta).length === 0) {
      return
    }

    logger.debug("App Context: ", appContext)

    const sendDisplayMessage = () => {
      logger.debug(`${appStateName} 'RENDER_DISPLAY' to ${anearEvent.id} with ${displayEvents.length} msgs`)

      // sends a RENDER_DISPLAY event with one or more viewPaths and appExecutionContext in the displayEvents array
      anearEvent.send('RENDER_DISPLAY', { displayEvents })
    }

    const appendDisplayEvent = (displayType, viewPath, timeout = null) => {
      displayEvents.push(
        {
          displayType,
          viewPath,
          timeout,
          appExecutionContext
        }
      )
    }

    const appExecutionContext = {
      context: appContext,
      state: appStateName,
      event: appEventMachineState.event
    }

    const [meta] = Object.values(appEventMachineState.meta)

    logger.debug("meta: ", meta)

    // Only proceed if there's at least one display meta defined.
    if (!meta.participants && !meta.participant && !meta.spectators) return

    if (meta.participants) {
      const [viewPath, timeout] = participantsMetaConfig(meta.participants, appExecutionContext)
      appendDisplayEvent('participants', viewPath, timeout)
    }

    if (meta.participant) {
      const [viewPath, timeout] = participantMetaConfig(meta.participant, appExecutionContext)
      appendDisplayEvent('participant', viewPath, timeout)
    }

    if (meta.spectators) {
      const viewPath = spectatorMetaConfig(meta.spectators)
      appendDisplayEvent('spectators', viewPath)
    }

    sendDisplayMessage()
  }
}

module.exports = MetaProcessing
