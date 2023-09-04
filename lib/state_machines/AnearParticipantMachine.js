"use strict"

const { assign } = require('xstate')

const AnearBaseMachine = require('../state_machines/AnearBaseMachine')
const AnearParticipant = require('../models/AnearParticipant')
const ParticipantTimer = require('../utils/ParticipantTimer')

const AnearParticipantMachineContext = (anearEventMachine, anearParticipant) => ({
  anearEventMachine,
  anearParticipant,
  privateChannelMachine: null,
  participantTimer: null,
  participantMachine: null,
  geoLocation: null,
  lastSeen: null
})

const AnearParticipantConfig = anearParticipantMachine => ({
  id: 'AnearParticipantMachine',
  initial: 'createPrivateChannel',
  states: {
    createPrivateChannel: {
      entry: 'createPrivateChannel',
      on: {
        INITIALIZED: {
          actions: assign({ privateChannelMachine: (context, event) => event.channelMachine }),
        },
        ATTACHED: {
          actions: ['createParticipantMachine', 'createParticipantTimer'],
          target: 'active'
        }
      }
    },
    active: {
      id: 'active',
      initial: 'config',
      on: {
        TIMEOUT: {
          target: 'fixme'
        },
        ACTION: {

        }
      },
      states: {
        // participants generally go through a game configuration,
        // that lets them choose display and play options.  e.g.
        // grouping into teams, skill level, color/shapes of play
        // pieces, etc.
        config: {
        },
        waitOpening: {
          // here a participant is waiting for the game countdown
          // to begin
        },
        waitLive: {
          // countdown in progress ... waiting to go live
        },
        live: {
          // game is live and participant ACTION events trigger context
          // mutations in the ParticipantMachine and AppMachine
        }
      }
    },
    idle: {
    }
  }
})
 
const AnearParticipantMachineFunctions = anearParticipantMachine => ({
  actions: {
    createPrivateChannel: (context, event) => {
      context.anearEventMachine.createChannel(context, anearParticipantMachine, context.anearParticipant.privateChannelName)
    },
    createParticipantMachine: assign({ participantMachine: (context, event) => anearParticipantMachine.createParticipantMachine(context) }),
    createParticipantTimer: assign({ participantTimer: (context, event) => anearParticipantMachine.createParticipantTimer(context) })
  },
  services: {
  },
  guards: {
  }
})

class AnearParticipantMachine extends AnearBaseMachine {
  // maintain the state and presence for a Participant in an Event
  // handles activity timer, response timeouts, idle state,
  // geolocation, etc
  //
  constructor(anearEventMachine, participantJSON) {
    super(
      AnearParticipantMachineConfig,
      AnearParticipantMachineFunctions,
      AnearParticipantMachineContext(anearEventMachine, new AnearParticipant(participantJSON))
    )
  }

  createParticipantMachine(context) {
    // starts the state machine for the developer-provided AnearParticipantStateMachineClass
    const { ParticipantStateMachineClass } = context.anearEventMachine.context.coreServiceMachine.context
    const participantMachine = context.anearEventMachine.participantStateMachineInstance(this)
    participantMachine.startService()
    return participantMachine
  }

  createParticipantTimer(context) {
    return new ParticipantTimer(context.anearParticipant.id, () => this.send('TIMEOUT'))
  }

  publish(message) {
    this.context.privateChannelMachine.publish(message)
  }
}

module.exports = AnearParticipantMachine
