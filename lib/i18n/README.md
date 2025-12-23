# Translation Files

This directory contains translation files for the Sendspin plugin UI.

## File Structure

- `strings_en.json` - English translations (required)

## Adding Translations

To add support for additional languages, create new files following the pattern:
- `strings_<language_code>.json` (e.g., `strings_de.json` for German, `strings_fr.json` for French)

## Translation Keys

All translation keys follow the pattern: `TRANSLATE.SENDSPIN.<KEY>`

### Available Keys

- `PAGE_LABEL` - Plugin page label
- `PAGE_TITLE` - Plugin page title
- `PAGE_DESCRIPTION` - Plugin page description
- `SECTION_GENERAL` - General settings section label
- `BUTTON_SAVE` - Save button label
- `ENABLED_LABEL` - Enable switch label
- `ENABLED_DOC` - Enable switch description
- `PORT_LABEL` - Port input label
- `PORT_DOC` - Port input description
- `DEVICE_NAME_LABEL` - Device name input label
- `DEVICE_NAME_DOC` - Device name input description
- `DEVICE_NAME_PLACEHOLDER` - Device name placeholder text
- `CAPTURE_METHOD_LABEL` - Capture method select label
- `CAPTURE_METHOD_DOC` - Capture method description
- `CAPTURE_METHOD_AUTO` - Auto-detect option
- `CAPTURE_METHOD_PULSE` - PulseAudio option
- `CAPTURE_METHOD_ALSA` - ALSA option
- `CODEC_LABEL` - Codec select label
- `CODEC_DOC` - Codec description
- `CODEC_OPUS` - Opus codec option
- `CODEC_FLAC` - FLAC codec option
- `CODEC_PCM` - PCM codec option

## Usage

Volumio's i18n system automatically loads these translation files when the plugin is loaded. The `TRANSLATE.*` strings in `UIConfig.json` are automatically replaced with the appropriate translations based on the user's language setting.

## Contributing Translations

If you'd like to contribute translations for additional languages, please:
1. Create a new `strings_<language_code>.json` file
2. Copy the structure from `strings_en.json`
3. Translate all string values
4. Submit a pull request



