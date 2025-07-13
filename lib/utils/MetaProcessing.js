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

    const appRenderContext = (displayType, timeoutFn = null) => (
      {
        app: appContext,
        meta: {
          state: appStateName,
          event: event.type,
          timeoutFn,
          viewer: displayType
        }
      }
    )

    const displayEvents = []

    let viewer
    let viewPath
    let timeoutFn
    let displayEvent

    if (meta.participants) {
      viewer = 'participants'
      viewPath = _getViewPath(meta.participants)
      timeoutFn = _buildTimeoutFn(viewer, meta.participants.timeout)

      displayEvent = {
        viewPath,
        appRenderContext: appRenderContext(viewer, timeoutFn)
      }
      displayEvents.push(displayEvent)
    }

    if (meta.participant) {
      viewer = 'participant'
      viewPath = _getViewPath(meta.participant)
      timeoutFn = _buildTimeoutFn(viewer, meta.participant.timeout)

      displayEvent = {
        viewPath,
        appRenderContext: appRenderContext(viewer, timeoutFn)
      }
      displayEvents.push(displayEvent)
    }

    if (meta.spectators) {
      viewer = 'spectators'
      viewPath = _getViewPath(meta.spectators)

      displayEvent = {
        viewPath,
        appRenderContext: appRenderContext(viewer)
      }
      displayEvents.push(displayEvent)
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

const _buildTimeoutFn = (viewer, timeout) => {
  // timeout can either be nnnnnn or (c, p) => { return msecs }, or (c) => { return msecs }
  // where c is the app's context
  if (!timeout) return null

  if (typeof timeout === 'number') {
    if (viewer == 'participants') return c => timeout
    return (c, participantId) => timeout
  }

  if (typeof timeout === 'function') {
    // invoked for each participant: timeoutConfig(appContext, participant.info.id)
    // -or- invoked for participants: timeoutConfig(appContext)
    return timeout
  }

  throw new Error(`Unknown timeout config: ${typeof timeoutConfig}`)
}

const _stringifiedState = (stateValue) => {
  if (typeof stateValue === 'string') return stateValue
  return Object.entries(stateValue).map(([k, v]) => `${k}.${_stringifiedState(v)}`).join('.')
}

module.exports = MetaProcessing
