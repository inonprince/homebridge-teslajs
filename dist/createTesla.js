'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = createTesla;

var _teslajs = require('teslajs');

var _teslajs2 = _interopRequireDefault(_teslajs);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

var _bottleneck = require('bottleneck');

var _bottleneck2 = _interopRequireDefault(_bottleneck);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function createTesla({ Service, Characteristic }) {
  const CurrentTemperature = Characteristic.CurrentTemperature;
  const LockCurrentState = Characteristic.LockCurrentState;
  const LockTargetState = Characteristic.LockTargetState;
  const SwitchOn = Characteristic.On;

  return class Tesla {
    constructor(log, config) {
      this.conditioningTimer = null;
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
      this.lastWakeupTS = 0;
      this.lastVehicleId = 0;
      this.lastVehicleIdTS = 0;
      this.vehicleData = null;
      this.getPromise = null;

      this.limiter = new _bottleneck2.default({
        // maxConcurrent: 2,
        minTime: 100
      });

      this.temperatureService = new Service.Thermostat(this.name);
      this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature).on('get', this.getClimateState.bind(this, 'temperature'));
      this.temperatureService.getCharacteristic(Characteristic.TargetTemperature).on('get', this.getClimateState.bind(this, 'setting')).on('set', this.setTargetTemperature.bind(this));

      this.temperatureService.getCharacteristic(Characteristic.CurrentHeatingCoolingState).on('get', this.getClimateState.bind(this, 'state'));

      this.temperatureService.getCharacteristic(Characteristic.TargetHeatingCoolingState).on('get', this.getClimateState.bind(this, 'state')).on('set', this.setClimateOn.bind(this));
      this.temperatureService.getCharacteristic(Characteristic.TemperatureDisplayUnits).on('get', callback => {
        this.log('Getting temperature display units...');
        callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
      });

      this.ConditioningService = new Service.Switch(this.name + ' Conditioning', 'conditioning');
      this.ConditioningService.getCharacteristic(Characteristic.On).on('get', this.getConditioningState.bind(this)).on('set', this.setConditioningState.bind(this));

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

      this.HornService = new Service.Switch(this.name + ' Horn', 'horn');
      this.HornService.getCharacteristic(Characteristic.On).on('get', this.getHornState.bind(this)).on('set', this.setHornState.bind(this));

      this.LightsService = new Service.Switch(this.name + ' Lights', 'lights');
      this.LightsService.getCharacteristic(Characteristic.On).on('get', this.getLightsState.bind(this)).on('set', this.setLightsState.bind(this));
    }

    getConditioningState(callback) {
      return callback(null, !!this.conditioningTimer);
    }

    async setConditioningState(on, callback) {
      this.log('Setting conditioning to on = ' + on);
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };

        const res = on ? await _teslajs2.default.climateStartAsync(options) : await _teslajs2.default.climateStopAsync(options);
        if (res.result && !res.reason) {
          if (on) {
            this.conditioningTimer = setTimeout(async () => {
              setTimeout(function () {
                this.ConditioningService.getCharacteristic(Characteristic.On).updateValue(false);
              }.bind(this), 300);
              const driveStateRes = await _teslajs2.default.driveStateAsync(options);
              const shiftState = driveStateRes.shift_state || "Parked";
              if (shiftState === "Parked") {
                const climateStopRes = await _teslajs2.default.climateStopAsync(options);
              }
              this.conditioningTimer = null;
            }, 10 * 60 * 1000);
          } else {
            clearTimeout(this.conditioningTimer);
            this.conditioningTimer = null;
          }
          callback(null); // success
        } else {
          this.log("Error setting climate state: " + res.reason);
          callback(new Error("Error setting climate state. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting charging state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting charging state."));
      }
    }

    getHornState(callback) {
      return callback(null, false);
    }

    async setHornState(state, callback) {
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = await _teslajs2.default.honkHornAsync(options);
        if (res.result && !res.reason) {
          callback(null); // success
          setTimeout(function () {
            this.HornService.getCharacteristic(Characteristic.On).updateValue(false);
          }.bind(this), 1000);
        } else {
          this.log("Error setting horn state: " + res.reason);
          callback(new Error("Error setting horn state. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting horn state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting horn state."));
      }
    }

    getLightsState(callback) {
      return callback(null, false);
    }

    async setLightsState(state, callback) {
      try {
        const options = {
          authToken: this.token,
          vehicleID: await this.getVehicleId()
        };
        const res = await _teslajs2.default.flashLightsAsync(options);
        if (res.result && !res.reason) {
          callback(null); // success
          setTimeout(function () {
            this.LightsService.getCharacteristic(Characteristic.On).updateValue(false);
          }.bind(this), 1000);
        } else {
          this.log("Error setting lights state: " + res.reason);
          callback(new Error("Error setting lights state. " + res.reason));
        }
      } catch (err) {
        this.log("Error setting lights state: " + _util2.default.inspect(arguments));
        callback(new Error("Error setting lights state."));
      }
    }

    async getTrunkState(which, callback) {
      this.log("Getting current trunk state...");
      try {
        await this.getCarDataPromise();
        const vehicleState = this.vehicleData.vehicle_state;
        const res = which === 'frunk' ? !vehicleState.ft : !vehicleState.rt;
        this.log(`${which} state is ${res}`);
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
        const res = await this.limiter.schedule(async () => await _teslajs2.default.openTrunkAsync(options, which === 'trunk' ? _teslajs2.default.TRUNK : _teslajs2.default.FRUNK));
        // const res = await tjs.openTrunkAsync(options,  which === 'trunk' ? tjs.TRUNK : tjs.FRUNK);
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
        await this.getCarDataPromise();
        const chargingState = this.vehicleData.charge_state;
        if (chargingState && chargingState.hasOwnProperty('battery_level')) {
          this.batteryLevel = chargingState.battery_level;
        } else {
          this.log('Error getting battery level: ' + _util2.default.inspect(arguments));
          return callback(new Error('Error getting battery level.'));
        }
        this.log(`battery level is ${this.batteryLevel}`);
        return callback(null, this.batteryLevel);
      } catch (err) {
        callback(err);
      }
    }

    async getChargingState(what, callback) {
      this.log("Getting current charge state...");
      try {
        await this.getCarDataPromise();
        const chargingState = this.vehicleData.charge_state;
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
        this.log(`charging: ${what} is ${what === 'state' ? this.chargingState : this.charging}`);
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
        await this.getCarDataPromise();
        const climateState = this.vehicleData.climate_state;
        let ret;
        switch (what) {
          case 'temperature':
            ret = climateState.inside_temp;
            break;
          case 'setting':
            ret = climateState.driver_temp_setting;
            break;
          case 'state':
            ret = climateState.is_auto_conditioning_on ? Characteristic.TargetHeatingCoolingState.AUTO : Characteristic.TargetHeatingCoolingState.OFF;
            break;
        }
        this.log(`climate: ${what} state is ${ret}`);
        return callback(null, ret);
      } catch (err) {
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
        await this.getCarDataPromise();
        return callback(null, this.vehicleData.vehicle_state.locked);
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

    getCarDataPromise() {
      if (!this.isRunning) {
        this.getPromise = this.getCarData();
      }
      return this.getPromise;
    }

    getCarData() {
      return new Promise(async (resolve, reject) => {
        try {
          this.isRunning = true;
          const options = {
            authToken: this.token,
            vehicleID: await this.getVehicleId()
          };
          this.log('querying tesla for vehicle data...');
          const res = await _teslajs2.default.vehicleDataAsync(options);
          if (res.vehicle_id && !res.reason) {
            this.vehicleData = res;
            this.isRunning = false;
            resolve(res);
          } else {
            this.log('error', res);
            this.isRunning = false;
            reject(res);
          }
        } catch (err) {
          this.log('error', err);
          this.isRunning = false;
          reject(err);
        }
      });
    }

    async getChargeDoorState(callback) {
      this.log("Getting current charge door state...");
      try {
        await this.getCarDataPromise();
        return callback(null, !this.vehicleData.charge_state.charge_port_door_open);
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

    async wakeUp(vehicleID) {
      try {
        if (this.lastWakeupTS + 5000 < Date.now()) {
          this.lastWakeupTS = Date.now();
          const res = await _teslajs2.default.wakeUpAsync({
            authToken: this.token,
            vehicleID
          });
        }

        for (let i = 0; i < 13; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          this.log('checking if tesla woken up');
          const res2 = await _teslajs2.default.vehiclesAsync({
            authToken: this.token
          });
          const state = res2.state;
          if (state !== 'asleep') return Promise.resolve();
        }
        this.log("Error waking Tesla: " + err);
        return Promise.reject(err);
      } catch (err) {
        this.log("Error waking Tesla: " + err);
        return Promise.reject(err);
      };
    }

    async getVehicleId() {
      if (this.lastVehicleId && this.lastVehicleIdTS + 10000 > Date.now()) {
        return this.lastVehicleId;
      }
      this.log("querying tesla vehicle id and state...");
      try {
        const res = await this.limiter.schedule(() => _teslajs2.default.vehiclesAsync({
          authToken: this.token
        }));
        const vehicleId = res.id_s;
        const state = res.state;
        if (state == 'asleep') {
          this.log('awaking car...');
          await this.limiter.schedule(() => this.wakeUp(res.id_s));
        }
        this.lastVehicleIdTS = Date.now();
        this.lastVehicleId = vehicleId;
        return this.lastVehicleId;
      } catch (err) {
        this.log("Error logging into Tesla: " + err);
        return Promise.reject(err);
      };
    }

    getServices() {
      return [this.temperatureService, this.lockService, this.trunkService, this.frunkService, this.batteryLevelService, this.chargingService, this.chargeDoorService, this.HornService, this.LightsService, this.ConditioningService];
    }
  };
}