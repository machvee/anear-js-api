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
          actions: ['createParticipantEventMachine', 'createParticipantTimer'],
          target: 'active'
        }
      }
    },
    active: {
      id: 'active',
      initial: 'config',
      on: {
        TIMEOUT: {
          target: 'how do we handle timeouts mark participant unresponsive (temp outage), then exit event'
        },
        ACTION: {
          actions: 'processAction',
          target: 'history fix me'
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
    createParticipantEventMachine: assign({ participantEventMachine: (context, event) => anearParticipantMachine.createParticipantEventMachine(context) }),
    createParticipantTimer: assign({ participantTimer: (context, event) => anearParticipantMachine.createParticipantTimer(context) })
  },
  services: {
  },
  guards: {
  }
})

class AnearParticipantMachine extends AnearBaseMachine {
  // The AnearParticipantMachine:
  //   1. maintains the presence and geo-location for a Participant in an Event
  //   2. spawns the developer supplied ParticipantAppMachineClass
  //   3. creates a private display ChannelMachine to which any private display messages get published
  //   4. handles activity timer, response timeouts, idle state
  //   5. receives ACTION events relayed by the AnearEventMachine
  //   6. relays all relevant events to the ParticipantAppMachineClass for Application-specific handling
  constructor(anearEventMachine, participantJSON) {
    super(
      AnearParticipantMachineConfig,
      AnearParticipantMachineFunctions,
      AnearParticipantMachineContext(anearEventMachine, new AnearParticipant(participantJSON))
    )
  }

  createParticipantEventMachine(context) {
    // if defined, starts the state machine for the developer-provided ParticipantEventMachineClass
    const { ParticipantEventMachineClass } = context.anearEventMachine.context.coreServiceMachine.context
    if (!ParticipantEventMachineClass) return null

    const participantEventMachine = context.anearEventMachine.participantEventMachineInstance(this)
    participantEventMachine.startService()
    return participantEventMachine
  }

  createParticipantTimer(context) {
    return new ParticipantTimer(context.anearParticipant.id, () => this.send('TIMEOUT'))
  }

  publish(message) {
    this.context.privateChannelMachine.publish(message)
  }
}

module.exports = AnearParticipantMachine
