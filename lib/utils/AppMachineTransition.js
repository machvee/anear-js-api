"use strict"

const logger = require('./Logger')
const RenderContextBuilder = require('./RenderContextBuilder')

/**
 * AppMachineTransition:
 *  - Runs inside your appEventMachine onTransition.
 *  - Detects when AppM reaches final state and sends CLOSE event.
 *  - Knows how to parse the XState meta shape (participants, participant, spectators).
 *  - Normalizes viewPath + timeout.
 *  - Display events are content-only.
 *  - Emits displayEvents → sends to AnearEventMachine for rendering.
 */
const AppMachineTransition = (anearEvent) => {
  return (appEventMachineState) => {
    // Handle potential XState version differences and missing properties
    const { meta: rawMeta, context: appContext, value, event } = appEventMachineState || {}
    const stateName = _stringifiedState(value)
    const hasMeta = rawMeta && Object.keys(rawMeta).length > 0;

    logger.debug(`[AppMachineTransition] onTransition to state '${stateName}'. Meta detected: ${hasMeta}`)

    // Handle unpredictable meta structure
    const metaObjects = rawMeta ? Object.values(rawMeta) : []
    
    // Check if AppM has reached a final state (handle different XState versions)
    const isDone = appEventMachineState?.done || appEventMachineState?.value === 'done'
    
    // Process meta FIRST (including exit displays) before sending CLOSE.
    // Do not re-process meta on the RENDERED event from AEM to avoid an infinite loop.
    if (event.type !== 'RENDERED' && metaObjects.length > 0) {
      const appStateName = _stringifiedState(value)
      
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
          timeoutFn = RenderContextBuilder.buildTimeoutFn(viewer, meta.participants.timeout)

          displayEvent = RenderContextBuilder.buildDisplayEvent(
            viewPath,
            RenderContextBuilder.buildAppRenderContext(appContext, appStateName, event.type, viewer, timeoutFn)
          )
          displayEvents.push(displayEvent)
        }

        if (meta.participant) {
          viewer = 'participant'
          viewPath = _getViewPath(meta.participant)
          timeoutFn = RenderContextBuilder.buildTimeoutFn(viewer, meta.participant.timeout)

          displayEvent = RenderContextBuilder.buildDisplayEvent(
            viewPath,
            RenderContextBuilder.buildAppRenderContext(appContext, appStateName, event.type, viewer, timeoutFn)
          )
          displayEvents.push(displayEvent)
        }

        if (meta.spectators) {
          viewer = 'spectators'
          viewPath = _getViewPath(meta.spectators)

          displayEvent = RenderContextBuilder.buildDisplayEvent(
            viewPath,
            RenderContextBuilder.buildAppRenderContext(appContext, appStateName, event.type, viewer)
          )
          displayEvents.push(displayEvent)
        }
      })

      if (displayEvents.length > 0) {
        logger.debug(`[AppMachineTransition] sending RENDER_DISPLAY with ${displayEvents.length} displayEvents`)
        anearEvent.send('RENDER_DISPLAY', { displayEvents })
      }
    }
    
    // Send CLOSE AFTER processing meta (including exit displays)
    if (isDone) {
      logger.debug('[AppMachineTransition] AppM reached final state, sending CLOSE')
      anearEvent.send('CLOSE')
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

const _stringifiedState = (stateValue) => {
  if (typeof stateValue === 'string') return stateValue
  return Object.entries(stateValue).map(([k, v]) => `${k}.${_stringifiedState(v)}`).join('.')
}

module.exports = AppMachineTransition
