/* eslint-disable */
import { PlatformAccessory, Service } from 'homebridge';
import { DreoPlatform } from '../platform';
import { BaseAccessory } from './BaseAccessory';

interface DreoStateReport {
  poweron?: boolean;      // Active
  mode?: number;          // Mode 0-2 [manual, auto, sleep]
  suspend?: boolean;      // Suspended
  rh?: number;            // Current humidity
  hotfogon?: boolean;     // Hot fog on
  foglevel?: number;      // Fog level 0-6 [0: off, 1-6: levels]
  rhautolevel?: number;   // Target humidity level in auto mode
  rhsleeplevel?: number;  // Target humidity level in sleep mode
  ledlevel?: number;      // LED indicator level 0-2 [off, low, high]
  rgblevel?: string;      // RGB display level 0-2 [off, low, high]
  muteon?: boolean;       // Beep on/off
  wrong?: number;         // Error code 0-1 [0: no error, 1: no water]
  worktime?: number;      // Work time in minutes after last cleaning
}

interface DreoMessage {
  devicesn?: string;      // Device serial number
  method?: string;        // API method (e.g., control-report, control-reply, report)
  reported?: DreoStateReport; // Reported state of the device
}

interface DreoState {
  poweron: {state: boolean};
  mode: {state: number};
  suspend: {state: boolean};
  rh: {state: number};
  hotfogon: {state: boolean};
  ledlevel: {state: number};
  rgblevel: {state: string};
  foglevel: {state: number};
  rhautolevel: {state: number};
  rhsleeplevel: {state: number};
  wrong: {state: number};
}

const MAX_HUMIDITY = 90.0; // Maximum humidity level for HomeKit.
const MIN_HUMIDITY = 30.0; // Minimum humidity level for HomeKit.
const DEFAULT_HUMIDITY = 45.0; // Default humidity level for HomeKit if not specified.

export class HumidifierAccessory extends BaseAccessory {
  private readonly humidifierService: Service;
  private readonly humidityService: Service;
  private readonly sleepSwitchService: Service;
  private readonly hotFogSwitchService: Service;

  // Cached copy of latest device states
  private on: boolean;        // poweron
  private deroMode: number;   // mode 0-2       [manual, auto, sleep]
  private suspended: boolean; // suspend
  private currentHum: number; // rh
  private fogHot: boolean;    // hotfogon
  private ledLevel: number;   // ledlevel 0-2   [off, low, high]
  private rgbLevel: string;   // rgblevel 0-2   [off, low, high]
  private wrong: number;      // wrong 0-1      [0: no error, 1: no water]

  private manualFogLevel: number;         // foglevel 0-6   [1-, 1, 2-, 2, 3-, 3]
  private targetHumAutoLevel: number;     // rhautolevel
  private targetHumSleepLevel: number;    // rhsleeplevel

  // HomeKit
  private currState: number;  // State in HomeKit {0: inactive, 1: idle, 2: humidifying, 3: dehumidifying}

  constructor(
    readonly platform: DreoPlatform,
    readonly accessory: PlatformAccessory,
    private readonly state: DreoState,
  ) {
    // Call base class constructor
    super(platform, accessory);

    // Update current state in homebridge from Dreo API
    this.on = state.poweron.state;
    this.deroMode = state.mode.state;
    this.suspended = state.suspend.state;
    this.currentHum = state.rh.state;
    this.fogHot = state.hotfogon.state || false;
    this.ledLevel = state.ledlevel.state;
    this.rgbLevel = state.rgblevel.state;
    this.wrong = state.wrong.state || 0;
    this.manualFogLevel = state.foglevel.state || 0;
    this.targetHumAutoLevel = state.rhautolevel.state || DEFAULT_HUMIDITY;
    this.targetHumSleepLevel = state.rhsleeplevel.state || DEFAULT_HUMIDITY;

    this.currState = this.on ? (this.suspended ? 1 : 2) : 0;

    const deviceName = accessory.context.device.deviceName || 'Humidifier';
    // Get the HumidifierDehumidifier service if it exists, otherwise create a new HumidifierDehumidifier service
    this.humidifierService = this.accessory.getService(this.platform.Service.HumidifierDehumidifier) ||
      this.accessory.addService(this.platform.Service.HumidifierDehumidifier, deviceName);
    // Get the HumiditySensor service if it exists, otherwise create a new HumiditySensor service
    this.humidityService = this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor, 'Humidity Sensor');
    // Get the Switch service if it exists, otherwise create a new Switch service
    this.sleepSwitchService = this.accessory.getServiceById(this.platform.Service.Switch, 'SleepMode') ||
      this.accessory.addService(this.platform.Service.Switch, 'Sleep Mode', 'SleepMode');
    this.hotFogSwitchService = this.accessory.getServiceById(this.platform.Service.Switch, 'HotFog') ||
      this.accessory.addService(this.platform.Service.Switch, 'Warm Mist', 'HotFog');

