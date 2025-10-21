"use strict"
/**
 * --------------------------------------------------------------------------
 * Pug templates receive the following context at render:
 *
 * {
 *   app: application XState context
 *   meta: {
 *     viewer:  // 'eachParticipant', 'allParticipants', 'spectators'
 *     state:   // Stringified state name (e.g., 'live.registration.waitForOpponentToJoin')
 *     event:   // The triggering event for this transition ('PARTIPANT_ENTER')
 *     timeout: // null|| func}
 *   }
 *   props: {
 *     // All properties from the `props` object in the AppM's meta block.
 *     // e.g., meta: { view: 'foo', props: { title: 'Hello' } } -> `props.title`
 *   }
 *
 *   // When 'eachParticipant' displayType
 *   allParticipants: // all: Map of all participants [info, context] for this event,  get(id) => info, context
 *   eachParticipant:  // info, context
 *
 *   // PLUS all helpers from PugHelpers:
 *   cdnImg(filename)  // Resolves CDN image path
 *   action(payload)   // JSON-encodes click action payloads for data attributes
 * }
 *
 * Example usage in Pug:
 *
 *   img(src=cdnImg('logo.png'))
 *   .sq(data-anear-click=action({MOVE: {x, y}}))
 *   each participant in Object.values(participants)
 *     li= participant.name
 *
 * --------------------------------------------------------------------------
 */

const logger = require('./Logger')
const RealtimeMessaging = require('./RealtimeMessaging')
const C = require('./Constants')

class DisplayEventProcessor {
  constructor(anearEventMachineContext) {
    this.anearEvent = anearEventMachineContext.anearEvent
    this.pugTemplates = anearEventMachineContext.pugTemplates
    this.pugHelpers = anearEventMachineContext.pugHelpers
    this.participantMachines = anearEventMachineContext.participantMachines
    this.participantsDisplayChannel = anearEventMachineContext.participantsDisplayChannel
    this.spectatorsDisplayChannel = anearEventMachineContext.spectatorsDisplayChannel
    this.participants = anearEventMachineContext.participants
    this.participantsIndex = this._buildParticipantsIndex(anearEventMachineContext.participants)
  }

  processAndPublish(displayEvents) {
    let participantsTimeout = null

    const publishPromises = displayEvents.map(event => {
      const { publishPromise, timeout } = this._processSingle(event)
      if (timeout) {
        participantsTimeout = timeout
      }
      return publishPromise
    })

    return Promise.all(publishPromises).then(() => {
      return { participantsTimeout }
    })
  }

  _buildParticipantsIndex(participants) {
    const participantStructs = Object.fromEntries(
      Object.entries(participants).map(([id, info]) => [ id, { info, context: null } ])
    )
    // Filter out the host from participants.all for display purposes
    // The host should not appear in participant lists or receive participant displays
    const all = Object.values(participantStructs).filter(participantStruct =>
      !participantStruct.info.isHost
    )

    return { all, get: id => participantStructs[id] }
  }

  _processSingle(displayEvent) {
    const { viewPath, appRenderContext, viewer, participantId, timeout: displayTimeout, props } = displayEvent
    const timeoutFn = appRenderContext.meta.timeoutFn

    const normalizedPath = viewPath.endsWith(C.PugSuffix) ? viewPath : `${viewPath}${C.PugSuffix}`
    const template = this.pugTemplates[normalizedPath]
    let publishPromise
    let timeout = null

    if (!template) {
      throw new Error(`Template not found: ${normalizedPath}`)
    }

    const templateRenderContext = {
      ...appRenderContext,
      anearEvent: this.anearEvent,
      participants: this.participantsIndex,
      ...this.pugHelpers,
      props
    }

    const formattedDisplayMessage = () => {
      const displayMessage = {
        content: template(templateRenderContext),
      }

      return displayMessage
    }

    // The viewer determines who sees the view. It can be set directly on the
    // display event, but if not, it falls back to the viewer from the meta block.
    const displayViewer = viewer || appRenderContext.meta.viewer

    switch (displayViewer) {
      case 'allParticipants':
        logger.debug(`[DisplayEventProcessor] Publishing ${viewPath} to PARTICIPANTS_DISPLAY`)

        // Use display timeout if available, otherwise fall back to timeoutFn
        if (displayTimeout !== null && displayTimeout > 0) {
          timeout = { msecs: displayTimeout }
        } else if (timeoutFn) {
          const msecs = timeoutFn(appRenderContext.app)
          if (typeof msecs === 'number' && msecs > 0) {
            timeout = { msecs }
          }
        }

        // Expose timeout to template context for countdown bars
        if (timeout) {
          templateRenderContext.meta = {
            ...templateRenderContext.meta,
            timeout
          }
          logger.debug(`[DisplayEventProcessor] allParticipants timeout resolved to ${timeout.msecs}ms`)
        } else {
          logger.debug(`[DisplayEventProcessor] no allParticipants timeout resolved`)
        }

        publishPromise = RealtimeMessaging.publish(
          this.participantsDisplayChannel,
          'PARTICIPANTS_DISPLAY',
          formattedDisplayMessage()
        )
        break

      case 'spectators':
        logger.debug(`[DisplayEventProcessor] Publishing ${viewPath} to SPECTATORS_DISPLAY`)

        // Spectators may also have a timeout if specified
        if (timeoutFn) {
          const msecs = timeoutFn(appRenderContext.app)
          if (typeof msecs === 'number' && msecs > 0) {
            templateRenderContext.meta = {
              ...templateRenderContext.meta,
              timeout: { msecs }
            }
            logger.debug(`[DisplayEventProcessor] spectators timeout resolved to ${msecs}ms`)
          } else {
            logger.debug(`[DisplayEventProcessor] spectators timeout not set`)
          }
        }

        publishPromise = RealtimeMessaging.publish(
          this.spectatorsDisplayChannel,
                  'SPECTATORS_DISPLAY',
        formattedDisplayMessage()
      )
        break

      case 'eachParticipant':
        if (participantId === 'ALL_PARTICIPANTS') {
          // Legacy behavior - send to all participants (uses timeoutFn)
          logger.debug(`[DisplayEventProcessor] Processing RENDER_DISPLAY ${viewPath} for all participants`)
          publishPromise = this._processPrivateParticipantDisplays(template, templateRenderContext, timeoutFn)
        } else if (participantId) {
          // Selective participant rendering - send to specific participant only (uses displayTimeout)
          logger.debug(`[DisplayEventProcessor] Processing RENDER_DISPLAY ${viewPath} for participant ${participantId}`)
          publishPromise = this._processSelectiveParticipantDisplay(template, templateRenderContext, null, participantId, displayTimeout)
        } else {
          // Fallback - should not happen with unified approach
          logger.warn(`[DisplayEventProcessor] Unexpected participant display event without participantId`)
          publishPromise = Promise.resolve()
        }
        break

      case 'host':
        logger.debug(`[DisplayEventProcessor] Processing RENDER_DISPLAY ${viewPath} for host`)
        // Propagate host timeout if provided
        if (timeoutFn) {
          const msecs = timeoutFn(appRenderContext.app)
          if (typeof msecs === 'number' && msecs > 0) {
            templateRenderContext.meta = {
              ...templateRenderContext.meta,
              timeout: { msecs }
            }
            logger.debug(`[DisplayEventProcessor] host timeout resolved to ${msecs}ms`)
          } else {
            logger.debug(`[DisplayEventProcessor] host timeout not set`)
          }
        }

        publishPromise = this._processHostDisplay(template, templateRenderContext, timeoutFn)
        break

      default:
        throw new Error(`Unknown display viewer: ${displayViewer}`)
    }
    return { publishPromise, timeout }
  }

