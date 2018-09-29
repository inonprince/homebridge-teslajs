'use strict';

var _createTesla = require('./createTesla');

var _createTesla2 = _interopRequireDefault(_createTesla);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

module.exports = function register(homebridge) {
  const Service = homebridge.hap.Service;
  const Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-tesla', 'Tesla', (0, _createTesla2.default)({
    Service,
    Characteristic
  }));
};