    // ON / OFF
    // Register handlers for the Humidifier Active characteristic
    this.humidifierService.getCharacteristic(this.platform.Characteristic.Active)
    .onGet(this.getActive.bind(this))
    .onSet(this.setActive.bind(this));
    this.sleepSwitchService.getCharacteristic(this.platform.Characteristic.On)
    .onGet(this.getSleepMode.bind(this))
    .onSet(this.setSleepMode.bind(this));
    this.hotFogSwitchService.getCharacteristic(this.platform.Characteristic.On)
    .onGet(this.getHotFog.bind(this))
    .onSet(this.setHotFog.bind(this));

    // Register handlers for Current Humidifier State characteristic
    // Disabling dehumidifying as it is not supported
    /**
     * 0: Inactive      (Dero Off)
     * 1: Idle          (Dero On & Dero Suspended)
     * 2: Humidifying   (Dero On & Dero Not Suspended)
     * 3: Dehumidifying (Not supported - DISABLE IT)
     */
    this.humidifierService.getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
    .setProps({
      minValue: 0,
      maxValue: 2,
      validValues: [0, 1, 2],
    })
    .onGet(this.getCurrentHumidifierState.bind(this));

    // Register handlers for Current Humidifier Water Level characteristic
    this.humidifierService.getCharacteristic(this.platform.Characteristic.WaterLevel)
    .onGet(this.getCurrentHumidifierWaterLevel.bind(this));

    // Register handlers for Target Humidifier Mode characteristic
    /**
     * 0: Auto (Dero Manual)
     * 1: Humidifier (Dero Auto)
     * 2: Dehumidifier (Dero Sleep)
     */
    this.humidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
    .setProps({
      minValue: 0,
      maxValue: 1,
      validValues: [0, 1],
    })
    .onGet(this.getTargetHumidifierMode.bind(this))
    .onSet(this.setTargetHumidifierMode.bind(this));

    // Set RelativeHumidityHumidifierThreshold
    this.humidifierService.getCharacteristic(this.platform.Characteristic.RelativeHumidityHumidifierThreshold)
    .setProps({
      minValue: MIN_HUMIDITY,
      maxValue: MAX_HUMIDITY,
      minStep: 1,
    })
    .onGet(this.getTargetHumidity.bind(this))
    .onSet(this.setTargetHumidity.bind(this));

    // Register handlers for Current Humidity characteristic
    this.humidifierService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
    .onGet(this.getCurrentHumidity.bind(this));
    this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
    .onGet(this.getCurrentHumidity.bind(this));

    // Register handlers for manual fog level characteristic
    this.humidifierService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
    .setProps({
      minValue: 0,
      maxValue: 6,
      validValues: [0, 1, 2, 3, 4, 5, 6], // [0: off, 1-6: fog levels]
    })
    .onGet(this.getTargetFogLevel.bind(this))
    .onSet(this.setTargetFogLevel.bind(this));

