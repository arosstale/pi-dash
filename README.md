# pi-dash
Live TUI dashboard widget for Pi. Shows tokens, context %, uptime, tool stats above the editor.
## Install
```bash
pi install npm:@artale/pi-dash
```
## Commands
```
/dash            — toggle on/off
/dash expand     — show detailed stats
/dash reset      — reset counters
```
Auto-updates on every message and tool call. Uses `ctx.ui.setWidget()` for persistent display.
## License
MIT
