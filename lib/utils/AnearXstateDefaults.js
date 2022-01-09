"use strict"

// These default configuration and options funcs provide
// a simple default state machine for an anear Event.  This is
// so we don't mandate that app developers use xState to drive
// their app's state transitions.
//
const DefaultConfigFunc = anearEvent => {

  const InvokeHandlers = {
    onDone: {
      target: 'eventActive'
    },
    onError: {
      actions: 'logError',
      target: 'eventActive'
    }
  }

  return {
    id: "defaultXstateConfig",
    initial: 'eventActive',
    states: {
      eventActive: {
        on: {
          JOIN: {
            target: 'join'
          },
          REFRESH: {
            target: 'refresh'
          },
          CLOSE: {
            target: 'close'
          },
          TIMEOUT: {
            target: 'timeout'
          },
          '*': {
            // default wildcard state is presumed to be a custom ACTION name
            // embedded in a anear-action-click property in the app's HTML
            target: 'action'
          }
        }
      },
      join: {
        invoke: {
          id: 'join',
          src: 'joinEventHandler',
          ...InvokeHandlers
        }
      },
      refresh: {
        invoke: {
          id: 'refresh',
          src: 'refreshEventHandler',
          ...InvokeHandlers
        }
      },
      close: {
        invoke: {
          id: 'close',
          src: 'closeEventHandler',
          ...InvokeHandlers
        }
      },
      timeout: {
        invoke: {
          id: 'timeout',
          src: 'timeoutEventHandler',
          ...InvokeHandlers
        }
      },
      action: {
        invoke: {
          id: 'action',
          src: 'actionEventHandler',
          ...InvokeHandlers
        }
      }
    }
  }
}

const DefaultOptionsFunc = anearEvent => {
  return {
    actions: {
      logError: (context, event) => logger.error(`error message: ${event.data}`)
    },
    services: {
      joinEventHandler: (context, event) => {
        anearEvent.participantEnterEventCallback(event.anearParticipant)
      },
      refreshEventHandler: (context, event) => {
        anearEvent.participantRefreshEventCallback(event.anearParticipant)
      },
      closeEventHandler: (context, event) => {
        anearEvent.participantCloseEventCallback(event.anearParticipant)
      },
      timeoutEventHandler: (context, event) => {
        anearEvent.participantTimedOutEventCallback(event.anearParticipant)
      },
      actionEventHandler: (context, event) => {
        anearEvent.participantActionEventCallback(event.anearParticipant, event.actionEventName, event.payload)
      }
    }
  }
}

module.exports = {
  DefaultConfigFunc,
  DefaultOptionsFunc
}