    // Update values from Dreo App
    platform.webHelper.addEventListener('message', (message: MessageEvent) => {
      let data: DreoMessage;
      try {
        data = JSON.parse(message.data);
        if (data.devicesn === accessory.context.device.sn) {
          this.platform.log.debug('Incoming message for %s: %s', accessory.displayName, message.data); // Log incoming message
          if (data.method && ['control-report', 'control-reply', 'report'].includes(data.method) && data.reported) {
            Object.keys(data.reported).forEach(key => this.processReportedKey(key, data.reported!));
          }
        }
      } catch (error) {
        this.platform.log.error('Failed to parse incoming message: %s', error);
      }
    });
  }

  getActive(): boolean {
    this.platform.log.debug('GET Active:', this.on);
    return this.on;
  }

  setActive(value: unknown): void {
    const isActive = Boolean(value);
    this.platform.log.info('Triggered SET Active: %s (current: %s)', isActive, this.on);
    // Check state to prevent duplicate requests
    if (this.on !== isActive) {
      this.platform.log.info('Sending SET Active command: %s', isActive);
      // Send to Dreo server via websocket
      this.platform.webHelper.control(this.sn, {'poweron': isActive});
      // Update local state immediately for responsiveness, Dreo report will confirm later
      this.on = isActive;
      this.updateCurrentHumidifierState(); // Update dependent states
    } else {
      this.platform.log.debug('SET Active: Value %s is already set. No command sent.', isActive);
    }
  }

  getSleepMode(): boolean {
    const isSleepMode = this.on && this.deroMode === 2;
    this.platform.log.debug('GET SleepMode:', isSleepMode);
    return isSleepMode;
  }

  setSleepMode(value: unknown): void {
    const isSleepMode = Boolean(value);
    const currentSleepMode = this.on && this.deroMode === 2;
    this.platform.log.info('Triggered SET SleepMode: %s (current: %s)', isSleepMode, currentSleepMode);

    if (isSleepMode === currentSleepMode) {
      this.platform.log.debug('SET SleepMode: Value %s is already set. No command sent.', isSleepMode);
      return;
    }

    let command: {};
    if (isSleepMode) {
      const newMode = 2; // Sleep mode
      if (this.on) {
        this.platform.log.info('Sending SET SleepMode command (already on): mode=%s', newMode);
        command = {'mode': newMode};
      } else {
        this.platform.log.info('Sending SET SleepMode command (turning on): poweron=true, mode=%s', newMode);
        command = {'poweron': true, 'mode': newMode}; // Power on the humidifier
        // Update local state immediately
        this.on = true;
        this.humidifierService.updateCharacteristic(this.platform.Characteristic.Active, true);
      }
      // Update local state immediately
      this.deroMode = newMode;
      // Update HomeKit target state after a delay to reflect mode change
      setTimeout(() => {
        this.humidifierService.updateCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState, 1); // HomeKit Humidifier state
      }, 750);
    } else { // Turning sleep mode OFF (switch to Manual)
      const newMode = 0; // Manual mode
      this.platform.log.info('Sending SET SleepMode OFF command (switching to manual): mode=%s', newMode);
      command = {'mode': newMode};
      // Update local state immediately
      this.deroMode = newMode;
      // Update HomeKit target state after a delay
      if (this.on) { // Only update target state if humidifier remains on
        setTimeout(() => {
          this.humidifierService.updateCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState, 0); // HomeKit Auto state (maps to Dreo Manual)
        }, 750);
      }
    }
    this.platform.webHelper.control(this.sn, command);
    this.updateCurrentHumidifierState(); // Update dependent states
  }

  getHotFog(): boolean {
    const isHotFog = this.on && this.fogHot;
    this.platform.log.debug('GET HotFog:', isHotFog);
    return isHotFog;
  }

  setHotFog(value: unknown): void {
    const isHotFog = Boolean(value);
    const currentHotFog = this.on && this.fogHot;
    this.platform.log.info('Triggered SET HotFog: %s (current: %s)', isHotFog, currentHotFog);

    if (isHotFog === currentHotFog) {
      this.platform.log.debug('SET HotFog: Value %s is already set. No command sent.', isHotFog);
      return;
    }

    let command: {};
    if (this.on) {
      this.platform.log.info('Sending SET HotFog command (already on): hotfogon=%s', isHotFog);
      command = {'hotfogon': isHotFog};
    } else {
      this.platform.log.info('Sending SET HotFog command (turning on): poweron=true, hotfogon=%s', isHotFog);
      command = {'poweron': true, 'hotfogon': isHotFog};
      // Update local state immediately
      this.on = true;
      this.humidifierService.updateCharacteristic(this.platform.Characteristic.Active, true);
    }
    // Update local state immediately
    this.fogHot = isHotFog;
    this.platform.webHelper.control(this.sn, command);
    this.updateCurrentHumidifierState(); // Update dependent states
  }

  getCurrentHumidifierState() {
    // Determine state based on local cache
    this.currState = this.on ? (this.suspended ? 1 : 2) : 0;
    this.platform.log.debug('GET CurrentHumidifierState: %s (on=%s, suspended=%s)', this.currState, this.on, this.suspended);
    return this.currState;
  }

  getCurrentHumidifierWaterLevel() {
    const waterLevel = this.wrong === 1 ? 0 : 100;
    this.platform.log.debug('GET WaterLevel: %s (wrong=%s)', waterLevel, this.wrong);
    return waterLevel;
  }

  setTargetHumidifierMode(value: unknown): void {
    // HomeKit 0 = Auto (Dreo Manual 0)
    // HomeKit 1 = Humidifier (Dreo Auto 1)
    // NOTE: Dreo Sleep (2) is handled by the SleepMode switch, which sets Dreo mode but keeps HomeKit mode as 1 (Humidifier)
    const targetMode = Number(value); // 0 or 1
    const currentTargetMode = this.deroMode === 2 ? 1 : this.deroMode; // Map Dreo sleep(2) to HomeKit Humidifier(1)

    this.platform.log.info('Triggered SET TargetHumidifierState: %s (current dreoMode: %s, current HK target: %s)', targetMode, this.deroMode, currentTargetMode);

    if (targetMode === currentTargetMode) {
      this.platform.log.debug('SET TargetHumidifierState: Value %s is already set. No command sent.', targetMode);
      return;
    }

    // If currently in sleep mode, turning off sleep mode via this control should revert to Manual (0)
    if (this.deroMode === 2 && targetMode === 0) {
      this.platform.log.info('Switching from Sleep to Manual via TargetHumidifierState');
      this.setSleepMode(false); // This will handle sending the command and updating state
      return;
    }

    // If setting to Auto(0) or Humidifier(1) and not currently in sleep mode
    if (this.deroMode !== 2) {
      const newDreoMode = targetMode; // Direct mapping works here (0 -> 0, 1 -> 1)
      this.platform.log.info('Sending SET TargetHumidifierState command: mode=%s', newDreoMode);
      this.platform.webHelper.control(this.sn, {'mode': newDreoMode});
      // Update local state immediately
      this.deroMode = newDreoMode;
      // If sleep switch was on, turn it off
      if (this.sleepSwitchService.getCharacteristic(this.platform.Characteristic.On).value) {
        this.sleepSwitchService.updateCharacteristic(this.platform.Characteristic.On, false);
      }
      this.updateCurrentHumidifierState(); // Update dependent states
    }
  }

  getTargetHumidifierMode(): number {
    // Map Dreo modes to HomeKit Target States
    // Dreo Manual (0) -> HomeKit Auto (0)
    // Dreo Auto (1) -> HomeKit Humidifier (1)
    // Dreo Sleep (2) -> HomeKit Humidifier (1) (Sleep is controlled by separate switch)
    const targetMode = this.deroMode === 0 ? 0 : 1;
    this.platform.log.debug('GET TargetHumidifierState: %s (dreoMode=%s)', targetMode, this.deroMode);
    return targetMode;
  }

  getCurrentHumidity(): number {
    this.platform.log.debug('GET CurrentRelativeHumidity:', this.currentHum);
    return this.currentHum;
  }

  // Target humidity can be set in auto and sleep modes
  setTargetHumidity(value: unknown): void {
    const requestedValue = Number(value);
    // Clamp the requested value between MIN and MAX *before* sending
    const targetValue = Math.min(MAX_HUMIDITY, Math.max(MIN_HUMIDITY, requestedValue));
    this.platform.log.debug(`SET TargetHumidity: Requested=${requestedValue}, Clamped=${targetValue}, CurrentMode=${this.deroMode}`);

    if (this.deroMode === 0) { // manual
      this.platform.log.warn(`WARN: Attempted to SET TargetHumidity (${targetValue}) while in Manual mode. No command sent.`);
    } else if (this.deroMode === 1) { // auto
      if (this.targetHumAutoLevel !== targetValue) { // Check if value actually changed
        this.platform.log.info(`Sending SET TargetHumidity (Auto) command: ${targetValue}`);
        this.platform.webHelper.control(this.sn, {'rhautolevel': targetValue});
        // Update local state immediately
        this.targetHumAutoLevel = targetValue;
      } else {
        this.platform.log.debug(`SET TargetHumidity (Auto): Value ${targetValue} is already set. No command sent.`);
      }
    } else if (this.deroMode === 2) { // sleep
      if (this.targetHumSleepLevel !== targetValue) { // Check if value actually changed
        this.platform.log.info(`Sending SET TargetHumidity (Sleep) command: ${targetValue}`);
        this.platform.webHelper.control(this.sn, {'rhsleeplevel': targetValue});
        // Update local state immediately
        this.targetHumSleepLevel = targetValue;
      } else {
        this.platform.log.debug(`SET TargetHumidity (Sleep): Value ${targetValue} is already set. No command sent.`);
      }
    }
  }

  getTargetHumidity(): number {
    let threshold: number;
    switch (this.deroMode) {
      case 1: // auto
        threshold = this.targetHumAutoLevel;
        break;
      case 2: // sleep
        threshold = this.targetHumSleepLevel;
        break;
      default: // manual or unknown
        // Return the threshold for Auto mode as a sensible default when manual is active
        threshold = this.targetHumAutoLevel || DEFAULT_HUMIDITY;
        break;
    }
    // Ensure the value is clamped between MIN and MAX before returning
    const clampedThreshold = Math.min(MAX_HUMIDITY, Math.max(MIN_HUMIDITY, threshold || DEFAULT_HUMIDITY));
    this.platform.log.debug(`GET TargetHumidity: Mode=${this.deroMode}, RawThreshold=${threshold}, ClampedThreshold=${clampedThreshold}`);
    return clampedThreshold;
  }

  // Can only be set in manual mode
  setTargetFogLevel(value: unknown): void {
    const targetFogLevel = Number(value);
    this.platform.log.info('Triggered SET TargetFogLevel: %s (current: %s, mode: %s)', targetFogLevel, this.manualFogLevel, this.deroMode);

    if (this.manualFogLevel === targetFogLevel && this.deroMode === 0) {
      this.platform.log.debug('SET TargetFogLevel: Value %s is already set in Manual mode. No command sent.', targetFogLevel);
      return;
    }

    if (targetFogLevel === 0) { // If manual fog level is set to 0, turn off the humidifier
      this.platform.log.info('SET TargetFogLevel: Received 0, turning off humidifier.');
      this.setActive(false); // Use setActive to turn off
      // Update local state immediately
      this.manualFogLevel = 0;
      return;
    }

    // If not currently in manual mode, switch to manual mode first
    if (this.deroMode !== 0) {
      this.platform.log.warn('WARN: Switching to manual mode to set fog level. Current mode: %s', this.deroMode);
      this.platform.webHelper.control(this.sn, {'mode': 0, 'foglevel': targetFogLevel});
      // Update local state immediately
      this.deroMode = 0;
      this.manualFogLevel = targetFogLevel;
      // Update HomeKit target state
      this.humidifierService.updateCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState, 0); // HomeKit Auto state
      // If sleep switch was on, turn it off
      if (this.sleepSwitchService.getCharacteristic(this.platform.Characteristic.On).value) {
        this.sleepSwitchService.updateCharacteristic(this.platform.Characteristic.On, false);
      }
    } else { // Already in manual mode
      this.platform.log.info('Sending SET TargetFogLevel command (Manual mode): %s', targetFogLevel);
      this.platform.webHelper.control(this.sn, {'foglevel': targetFogLevel});
      // Update local state immediately
      this.manualFogLevel = targetFogLevel;
    }
    this.updateCurrentHumidifierState(); // Update dependent states
  }

  getTargetFogLevel(): number {
    // Return 0 if humidifier is off, otherwise return manual fog level
    const fogLevel = this.on ? this.manualFogLevel : 0;
    this.platform.log.debug('GET TargetFogLevel: %s (on=%s, manualFogLevel=%s)', fogLevel, this.on, this.manualFogLevel);
    return fogLevel;
  }

  private updateCurrentHumidifierState() {
    // Update HomeKit current humidifier state based on power and suspend states
    const newState = this.on ? (this.suspended ? 1 : 2) : 0;
    if (this.currState !== newState) {
      this.currState = newState;
      this.platform.log.info('Updating CurrentHumidifierState: %s (on=%s, suspended=%s)', this.currState, this.on, this.suspended);
      this.humidifierService.updateCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState, this.currState);
    }
    // Update switches based on current state
    this.sleepSwitchService.updateCharacteristic(this.platform.Characteristic.On, this.getSleepMode());
    this.hotFogSwitchService.updateCharacteristic(this.platform.Characteristic.On, this.getHotFog());
  }

  /**
   * Updates the HomeKit TargetHumidifierDehumidifierState characteristic based on the Dreo mode.
   * Dreo Manual (0) -> HomeKit Auto (0)
   * Dreo Auto (1) -> HomeKit Humidifier (1)
   * Dreo Sleep (2) -> HomeKit Humidifier (1)
   */
  private updateTargetHumidifierState(newDreoMode: number) {
    const newTargetState = newDreoMode === 0 ? 0 : 1;
    const currentTargetState = this.humidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState).value;

    this.platform.log.debug('Updating TargetHumidifierState based on Dreo mode %s. New HK Target: %s', newDreoMode, newTargetState);

    if (currentTargetState !== newTargetState) {
      this.humidifierService.updateCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState, newTargetState);
    }
    // Update sleep switch status
    this.sleepSwitchService.updateCharacteristic(this.platform.Characteristic.On, this.getSleepMode());
  }

  private processReportedKey(key: string, reported: DreoStateReport): void {
    this.platform.log.debug(`Processing reported key: ${key}, value: ${reported[key]}`);
    switch (key) {
      case 'poweron':
        const powerOn = reported.poweron;
        if (powerOn !== undefined && this.on !== powerOn) {
          this.on = powerOn;
          this.platform.log.info('REPORTED Humidifier power: %s', this.on);
          this.humidifierService.updateCharacteristic(this.platform.Characteristic.Active, this.on);
          this.updateCurrentHumidifierState(); // Update dependent states
        }
        break;
      case 'mode':
        const mode = reported.mode;
        if (mode !== undefined && this.deroMode !== mode) {
          this.deroMode = mode;
          this.platform.log.info('REPORTED Humidifier mode: %s', this.deroMode);
          this.updateTargetHumidifierState(this.deroMode); // Update HK target state
          this.updateCurrentHumidifierState(); // Update dependent states like switches
        }
        break;
      case 'suspend':
        const suspend = reported.suspend;
        if (suspend !== undefined && this.suspended !== suspend) {
          this.suspended = suspend;
          this.platform.log.info('REPORTED Humidifier suspended: %s', this.suspended);
          this.updateCurrentHumidifierState(); // Update current state based on suspend
        }
        break;
      case 'rh':
        const rh = reported.rh;
        if (rh !== undefined && this.currentHum !== rh) {
          this.currentHum = rh;
          this.platform.log.info('REPORTED Humidifier humidity: %s', this.currentHum);
          this.humidifierService.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.currentHum);
          this.humidityService.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.currentHum);
        }
        break;
      case 'hotfogon':
        const hotFogOn = reported.hotfogon;
        if (hotFogOn !== undefined && this.fogHot !== hotFogOn) {
          this.fogHot = hotFogOn;
          this.platform.log.info('REPORTED Humidifier hotfogon: %s', this.fogHot);
          this.hotFogSwitchService.updateCharacteristic(this.platform.Characteristic.On, this.getHotFog());
        }
        break;
      case 'foglevel':
        const fogLevel = reported.foglevel;
        if (fogLevel !== undefined && this.manualFogLevel !== fogLevel) {
          this.manualFogLevel = fogLevel;
          this.platform.log.info('REPORTED Humidifier manualFogLevel: %s', this.manualFogLevel);
          // Fog level can change even when not in manual mode (e.g., auto mode adjusts it).
          // Update the characteristic regardless of mode.
          this.humidifierService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getTargetFogLevel());
        }
        break;
      case 'rhautolevel':
        const rawAutoLevel = reported.rhautolevel;
        if (rawAutoLevel !== undefined && this.targetHumAutoLevel !== rawAutoLevel) {
          this.targetHumAutoLevel = rawAutoLevel;
          this.platform.log.info(`REPORTED TargetHumidity (Auto): ${this.targetHumAutoLevel}`);
          if (this.deroMode === 1) { // Only update threshold characteristic if currently in Auto mode
            // Ensure the updated value is clamped between MIN and MAX
            const valueToUpdate = Math.min(MAX_HUMIDITY, Math.max(MIN_HUMIDITY, this.targetHumAutoLevel || DEFAULT_HUMIDITY));
            this.platform.log.debug(`Updating HomeKit TargetHumidity (Auto) Characteristic to: ${valueToUpdate}`);
            this.humidifierService
            .updateCharacteristic(this.platform.Characteristic.RelativeHumidityHumidifierThreshold, valueToUpdate);
          }
        }
        break;
      case 'rhsleeplevel':
        const rawSleepLevel = reported.rhsleeplevel;
        if (rawSleepLevel !== undefined && this.targetHumSleepLevel !== rawSleepLevel) {
          this.targetHumSleepLevel = rawSleepLevel;
          this.platform.log.info(`REPORTED TargetHumidity (Sleep): ${this.targetHumSleepLevel}`);
          if (this.deroMode === 2) { // Only update threshold characteristic if currently in Sleep mode
            // Ensure the updated value is clamped between MIN and MAX
            const valueToUpdate = Math.min(MAX_HUMIDITY, Math.max(MIN_HUMIDITY, this.targetHumSleepLevel || DEFAULT_HUMIDITY));
            this.platform.log.debug(`Updating HomeKit TargetHumidity (Sleep) Characteristic to: ${valueToUpdate}`);
            this.humidifierService
            .updateCharacteristic(this.platform.Characteristic.RelativeHumidityHumidifierThreshold, valueToUpdate);
          }
        }
        break;
      case 'wrong':
        const wrong = reported.wrong;
        if (wrong !== undefined && this.wrong !== wrong) {
          this.wrong = wrong;
          if (this.wrong === 1) {
            this.platform.log.error('REPORTED Humidifier error: No water detected');
            this.humidifierService.updateCharacteristic(this.platform.Characteristic.WaterLevel, 0);
          } else {
            this.platform.log.info('REPORTED Humidifier error cleared.');
            this.humidifierService.updateCharacteristic(this.platform.Characteristic.WaterLevel, 100);
          }
        }
        break;
      // Ignored keys (ledlevel, rgblevel, muteon, worktime) can be added here if needed
      default:
        // Only log truly unknown keys if necessary, to reduce noise
        this.platform.log.debug('Ignoring reported key: %s', key);
        break;
    }
  }
}
