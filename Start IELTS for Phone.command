#!/bin/bash
# Double-click to start the IELTS Study Suite AND let your phone open the Test Centre.
# The window shows the address to open on the phone and the code it asks for (once).
# The phone must be on the same Wi-Fi as this Mac. Keep this window open; close it to stop.
cd "$(dirname "$0")/app" || exit 1
exec python3 serve.py 8765 --phone
