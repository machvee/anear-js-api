module.exports = {
  ParticipantPresencePrefix: 'PARTICIPANT',
  SpectatorPresencePrefix: 'SPECTATOR',
  ActiveStateName: 'active',
  ParticipantPresenceEvents: ['enter', 'leave', 'update'],
  SpectatorPresenceEvents: ['enter'],
  ImagesDirPath: 'assets/images',
  CssDirPath: 'assets/css',
  PugSuffix: '.pug',
  TIMEOUT_MINUTES: {
    START: 60, // 1 hour
    ANNOUNCE: 120 // 2 hours
  },
  TIMEOUT_SECONDS: {
    RECONNECT: 30
  }
}
