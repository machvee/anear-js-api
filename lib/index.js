'use strict';

const { version } = require('../package.json');

const logger                = require('./utils/Logger');
const JsonApiResource       = require('./models/JsonApiResource');
const JsonApiArrayResource  = require('./models/JsonApiArrayResource');
const AnearService          = require('./AnearService');
const AnearEvent            = require('./models/AnearEvent');
const AnearParticipant      = require('./models/AnearParticipant');
const Fixtures              = require('../tests/fixtures');

module.exports = {
  version,
  logger,
  JsonApiResource,
  JsonApiArrayResource,
  AnearService,
  AnearEvent,
  AnearParticipant,
  Fixtures
};

