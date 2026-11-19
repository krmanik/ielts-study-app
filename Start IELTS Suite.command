#!/bin/bash
# Double-click to start the IELTS Study Suite (opens http://localhost:8765 in your browser).
# Keep this window open while studying; close it to stop the app.
cd "$(dirname "$0")/app" || exit 1
exec python3 serve.py 8765
