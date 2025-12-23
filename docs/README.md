# Sendspin Volumio Plugin

This directory contains documentation for developing a Volumio plugin that integrates Sendspin audio streaming capabilities.

## Overview

Sendspin is an open standard by the Open Home Foundation for synchronized music experiences across multiple devices and rooms. This plugin will enable Volumio to:

- Stream audio via Sendspin protocol
- Play audio in sync across multiple Sendspin-compatible speakers
- Offer music control and metadata
- Integrate with the Volumio audio ecosystem

## Documentation Structure

- `sendspin-research.md` - Research notes on Sendspin protocol and implementation
- `volumio-plugin-research.md` - Research notes on Volumio plugin development
- `library-evaluation.md` - Evaluation of Sendspin implementation options
- `fork-analysis.md` - **NEW** Detailed analysis of forking sendspin-js approach
- `plugin-design.md` - Plugin architecture and design decisions
- `development-plan.md` - Step-by-step development plan
- `api-reference.md` - API and integration points documentation

## Quick Links

- [Sendspin Website](https://www.sendspin-audio.com/)
- [Sendspin Specification](https://www.sendspin-audio.com/spec)
- [Volumio Plugin Documentation](https://developers.volumio.com/plugins/plugins-overview)
- [Music Assistant Discord](https://discord.gg/music-assistant) - #sendspin-beta-testing channel

## Plugin Category

Based on Volumio's plugin categories, this will likely be an **`audio_interface`** plugin, similar to Airplay, UPnP, and Bluetooth plugins, as it provides an external audio streaming source.

