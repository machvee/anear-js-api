"use strict"
/**
 * --------------------------------------------------------------------------
 * Pug templates receive the following context at render:
 *
 * {
 *   app: application XState context
 *   meta: {
 *     viewer:  // 'participant', 'participants', 'spectators'
 *     state:   // Stringified state name (e.g., 'live.registration.waitForOpponentToJoin')
 *     event:   // The triggering event for this transition ('PARTICIPANT_ENTER')
 *     timeout: // null|| func}
 *   }
 *
 *   // When 'participant' displayType
 *   participants: // all: Map of all participants [info, context] for this event,  get(id) => info, context
 *   participant:  // info, context
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
    this.hostId = anearEventMachineContext.hostId
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
    const all = Object.values(participantStructs)

    return { all, get: id => participantStructs[id] }
  }

  _processSingle(displayEvent) {
    const { viewPath, appRenderContext, target, participantId, timeout: displayTimeout } = displayEvent
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
      ...this.pugHelpers
    }

    const formattedDisplayMessage = () => {
      const displayMessage = {
        content: template(templateRenderContext),
      }

      return displayMessage
    }

    // The target determines who sees the view. It defaults to the 'viewer'
    // from the meta block, but can be overridden (e.g., for 'host').
    const displayTarget = target || appRenderContext.meta.viewer

    switch (displayTarget) {
      case 'participants':
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

        publishPromise = RealtimeMessaging.publish(
          this.participantsDisplayChannel,
          'PARTICIPANTS_DISPLAY',
          formattedDisplayMessage()
        )
        break

      case 'spectators':
        logger.debug(`[DisplayEventProcessor] Publishing ${viewPath} to SPECTATORS_DISPLAY`)

        publishPromise = RealtimeMessaging.publish(
          this.spectatorsDisplayChannel,
                  'SPECTATORS_DISPLAY',
        formattedDisplayMessage()
      )
        break

      case 'participant':
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
        logger.debug(`[DisplayEventProcessor] Processing RENDER_DISPLAY ${viewPath} for host (${this.hostId})`)

        if (!this.hostId) {
          throw new Error("meta.host was specified, but no hostId is present in the AEM context.")
        }

        publishPromise = this._processHostDisplay(template, templateRenderContext, timeoutFn)
        break

      default:
        throw new Error(`Unknown display target: ${displayTarget}`)
    }
    return { publishPromise, timeout }
  }

  _processHostDisplay(template, templateRenderContext, timeoutFn) {
    const hostMachine = this.participantMachines[this.hostId]
    if (!hostMachine) {
      logger.error(`[DisplayEventProcessor] Host participant machine not found for hostId: ${this.hostId}`)
      return Promise.resolve()
    }
    this._sendPrivateDisplay(hostMachine, this.hostId, template, templateRenderContext, timeoutFn)
    return Promise.resolve()
  }

  _processPrivateParticipantDisplays(template, templateRenderContext, timeoutFn) {
    Object.values(this.participantsIndex.all).forEach(
      participantStruct => {
        // Exclude the host from receiving displays targeted at all participants.
        // Host-specific displays should use the `meta: { host: '...' }` syntax.
        if (participantStruct.info.type === 'host') return;

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
    if (participantStruct.info.type === 'host') {
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
