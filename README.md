# Pool

A daily-allowance spending tracker. Locked bills and savings come off the top,
whatever is left is split across the days remaining in the month, and that single
number is the only one you see day to day.

## Structure

```
index.html              markup shell, loads css + the app module
css/
  base.css              design tokens, reset, typography, inputs, buttons
  components.css        cards, chips, calendar, entries, nav, tab bar
js/
  app.js                entry point: render loop, tab bar, delegated clicks
  state.js              shared mutable state object (S)
  storage.js            localStorage adapter + sGet/sSet/sDel/sList
  utils.js              formatting, dates, categories, money inputs, bill rows
  icons.js              inline SVG icon set + painter
  data.js               calc(), boot(), month load/save, cycle sweep
  views/
    wizard.js           first-run setup, three steps
    today.js            daily number, log form, day navigator
    calendar.js         month grid, stats, category breakdown
    settings.js         edit config, backup export/import, erase
```

## Running locally

ES modules need HTTP, so opening index.html directly will not work.

```
python3 -m http.server 8080
```

Then open http://localhost:8080

## Deploying

Cloudflare Pages, direct upload:

1. dash.cloudflare.com -> Workers & Pages -> Create -> Pages -> Upload assets
2. Drag this whole folder
3. Deploy

No build step. On your phone, open the URL and use Add to Home Screen.

## Data

Everything lives in localStorage under the `pool:` prefix. It is per browser and
per device, so a phone and a laptop do not share data. Use Settings -> Backup to
export a JSON file periodically.

To add real sync later, swap the four functions in `js/storage.js` to hit
Supabase. Nothing else needs to change.
