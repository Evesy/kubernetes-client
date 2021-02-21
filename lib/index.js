const deprecate = require('depd')('kubernetes-client')

module.exports = {
  Client: require('./swagger-client').Client,
  Client1_17: require('./swagger-client').Client1_17,
  alias: require('./alias')
}