# shr.rip

`shr` is a privacy-first file sharing tool for the terminal.

Share a file or folder with one command:

```bash
shr test.zip
```

You get a short link like `https://shr.rip/s/gS8M5b`.
The receiver opens it in the browser or uses `shr get <url>`.

Core idea:
- end-to-end encrypted live transfer by design
- works on your local network, even without internet
- quick live shares use a short link plus a 4-digit PIN
- local shares are frictionless by default: no PIN required
- stored shares use a stronger secret-bearing URL, are encrypted before upload, and expire after 5 days by default
- stronger protection can stay opt-in when needed

Examples:

```bash
shr test.zip
shr --local photos/
shr --keep backup.tar.zst
shr get https://shr.rip/s/gS8M5b --pin 4821
```

