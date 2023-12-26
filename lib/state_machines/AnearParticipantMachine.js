"use strict"
const { assign, createMachine } = require('xstate')

const ParticipantTimer = require('../utils/ParticipantTimer')

const AnearParticipantMachineContext = (anearEvent, anearParticipant, realtimeMessaging) => ({
  anearEvent,
  anearParticipant,
  realtimeMessaging,
  privateChannel: null,
  participantTimer: null,
  geoLocation: null,
  lastSeen: null
})

const AnearParticipantMachineConfig = {
  id: 'AnearParticipantMachine',
  initial: 'createPrivateChannel',
  states: {
    createPrivateChannel: {
      entry: 'createPrivateChannel',
      always: {
        target: 'active'
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
}
 
const AnearParticipantMachineFunctions = {
  actions: {
    createPrivateChannel: assign(
      {
        privateChannel: context => context.realtimeMessaging.getChannel(
          context.anearParticipant.privateChannelName,
          context.anearParticipant.anearParticipantMachine
        )
      }
    ),
    createParticipantTimer: assign(
      {
        participantTimer: context => new ParticipantTimer(
          context.anearParticipant.id,
          () => context.anearParticipant.anearParticipantMachine.send('TIMEOUT')
        )
      }
    )
  },
  delays: {
  },
  services: {
  },
  guards: {
  }
}

// The AnearParticipantMachine:
//   1. maintains the presence and geo-location for a Participant in an Event
//   2. spawns the developer supplied ParticipantAppMachineClass
//   3. creates a private display ChannelMachine to which any private display messages get published
//   4. handles activity timer, response timeouts, idle state
//   5. receives ACTION events relayed by the AnearEventMachine
//   6. relays all relevant events to the ParticipantAppMachineClass for Application-specific handling
const AnearParticipantMachine = (anearEvent, anearParticipant, realtimeMessaging) => {
  const expandedConfig = {predictableActionArguments: true, ...AnearParticipantMachineConfig}

  const participantMachine = createMachine(expandedConfig, AnearParticipantMachineFunctions)

  const ctx = AnearParticipantMachineContext(anearEvent, anearParticipant, realtimeMessaging)

  return participantMachine.withContext(ctx)
}

module.exports = AnearParticipantMachine
