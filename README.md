# Kinemium-Engine-Extensions
This repository houses Kinemium Engine plugins and publishes a searchable GitHub Pages catalog for them.

## Local build
Run `python scripts/generate_registry.py` to build the static Pages output into `public/`.

## Tests
```
pip install -r requirements-dev.txt
pytest --cov=scripts --cov-report=term-missing
```
