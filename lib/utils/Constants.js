module.exports = {
  ParticipantPresencePrefix: 'PARTICIPANT',
  SpectatorPresencePrefix: 'SPECTATOR',
  ActiveStateName: 'active',
  ParticipantPresenceEvents: ['enter', 'leave', 'update'],
  SpectatorPresenceEvents: ['enter'],
  ImagesDirPath: 'assets/images',
  CssDirPath: 'assets/css',
  PugSuffix: '.pug',
  TIMEOUT_MSECS: {
    ANNOUNCE: 5 * 60 * 1000, // 5 minutes
    START: 5 * 60 * 1000,    // 5 minutes
    RENDERED_EVENT_DELAY: 100, // 100 milliseconds
    RECONNECT: 30 * 1000 // 30 seconds
  },
  EventStates: {
    CREATED: 'created',
    STARTED: 'started',
    ENDED: 'ended',
    CANCELLED: 'cancelled',
    FAILED: 'failed'
  }
}
