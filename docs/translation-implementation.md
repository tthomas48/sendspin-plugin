# Translation Implementation

## Overview

The Sendspin plugin now uses Volumio's i18n (internationalization) system for all UI strings, following the [Volumio UI Configuration documentation](https://developers.volumio.com/plugins/uiconfig-json#the-uiconfigjson-file).

## Implementation

### 1. UIConfig.json

All static strings have been replaced with `TRANSLATE.*` commands:

```json
{
  "page": {
    "label": "TRANSLATE.SENDSPIN.PAGE_LABEL",
    "title": "TRANSLATE.SENDSPIN.PAGE_TITLE",
    "description": "TRANSLATE.SENDSPIN.PAGE_DESCRIPTION"
  }
}
```

### 2. Translation Files

Translation files are located in `lib/i18n/`:
- `strings_en.json` - English translations (required)

### 3. Translation Structure

All translation keys follow the pattern: `TRANSLATE.SENDSPIN.<KEY>`

Example structure:
```json
{
  "SENDSPIN": {
    "PAGE_LABEL": "Sendspin",
    "PAGE_TITLE": "Sendspin Audio Streaming",
    "PAGE_DESCRIPTION": "Configure Sendspin audio streaming settings",
    ...
  }
}
```

## Available Translation Keys

### Page
- `PAGE_LABEL` - Plugin page label
- `PAGE_TITLE` - Plugin page title
- `PAGE_DESCRIPTION` - Plugin page description

### General Section
- `SECTION_GENERAL` - General settings section label
- `BUTTON_SAVE` - Save button label

### Settings
- `ENABLED_LABEL` / `ENABLED_DOC` - Enable switch
- `PORT_LABEL` / `PORT_DOC` - WebSocket port
- `DEVICE_NAME_LABEL` / `DEVICE_NAME_DOC` / `DEVICE_NAME_PLACEHOLDER` - Device name
- `CAPTURE_METHOD_LABEL` / `CAPTURE_METHOD_DOC` - Audio capture method
  - `CAPTURE_METHOD_AUTO` - Auto-detect option
  - `CAPTURE_METHOD_PULSE` - PulseAudio option
  - `CAPTURE_METHOD_ALSA` - ALSA option
- `CODEC_LABEL` / `CODEC_DOC` - Preferred codec
  - `CODEC_OPUS` - Opus codec
  - `CODEC_FLAC` - FLAC codec
  - `CODEC_PCM` - PCM codec

## Adding New Languages

To add support for additional languages:

1. Create a new file: `lib/i18n/strings_<language_code>.json`
   - Example: `strings_de.json` for German
   - Example: `strings_fr.json` for French

2. Copy the structure from `strings_en.json`

3. Translate all string values

4. Volumio will automatically use the appropriate translation based on the user's language setting

## How It Works

1. Volumio's i18n system loads translation files from `lib/i18n/`
2. When `getUIConfig()` is called, Volumio automatically replaces `TRANSLATE.*` strings with the appropriate translations
3. The user's language preference determines which translation file is used
4. If a translation is missing, Volumio falls back to English

## Benefits

- ✅ **Easy to translate**: All strings are in JSON files
- ✅ **Automatic**: Volumio handles translation replacement
- ✅ **Extensible**: Add new languages by creating new files
- ✅ **Maintainable**: All translations in one place
- ✅ **Compliant**: Follows Volumio best practices

## Testing

All compliance tests pass:
- ✅ Translation structure verified
- ✅ TRANSLATE strings in UIConfig.json
- ✅ Translation files present
- ✅ All 61 tests passing

## References

- [Volumio UI Configuration Documentation](https://developers.volumio.com/plugins/uiconfig-json#the-uiconfigjson-file)
- [Translation Section](https://developers.volumio.com/plugins/uiconfig-json#translating-text)



