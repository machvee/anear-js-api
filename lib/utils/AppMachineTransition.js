"use strict"

const logger = require('./Logger')

/**
 * AppMachineTransition:
 *  - Runs inside your appEventMachine onTransition.
 *  - Detects when AppM reaches final state and sends APP_FINAL event.
 *  - Knows how to parse the XState meta shape (participants, participant, spectators).
 *  - Normalizes viewPath + timeout.
 *  - Display events are content-only.
 *  - Emits displayEvents → sends to AnearEventMachine for rendering.
 */
const AppMachineTransition = (anearEvent) => {
  return (appEventMachineState) => {
    // Handle potential XState version differences and missing properties
    const { meta: rawMeta, context: appContext, value, event } = appEventMachineState || {}
    
    // Handle unpredictable meta structure
    const metaObjects = rawMeta ? Object.values(rawMeta) : []
    
    // Check if AppM has reached a final state (handle different XState versions)
    const isDone = appEventMachineState?.done || appEventMachineState?.value === 'done'
    
    // Process meta FIRST (including exit displays) before sending APP_FINAL
    if (metaObjects.length > 0) {
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

      // Process all meta objects to handle unpredictable AppM structures
      metaObjects.forEach(meta => {
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
      })

      if (displayEvents.length > 0) {
        logger.debug(`[AppMachineTransition] sending RENDER_DISPLAY with ${displayEvents.length} displayEvents`)
        anearEvent.send('RENDER_DISPLAY', { displayEvents })
      }
    }
    
    // Send APP_FINAL AFTER processing meta (including exit displays)
    if (isDone) {
      logger.debug('[AppMachineTransition] AppM reached final state, sending APP_FINAL')
      anearEvent.send('APP_FINAL')
    }
  }
}

const _getViewPath = (config) => {
  if (!config) return null
  if (typeof config === 'string') return config
  if (typeof config === 'object') {
    // Handle various possible view path formats
    if (config.view) return config.view
    if (config.template) return config.template
    if (config.path) return config.path
    // If no view path found, log warning but don't throw
    logger.warn(`[AppMachineTransition] No view path found in config: ${JSON.stringify(config)}`)
    return null
  }
  logger.warn(`[AppMachineTransition] Unknown meta format: ${JSON.stringify(config)}`)
  return null
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

  // Handle other timeout formats gracefully
  logger.warn(`[AppMachineTransition] Unknown timeout config type: ${typeof timeout}`)
  return null
}

const _stringifiedState = (stateValue) => {
  if (typeof stateValue === 'string') return stateValue
  return Object.entries(stateValue).map(([k, v]) => `${k}.${_stringifiedState(v)}`).join('.')
}

module.exports = AppMachineTransition