  _processHostDisplay(template, templateRenderContext, timeoutFn) {
    const hostEntry = Object.entries(this.participants).find(
      ([id, participantInfo]) => participantInfo.isHost
    );

    if (!hostEntry) {
      throw new Error("meta.host was specified, but no host participant was found.")
    }

    const hostId = hostEntry[0];
    const hostMachine = this.participantMachines[hostId]

    if (!hostMachine) {
      throw new Error(`[DisplayEventProcessor] Host participant machine not found for hostId: ${hostId}`)
    }
    this._sendPrivateDisplay(hostMachine, hostId, template, templateRenderContext, timeoutFn)
    return Promise.resolve()
  }

  _processPrivateParticipantDisplays(template, templateRenderContext, timeoutFn) {
    Object.values(this.participantsIndex.all).forEach(
      participantStruct => {
        // Exclude the host from receiving displays targeted at all participants.
        // Host-specific displays should use the `meta: { host: '...' }` syntax.
        if (participantStruct.info.isHost) return;

        const participantId = participantStruct.info.id
        const participantMachine = this.participantMachines[participantId]
        this._sendPrivateDisplay(participantMachine, participantId, template, templateRenderContext, timeoutFn)
      }
    )

    return Promise.resolve()
  }

  _processSelectiveParticipantDisplay(template, templateRenderContext, timeoutFn, participantId, displayTimeout = null) {
    const participantStruct = this.participantsIndex.get(participantId)

    if (!participantStruct) {
      logger.warn(`[DisplayEventProcessor] Participant ${participantId} not found for selective display`)
      return Promise.resolve()
    }

    // Exclude the host from receiving displays targeted at participants
    if (participantStruct.info.isHost) {
      logger.warn(`[DisplayEventProcessor] Cannot send participant display to host ${participantId}`)
      return Promise.resolve()
    }

    const participantMachine = this.participantMachines[participantId]
    if (!participantMachine) {
      logger.warn(`[DisplayEventProcessor] Participant machine not found for ${participantId}`)
      return Promise.resolve()
    }

    // Use displayTimeout if available, otherwise fall back to timeoutFn
    const effectiveTimeoutFn = displayTimeout !== null ?
      () => displayTimeout :
      timeoutFn

    this._sendPrivateDisplay(participantMachine, participantId, template, templateRenderContext, effectiveTimeoutFn)
    return Promise.resolve()
  }

  _sendPrivateDisplay(participantMachine, participantId, template, templateRenderContext, timeoutFn) {
    let timeout = null

    const participantStruct = this.participantsIndex.get(participantId)

    if (timeoutFn) {
      timeout = timeoutFn(templateRenderContext.app, participantStruct)
    }
    const privateRenderContext = {
      ...templateRenderContext,
      participant: participantStruct
    }

    if (timeout !== null) {
      privateRenderContext.timeout = timeout
    }

    const privateHtml = template(privateRenderContext)

    const renderMessage = { content: privateHtml }
    if (timeout !== null) {
      renderMessage.timeout = timeout
    }

    logger.debug(`Calculated a timeout of ${renderMessage.timeout} for ${participantId}`)

    participantMachine.send('RENDER_DISPLAY', renderMessage)
  }
}

module.exports = DisplayEventProcessor
