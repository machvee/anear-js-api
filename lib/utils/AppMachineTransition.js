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
        let timeoutFn
        let displayEvent

        // Validate that participants: and participant: are not both defined
        if (meta.allParticipants && meta.eachParticipant) {
          logger.error(`[AppMachineTransition] Invalid meta configuration: both 'allParticipants' and 'eachParticipant' are defined. Only one can be used per state.`)
          return // Skip processing this meta object
        }

        if (meta.allParticipants) {
          viewer = 'allParticipants'
          const { viewPath, props } = _extractViewAndProps(meta.allParticipants)
          timeoutFn = RenderContextBuilder.buildTimeoutFn(viewer, meta.allParticipants.timeout)

          displayEvent = RenderContextBuilder.buildDisplayEvent(
            viewPath,
            RenderContextBuilder.buildAppRenderContext(appContext, appStateName, event.type, viewer, timeoutFn),
            viewer,
            null,
            null,
            props
          )
          displayEvents.push(displayEvent)
        }

        if (meta.eachParticipant) {
          // Check if participant is a function (new selective rendering format)
          viewer = 'eachParticipant'
          if (typeof meta.eachParticipant === 'function') {
            // New selective participant rendering
            const participantRenderFunc = meta.eachParticipant
            const participantDisplays = participantRenderFunc(appContext, event)

            if (Array.isArray(participantDisplays)) {
              // Build the base render context once and reuse it for all participant displays
              // This avoids redundant context building when multiple participants receive different views
              const baseAppRenderContext = RenderContextBuilder.buildAppRenderContext(
                appContext,
                appStateName,
                event.type,
                viewer,
                null
              )

              participantDisplays.forEach(participantDisplay => {
                if (participantDisplay && participantDisplay.participantId && participantDisplay.view) {
                  // For selective rendering, timeout is handled directly in the participant display object
                  const timeout = participantDisplay.timeout || null
                  const props = participantDisplay.props || {}

                  displayEvent = RenderContextBuilder.buildDisplayEvent(
                    participantDisplay.view,
                    baseAppRenderContext, // Reuse the same base context
                    viewer,
                    participantDisplay.participantId,
                    timeout,
                    props
                  )
                  displayEvents.push(displayEvent)
                }
              })
            }
          } else {
            // Legacy participant rendering - normalize to selective format
            const { viewPath, props } = _extractViewAndProps(meta.eachParticipant)
            const timeoutFn = RenderContextBuilder.buildTimeoutFn('participant', meta.eachParticipant.timeout)

            const renderContext = RenderContextBuilder.buildAppRenderContext(appContext, appStateName, event.type, 'eachParticipant', timeoutFn),
            displayEvent = RenderContextBuilder.buildDisplayEvent(
              viewPath,
              renderContext,
              viewer,
              'ALL_PARTICIPANTS', // Special marker for "all participants"
              null,
              props
            )
            displayEvents.push(displayEvent)
          }
        }

        if (meta.host) {
          viewer = 'host'
          const { viewPath, props } = _extractViewAndProps(meta.host)
          timeoutFn = RenderContextBuilder.buildTimeoutFn(viewer, meta.host.timeout)

          displayEvent = RenderContextBuilder.buildDisplayEvent(
            viewPath,
            RenderContextBuilder.buildAppRenderContext(appContext, appStateName, event.type, viewer, timeoutFn),
            viewer,
            null,
            null,
            props
          )
          displayEvents.push(displayEvent)
        }

        if (meta.spectators) {
          viewer = 'spectators'
          const { viewPath, props } = _extractViewAndProps(meta.spectators)

          displayEvent = RenderContextBuilder.buildDisplayEvent(
            viewPath,
            RenderContextBuilder.buildAppRenderContext(appContext, appStateName, event.type, viewer),
            viewer,
            null,
            null,
            props
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

const _extractViewAndProps = (config) => {
  if (!config) return { viewPath: null, props: {} }

  if (typeof config === 'string') {
    return { viewPath: config, props: {} }
  }

  if (typeof config === 'object') {
    const viewPath = config.view
    const props = config.props || {}
    return { viewPath, props }
  }

  logger.warn(`[AppMachineTransition] Unknown meta format: ${JSON.stringify(config)}`)
  return { viewPath: null, props: {} }
}

const _stringifiedState = (stateValue) => {
  if (typeof stateValue === 'string') return stateValue
  return Object.entries(stateValue).map(([k, v]) => `${k}.${_stringifiedState(v)}`).join('.')
}

module.exports = AppMachineTransition
