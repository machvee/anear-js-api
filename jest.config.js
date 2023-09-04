require('dotenv').config({ path: '.env.test' })
module.exports = {
  // Jest configuration options...
  moduleNameMapper: {
    'AnearApi': '<rootDir>/__mocks__/api/AnearApi.js',
    'RealtimeMessaging': '<rootDir>/__mocks__/utils/RealtimeMessaging.js'
  }
}

