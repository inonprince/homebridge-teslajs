'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = createTesla;

var _teslajs = require('teslajs');

var _teslajs2 = _interopRequireDefault(_teslajs);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function createTesla({ Service, Characteristic }) {
  const CurrentTemperature = Characteristic.CurrentTemperature;
  const LockCurrentState = Characteristic.LockCurrentState;
  const LockTargetState = Characteristic.LockTargetState;
  const SwitchOn = Characteristic.On;

  return class Tesla {
    constructor(log, config) {
      this.log = log;
      this.name = config.name;
      this.token = config.token;
      this.vin = config.vin;
      this.temperature = 0;
      this.tempSetting = 0;
      this.climateState = Characteristic.TargetHeatingCoolingState.OFF;
      this.charging = false;
      this.chargingState = Characteristic.ChargingState.NOT_CHARGEABLE;
      this.batteryLevel = 0;

      this.temperatureService = new Service.Thermostat(this.name);
      this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature).on('get', this.getClimateState.bind(this, 'temperature'));
      this.temperatureService.getCharacteristic(Characteristic.TargetTemperature).on('get', this.getClimateState.bind(this, 'setting')).on('set', this.setTargetTemperature.bind(this));

      this.temperatureService.getCharacteristic(Characteristic.CurrentHeatingCoolingState).on('get', this.getClimateState.bind(this, 'state'));

      this.temperatureService.getCharacteristic(Characteristic.TargetHeatingCoolingState).on('get', this.getClimateState.bind(this, 'state')).on('set', this.setClimateOn.bind(this));
      this.temperatureService.getCharacteristic(Characteristic.TemperatureDisplayUnits).on('get', callback => {
        this.log('Getting temperature display units...');
        callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
      });

      this.lockService = new Service.LockMechanism(this.name, 'doorlocks');
      this.lockService.getCharacteristic(LockCurrentState).on('get', this.getLockState.bind(this));

      this.lockService.getCharacteristic(LockTargetState).on('get', this.getLockState.bind(this)).on('set', this.setLockState.bind(this));

      this.chargeDoorService = new Service.LockMechanism(this.name + ' Charging Port', 'chargedoor');
      this.chargeDoorService.getCharacteristic(LockCurrentState).on('get', this.getChargeDoorState.bind(this));

      this.chargeDoorService.getCharacteristic(LockTargetState).on('get', this.getChargeDoorState.bind(this)).on('set', this.setChargeDoorState.bind(this));

      this.trunkService = new Service.LockMechanism(this.name + ' Trunk', 'trunk');
      this.trunkService.getCharacteristic(LockCurrentState).on('get', this.getTrunkState.bind(this, 'trunk'));

      this.trunkService.getCharacteristic(LockTargetState).on('get', this.getTrunkState.bind(this, 'trunk')).on('set', this.setTrunkState.bind(this, 'trunk'));

      this.frunkService = new Service.LockMechanism(this.name + ' Front Trunk', 'frunk');
      this.frunkService.getCharacteristic(LockCurrentState).on('get', this.getTrunkState.bind(this, 'frunk'));

      this.frunkService.getCharacteristic(LockTargetState).on('get', this.getTrunkState.bind(this, 'frunk')).on('set', this.setTrunkState.bind(this, 'frunk'));

      this.batteryLevelService = new Service.BatteryService(this.name);
      this.batteryLevelService.getCharacteristic(Characteristic.BatteryLevel).on('get', this.getBatteryLevel.bind(this));
      this.batteryLevelService.getCharacteristic(Characteristic.ChargingState).on('get', this.getChargingState.bind(this, 'state'));

      this.chargingService = new Service.Switch(this.name + ' Charging', 'charging');
      this.chargingService.getCharacteristic(Characteristic.On).on('get', this.getChargingState.bind(this, 'charging')).on('set', this.setCharging.bind(this));
    }

    async getTrunkState(which, callback) {
      this.log("Getting current trunk state...");
      try {
        const vehicleState = await _teslajs2.default.vehicleStateAsync({
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        });
        const res = which === 'frunk' ? !vehicleState.ft : !vehicleState.rt;
        return callback(null, res);
      } catch (err) {
        callback(err);
      }
    }

    async setTrunkState(which, state, callback) {
      var toLock = state == LockTargetState.SECURED;
      this.log(`Setting ${which} to toLock = ${toLock}`);
      if (toLock) {
        this.log("cannot close trunks");
        callback(new Error("I can only open trunks"));
      }
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = await _teslajs2.default.openTrunkAsync(options, which === 'trunk' ? _teslajs2.default.TRUNK : _teslajs2.default.FRUNK);
        if (res.result && !res.reason) {
          const currentState = state == LockTargetState.SECURED ? LockCurrentState.SECURED : LockCurrentState.UNSECURED;
          setTimeout(function () {
            this.trunkService.setCharacteristic(LockCurrentState, currentState);
          }.bind(this), 1);
          callback(null); // success
        } else {
          this.log("Error setting trunk state: " + res.reason);
          callback(new Error("Error setting trunk state. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting trunk state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting trunk state."));
      }
    }

    async getBatteryLevel(callback) {
      this.log("Getting current battery level...");
      try {
        const chargingState = await _teslajs2.default.chargeStateAsync({
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        });
        if (chargingState && chargingState.hasOwnProperty('battery_level')) {
          this.batteryLevel = chargingState.battery_level;
        } else {
          this.log('Error getting battery level: ' + _util2.default.inspect(arguments));
          return callback(new Error('Error getting battery level.'));
        }
        return callback(null, this.batteryLevel);
      } catch (err) {
        callback(err);
      }
    }

    async getChargingState(what, callback) {
      this.log("Getting current charge state...");
      try {
        const chargingState = await _teslajs2.default.chargeStateAsync({
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        });
        if (chargingState) {
          this.charging = chargingState.charge_rate > 0 ? true : false;
          const connected = chargingState.charge_port_latch === 'Engaged' ? true : false;
          this.chargingState = Characteristic.ChargingState.NOT_CHARGEABLE;
          if (connected) {
            this.chargingState = Characteristic.ChargingState.NOT_CHARGING;
          }
          if (this.charging) {
            this.chargingState = Characteristic.ChargingState.CHARGING;
          }
        } else {
          this.log('Error getting charging state: ' + _util2.default.inspect(arguments));
          return callback(new Error('Error getting charging state.'));
        }
        switch (what) {
          case 'state':
            return callback(null, this.chargingState);
          case 'charging':
            return callback(null, this.charging);
        }
      } catch (err) {
        callback(err);
      }
    }

    async setCharging(on, callback) {
      this.log('Setting charging to on = ' + on);
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = on ? await _teslajs2.default.startChargeAsync(options) : await _teslajs2.default.stopChargeAsync(options);
        if (res.result && !res.reason) {
          callback(null); // success
        } else {
          if (res.reason !== 'complete' && res.reason !== 'not_charging') {
            this.log("Error setting charging state: " + res.reason);
            callback(new Error("Error setting charging state. " + res.reason));
          } else {
            callback(null); // success
            setTimeout(function () {
              this.chargingService.setCharacteristic(Characteristic.On, false);
            }.bind(this), 300);
          }
        }
      } catch (err) {
        this.log("Error setting charging state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting charging state."));
      }
    }

    celsiusToFer(cel) {
      return Math.round(cel * 1.8 + 32);
    }

    async setTargetTemperature(value, callback) {
      this.log(`Setting temp to ${value} (${this.celsiusToFer(value)}F)`);
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = await _teslajs2.default.setTempsAsync(options, value, value);
        if (res.result && !res.reason) {
          callback(null); // success
        } else {
          this.log("Error setting temp: " + res.reason);
          callback(new Error("Error setting temp. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting temp: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting lock state."));
      }
    }

    async getClimateState(what, callback) {
      this.log("Getting current climate state...");
      try {
        const climateState = await _teslajs2.default.climateStateAsync({
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        });
        switch (what) {
          case 'temperature':
            return callback(null, climateState.inside_temp);
          case 'setting':
            return callback(null, climateState.driver_temp_setting);
          case 'state':
            return callback(null, climateState.is_auto_conditioning_on ? Characteristic.TargetHeatingCoolingState.AUTO : Characteristic.TargetHeatingCoolingState.OFF);
        }
      } catch (err) {
        this.log(err);
        callback(err);
      }
    }

    async setClimateOn(state, callback) {
      const turnOn = state !== Characteristic.TargetHeatingCoolingState.OFF;
      this.log("Setting climate to = " + turnOn);
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = turnOn ? await _teslajs2.default.climateStartAsync(options) : await _teslajs2.default.climateStopAsync(options);
        if (res.result && !res.reason) {
          callback(null); // success
        } else {
          this.log("Error setting climate state: " + res.reason);
          callback(new Error("Error setting climate state. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting climate state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting lock state."));
      }
    }

    async getLockState(callback) {
      this.log("Getting current lock state...");
      try {
        const vehicleState = await _teslajs2.default.vehicleStateAsync({
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        });
        return callback(null, vehicleState.locked);
      } catch (err) {
        callback(err);
      }
    }

    async setLockState(state, callback) {
      var locked = state == LockTargetState.SECURED;
      this.log("Setting car to locked = " + locked);
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = locked ? await _teslajs2.default.doorLockAsync(options) : await _teslajs2.default.doorUnlockAsync(options);
        if (res.result && !res.reason) {
          const currentState = state == LockTargetState.SECURED ? LockCurrentState.SECURED : LockCurrentState.UNSECURED;
          setTimeout(function () {
            this.lockService.setCharacteristic(LockCurrentState, currentState);
          }.bind(this), 1);
          callback(null); // success
        } else {
          this.log("Error setting lock state: " + res.reason);
          callback(new Error("Error setting lock state. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting lock state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting lock state."));
      }
    }

    async getChargeDoorState(callback) {
      this.log("Getting current charge door state...");
      try {
        const chargeState = await _teslajs2.default.chargeStateAsync({
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        });
        return callback(null, !chargeState.charge_port_door_open);
      } catch (err) {
        callback(err);
      }
    }

    async setChargeDoorState(state, callback) {
      var locked = state == LockTargetState.SECURED;
      this.log("Setting charge door to locked = " + locked);
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = locked ? await _teslajs2.default.closeChargePortAsync(options) : await _teslajs2.default.openChargePortAsync(options);
        if (res.result && !res.reason) {
          const currentState = state == LockTargetState.SECURED ? LockCurrentState.SECURED : LockCurrentState.UNSECURED;
          setTimeout(function () {
            this.chargeDoorService.setCharacteristic(LockCurrentState, currentState);
          }.bind(this), 1);
          callback(null); // success
        } else {
          this.log("Error setting charge door state: " + res.reason);
          callback(new Error("Error setting charge door state. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting charge door state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting charge door state."));
      }
    }

    async wakeUp() {
      try {
        const res = await _teslajs2.default.wakeUpAsync({
          authToken: this.token
        });
        return res;
      } catch (err) {
        this.log("Error logging into Tesla: " + err);
        return Promise.reject(err);
      };
    }

    async getVehicleId() {
      this.log("getting vehicle id...");
      try {
        const res = await _teslajs2.default.vehiclesAsync({
          authToken: this.token
        });
        const vehicleId = res.id_s;
        const state = res.state;
        if (state == 'asleep') {
          this.log('awaking car...');
          await this.wakeUp();
        }
        this.log('vehicle id is ' + vehicleId);
        return vehicleId;
      } catch (err) {
        this.log("Error logging into Tesla: " + err);
        return Promise.reject(err);
      };
    }

    getServices() {
      return [this.temperatureService, this.lockService, this.trunkService, this.frunkService, this.batteryLevelService, this.chargingService, this.chargeDoorService];
    }
  };
}