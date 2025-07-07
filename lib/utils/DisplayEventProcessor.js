"use strict"
/**
 * --------------------------------------------------------------------------
 * Pug templates receive the following context at render:
 *
 * {
 *   displayType:       // 'participants' | 'spectators' | 'participant'
 *   context:           // AppEventMachine's XState context for this transition
 *   state:             // Stringified state name (e.g., 'live.registration.waitForOpponentToJoin')
 *   event:             // The triggering event for this transition
 *   participants:      // Map of all participants for this event
 *
 *   // When 'participant' displayType
 *   participant        // current participant
 *   participantContext // current participant private context if AppParticipantMachine
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
    this.pugTemplates = anearEventMachineContext.pugTemplates
    this.pugHelpers = anearEventMachineContext.pugHelpers
    this.participantMachines = anearEventMachineContext.participantMachines
    this.participantsDisplayChannel = anearEventMachineContext.participantsDisplayChannel
    this.spectatorsDisplayChannel = anearEventMachineContext.spectatorsDisplayChannel
    this.participantsIndex = _buildParticipantsIndex(anearEventMachineContext.participants)
  }

  processAndPublish(displayEvents) {
    return Promise.all(displayEvents.map(event => this._processSingle(event)))
  }

  _buildParticipantsIndex(participants) {
    const participantStructs = Object.fromEntries(
      Object.entries(participants).map(([id, info]) => [ id, { info, context: null } ])
    )
    const all = Object.values(participantStructs)

    return { all, get: id => participantStructs[id] }
  }

  _processSingle(displayEvent) {
    const { viewPath, appExecutionContext } = displayEvent
    const timeout = appExecutionContext.meta.timeout

    const normalizedPath = viewPath.endsWith(C.PugSuffix) ? viewPath : `${viewPath}${C.PugSuffix}`
    const template = this.pugTemplates[normalizedPath]

    if (!template) {
      throw new Error(`Template not found: ${normalizedPath}`)
    }

    const renderContext = {
      ...appExecutionContext,
      participants: this.participantsIndex,
      ...this.pugHelpers
    }

    const renderedContent = template(renderContext)

    switch (displayType) {
      case 'participants':
        logger.debug(`[DisplayEventProcessor] Publishing PARTICIPANTS_DISPLAY`)
        return RealtimeMessaging.publish(
          this.participantsDisplayChannel,
          'PARTICIPANTS_DISPLAY',
          renderedContent
        )

      case 'spectators':
        logger.debug(`[DisplayEventProcessor] Publishing SPECTATORS_DISPLAY`)
        return RealtimeMessaging.publish(
          this.spectatorsDisplayChannel,
          'SPECTATORS_DISPLAY',
          renderedContent
        )

      case 'participant':
        logger.debug(`[DisplayEventProcessor] Processing RENDER_DISPLAY for each participant`)
        return this._processPrivateParticipantDisplays(template, renderContext, timeout)

      default:
        throw new Error(`Unknown displayType: ${displayType}`)
    }
  }

  _processPrivateParticipantDisplays(template, renderContextBase, timeout) {
    Object.values(this.participantsIndex.all).forEach(
      participantStruct => {
        const participantId = participantStruct.info.id
        const participantMachine = this.participantMachines[participantId]
        const privateRenderContext = {
          ...renderContextBase,
          participant: participantStruct
        }

        const privateHtml = template(privateRenderContext)

        const renderMessage = { content: privateHtml }
        if (timeout) renderMessage.timeout = timeout

        participantMachine.send('RENDER_DISPLAY', renderMessage)
      }
    )

    return Promise.resolve()
  }
}

module.exports = DisplayEventProcessor
