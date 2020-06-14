const node_logger = require('node-logger')
const defaultLevel = 'info'
const logger = () => {
  const _logger = node_logger.createLogger(process.env.ANEARAPP_LOGGER_FILE)
  _logger.setLevel(process.env.ANEARAPP_LOGGER_LEVEL||defaultLevel)
  _logger.format = (level, date, message) => {
    return date.toJSON() + ": " + message
  }
  return _logger
}

module.exports = logger()

