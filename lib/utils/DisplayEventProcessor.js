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
 *     timeout: // null|| { msecs:, [participantId:]}
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
    this.pugTemplates = anearEventMachineContext.pugTemplates
    this.pugHelpers = anearEventMachineContext.pugHelpers
    this.participantMachines = anearEventMachineContext.participantMachines
    this.participantsDisplayChannel = anearEventMachineContext.participantsDisplayChannel
    this.spectatorsDisplayChannel = anearEventMachineContext.spectatorsDisplayChannel
    this.participantsIndex = this._buildParticipantsIndex(anearEventMachineContext.participants)
  }

  processAndPublish(displayEvents) {
    return Promise.all(displayEvents.map(event => this._processSingle(event)))
  }

  _buildParticipantsIndex(participants) {
    const participantStructs = Object.fromEntries(
      Object.entries(participants).map(([id, info]) => [ id, { info, context: null } ])
    )
    const all = Object.values(participantStructs)

    logger.debug("[_buildParticipantsIndex]", all)

    return { all, get: id => participantStructs[id] }
  }

  _processSingle(displayEvent) {
    const { viewPath, appRenderContext } = displayEvent
    const timeout = appRenderContext.meta.timeout

    const normalizedPath = viewPath.endsWith(C.PugSuffix) ? viewPath : `${viewPath}${C.PugSuffix}`
    const template = this.pugTemplates[normalizedPath]

    if (!template) {
      throw new Error(`Template not found: ${normalizedPath}`)
    }

    const templateRenderContext = {
      ...appRenderContext,
      participants: this.participantsIndex,
      ...this.pugHelpers
    }

    switch (appRenderContext.meta.viewer) {
      case 'participants':
        logger.debug(`[DisplayEventProcessor] Publishing PARTICIPANTS_DISPLAY`)

        return RealtimeMessaging.publish(
          this.participantsDisplayChannel,
          'PARTICIPANTS_DISPLAY',
          template(templateRenderContext)
        )

      case 'spectators':
        logger.debug(`[DisplayEventProcessor] Publishing SPECTATORS_DISPLAY`)

        return RealtimeMessaging.publish(
          this.spectatorsDisplayChannel,
          'SPECTATORS_DISPLAY',
          template(templateRenderContext)
        )

      case 'participant':
        logger.debug(`[DisplayEventProcessor] Processing RENDER_DISPLAY for each participant`)
        return this._processPrivateParticipantDisplays(template, templateRenderContext, timeout)

      default:
        throw new Error(`Unknown meta.viewer: ${appRenderContext.meta.viewer}`)
    }
  }

  _processPrivateParticipantDisplays(template, templateRenderContext, timeout) {
    Object.values(this.participantsIndex.all).forEach(
      participantStruct => {
        const participantId = participantStruct.info.id
        const participantMachine = this.participantMachines[participantId]
        const privateRenderContext = {
          ...templateRenderContext,
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
