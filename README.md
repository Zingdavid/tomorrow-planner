# Tomorrow Planner

An installable web app (PWA) for planning the next day around a fixed daily rhythm: tasks attached to time blocks, a Big Three, deadlines with countdowns, carry-forward of unfinished tasks, and a night examen.

- Works offline after the first visit.
- Plans are stored in the browser on each device (localStorage). Nothing leaves the device unless you turn on sync.
- Optional sync between devices through a secret GitHub gist (each device connects with a gist-only token).
- Backup files: **Save backup file** / **Open backup file** (merges by task).

## Install on Android

Open the site in Chrome, then tap **⋮ → Add to Home screen → Install**.

## Tasks from email

`email-sync/Code.gs` is a Google Apps Script that turns starred emails (or emails labelled "Planner") into planner tasks. Install it once in each Gmail account; every 15 minutes it adds new emails to the sync gist as tasks under "Anytime" on today (or the next weekday after 15:00), each with a ✉ link back to the email. Setup steps are at the top of the file. The GitHub token and gist id live in the script's properties, never in this repo.
