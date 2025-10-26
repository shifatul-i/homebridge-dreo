# Dreo HM311S Homebridge Plugin - Test Suite

This directory contains comprehensive tests for the Dreo HM311S humidifier Homebridge plugin, validating all the fixes and enhancements made to support the device.

## Test Files Overview

### 🧪 `test-humidity-fix.js`
**Purpose**: Tests the 90% humidity bug fix with comprehensive validation

**What it tests**:
- Humidity value validation within HomeKit range (30-90%)
- Edge case handling (null, undefined, out-of-range values)
- Proper rounding behavior (89.9% → 90%)
- Clamping functionality (100% → 90%, 29% → 30%)
- Default value handling for invalid inputs

**Expected Result**: 100% pass rate ensuring robust humidity handling

### 🏠 `test-homekit-display.js`
**Purpose**: Tests humidity value display corrections for HomeKit interface

**What it tests**:
- Device values display correctly (30% shows as 30%, not 0%)
- Full HomeKit range support (0-100% slider usability)
- User input clamping (0% input → 30% device, 100% input → 90% device)
- Transparent feedback for out-of-range values

**Expected Result**: Clear, accurate humidity percentages in HomeKit

### 💨 `test-humidifier-display.js`
**Purpose**: Tests HomeKit service name fix (shows "Humidifier" not "Humidifier-Dehumidifier")

**What it tests**:
- HomeKit characteristic configuration (validValues: [1])
- Service display logic (humidifier-only vs multi-mode)
- Mode return values (always returns 1 for humidifier)
- Proper service presentation in HomeKit interface

**Expected Result**: Device displays as "Humidifier" in HomeKit

### 🏷️ `test-model-display.sh`
**Purpose**: Tests model name display enhancement

**What it tests**:
- Model name conversion (DR-HHM001S → DR-HM311S)
- Series name parsing and display logic
- User-friendly device identification

**Expected Result**: Clear, correct model identification (DR-HM311S)

## Running Tests

### Run All Tests
```bash
cd tests
node run-tests.js
```

### Run Specific Test
```bash
cd tests
node run-tests.js humidity          # Runs humidity-related tests
node run-tests.js homekit           # Runs HomeKit display test
node run-tests.js humidifier        # Runs service display test
node run-tests.js model             # Runs model display test
```

### Run Individual Test Files
```bash
cd tests
node test-humidity-fix.js           # 90% humidity bug validation
node test-homekit-display.js        # HomeKit percentage display
node test-humidifier-display.js     # Service name display
bash test-model-display.sh          # Model name display
```

## Test Coverage

The test suite provides comprehensive validation for:

### ✅ **Humidity Control**
- Value validation and bounds checking
- Edge case handling and error recovery
- HomeKit display accuracy
- User input processing

### ✅ **HomeKit Integration**
- Service type and display names
- Characteristic properties and constraints
- User interface presentation
- Control responsiveness

### ✅ **Device Compatibility**
- Model identification and naming
- Feature detection and conditional services
- Series-specific functionality

### ✅ **User Experience**
- Clear, intuitive interfaces
- Accurate feedback and display
- Professional device presentation

## Expected Test Results

All tests should pass with 100% success rate, confirming:

1. **Humidity Bug Fixed**: 90% humidity setting works without UI glitches
2. **Display Accuracy**: 30% shows as 30%, 90% shows as 90%
3. **Service Clarity**: Device shows as "Humidifier" (not "Humidifier-Dehumidifier")
4. **Model Identity**: Device displays as "DR-HM311S" (not "DR-HHM001S")

## Troubleshooting Tests

### If Humidity Tests Fail
- Check `validateHumidityValue()` and `clampHumidityForDevice()` functions
- Verify HomeKit characteristic properties (minValue, maxValue)
- Review edge case handling for null/undefined values

### If Display Tests Fail
- Verify HomeKit characteristic range (0-100 vs 30-90)
- Check validation function usage in get/set methods
- Review characteristic properties configuration

### If Service Tests Fail
- Confirm `TargetHumidifierDehumidifierState` validValues: [1]
- Check `getTargetHumidifierMode()` returns 1 consistently
- Verify service type configuration

### If Model Tests Fail
- Check `getDisplayModel()` function in BaseAccessory
- Verify series name parsing logic
- Review device context and naming

## Adding New Tests

When adding functionality, create corresponding tests:

1. **Create test file**: `test-[feature-name].js`
2. **Add to run-tests.js**: Include in tests array
3. **Document purpose**: Add description and expected results
4. **Validate coverage**: Ensure all code paths tested

## Test Philosophy

These tests ensure the Dreo HM311S plugin provides:
- **Reliable Operation**: No bugs or edge case failures
- **Intuitive Interface**: Clear, accurate HomeKit presentation
- **Professional Quality**: Proper device identification and behavior
- **User Satisfaction**: Seamless integration with Apple HomeKit ecosystem

Run the test suite before any releases to ensure quality and reliability!
