const SimpleNodeLogger = require('simple-node-logger')
const defaultLevel = 'info'
const defaultTimestamp = 'YYYY-MM-DD HH:mm:ss.SSS'
const defaultLogFilePath = "logfile.out"

const logger = () => {
  const opts = {
    logFilePath: process.env.ANEARAPP_LOGGER_FILE || defaultLogFilePath,
    timestampFormat: defaultTimestamp
  }

  const lgr = SimpleNodeLogger.createSimpleFileLogger(opts)
  lgr.setLevel(process.env.ANEARAPP_LOGGER_LEVEL||defaultLevel)
  return lgr
}

module.exports = logger()
