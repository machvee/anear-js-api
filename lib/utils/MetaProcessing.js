"use strict"

const logger = require('./Logger')

/**
 * MetaProcessing:
 *  - Runs inside your appEventMachine onTransition.
 *  - Knows how to parse the XState meta shape (participants, participant, spectators).
 *  - Normalizes viewPath + timeout.
 *  - Emits displayEvents → sends to AnearEventMachine for rendering.
 */
const MetaProcessing = (anearEvent) => {
  return (appEventMachineState) => {
    const { meta: rawMeta, context: appContext, value, event } = appEventMachineState
    const [meta] = Object.values(rawMeta)

    if (!meta) return

    const appStateName = _stringifiedState(value)

    const appExecutionContext = {
      context: appContext,
      state: appStateName,
      event
    }

    const displayEvents = []

    if (meta.participants) {
      const viewPath = _getViewPath(meta.participants)
      const timeout = _buildTimeout(meta.participants.timeout, appExecutionContext)
      displayEvents.push({
        displayType: 'participants',
        viewPath,
        timeout,
        appExecutionContext
      })
    }

    if (meta.participant) {
      const viewPath = _getViewPath(meta.participant)
      const timeout = _buildTimeout(meta.participant.timeout, appExecutionContext)
      displayEvents.push({
        displayType: 'participant',
        viewPath,
        timeout,
        appExecutionContext
      })
    }

    if (meta.spectators) {
      const viewPath = _getViewPath(meta.spectators)
      displayEvents.push({
        displayType: 'spectators',
        viewPath,
        timeout: null,
        appExecutionContext
      })
    }

    if (displayEvents.length > 0) {
      logger.debug(`[MetaProcessing] sending RENDER_DISPLAY with ${displayEvents.length} displayEvents`)
      anearEvent.send('RENDER_DISPLAY', { displayEvents })
    }
  }
}

const _getViewPath = (config) => {
  if (!config) return null
  if (typeof config === 'string') return config
  if (typeof config === 'object') return config.view
  throw new Error(`Unknown meta format: ${JSON.stringify(config)}`)
}

const _buildTimeout = (timeoutConfig, appExecutionContext) => {
  if (!timeoutConfig) return null

  if (typeof timeoutConfig === 'function') {
    const [msecs, participantId] = timeoutConfig(appExecutionContext)
    return { msecs, participantId }
  }

  if (typeof timeoutConfig === 'number') {
    return { msecs: timeoutConfig }
  }

  throw new Error(`Unknown timeout config: ${typeof timeoutConfig}`)
}

const _stringifiedState = (stateValue) => {
  if (typeof stateValue === 'string') return stateValue
  return Object.entries(stateValue).map(([k, v]) => `${k}.${_stringifiedState(v)}`).join('.')
}

module.exports = MetaProcessing
