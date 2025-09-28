"use strict"

const logger = require('./Logger')

/**
 * RenderContextBuilder:
 *  - Shared utility for constructing appRenderContext objects
 *  - Used by AppMachineTransition and anearEvent.render()
 *  - Ensures consistent structure across all rendering calls
 */
class RenderContextBuilder {
  /**
   * Build appRenderContext for rendering
   * @param {Object} appContext - The AppM's context object
   * @param {string} state - Current state name
   * @param {string} event - Event type that triggered render
   * @param {string} viewer - Display type (allParticipants, eachParticipant, spectators, host)
   * @param {Function|number|null} timeoutFn - Timeout function or value
   * @returns {Object} appRenderContext object
   */
  static buildAppRenderContext(appContext, state, event, viewer, timeoutFn = null) {
    return {
      app: appContext,
      meta: {
        state,
        event,
        timeoutFn,
        viewer
      }
    }
  }

  /**
   * Build timeout function for participant displays
   * @param {string} viewer - Display type
   * @param {Function|number} timeout - Timeout config
   * @returns {Function|null} Timeout function or null
   */
  static buildTimeoutFn(viewer, timeout) {
    if (!timeout) return null

    if (typeof timeout === 'number') {
      if (viewer === 'allParticipants') return c => timeout
      return (c, participantId) => timeout
    }

    if (typeof timeout === 'function') {
      // invoked for each eachParticipant: timeoutConfig(appContext, participant.info.id)
      // -or- invoked for allParticipants: timeoutConfig(appContext)
      return timeout
    }

    // Handle other timeout formats gracefully
    logger.warn(`[RenderContextBuilder] Unknown timeout config type: ${typeof timeout}`)
    return null
  }

  /**
   * Build display event object
   * @param {string} viewPath - Template/view path
   * @param {Object} appRenderContext - Context object
   * @param {string} viewer - Optional viewer type (host, participant, etc.)
   * @param {string} participantId - Optional participant ID for selective rendering
   * @param {number} timeout - Optional timeout in milliseconds
   * @param {Object} props - Optional arguments for the view
   * @returns {Object} Display event object
   */
  static buildDisplayEvent(viewPath, appRenderContext, viewer = null, participantId = null, timeout = null, props = {}) {
    const displayEvent = {
      viewPath,
      appRenderContext,
      props
    }

    if (viewer) {
      displayEvent.viewer = viewer
    }

    if (participantId) {
      displayEvent.participantId = participantId
    }

    if (timeout !== null) {
      displayEvent.timeout = timeout
    }

    return displayEvent
  }
}

module.exports = RenderContextBuilder
