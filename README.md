# Kinemium-Engine-Extensions
This repository houses Kinemium Engine plugins and publishes a searchable GitHub Pages catalog for them.

## Local build
Run `git submodule update --init --recursive`, then `python scripts/generate_registry.py` to build the static Pages output into `public/`.

The build fails (exit code 1) when a plugin cannot be published — for example an invalid `manifest.json`, a manifest asset path that is missing or points outside the plugin directory, or an uninitialized submodule. Warnings and errors are written to stderr. Pass `--ignore-plugin-errors` to publish the plugins that did build and still exit successfully.
