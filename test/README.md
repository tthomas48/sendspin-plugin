# Test Suite

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Structure

- `audio-capture.test.js` - Tests for AudioCapture module
- `audio-encoder.test.js` - Tests for AudioEncoder module
- `audio-streamer.test.js` - Tests for AudioStreamer integration
- `sendspin-server-integration.test.js` - Tests for plugin integration
- `helpers.js` - Test utilities and mocks

## Test Coverage

### Unit Tests
- ✅ AudioCapture constructor and configuration
- ✅ AudioEncoder initialization and encoding
- ✅ AudioStreamer lifecycle management
- ✅ Plugin controller integration

### Integration Tests
- ⚠️ Audio capture (requires system audio tools)
- ⚠️ Audio encoding (requires codec libraries)
- ⚠️ Full pipeline (requires Sendspin server)

## Mocking

Tests use Jest mocks for:
- File system operations
- Child processes (audio capture)
- External dependencies
- Sendspin server (when not built)

## Notes

- Some tests require system dependencies (parec, arecord) to be available
- Integration tests may need actual Volumio environment
- Audio encoding tests are placeholders until encoders are implemented



