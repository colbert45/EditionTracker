# Edition Tracker

Source for [editiontracker.com](https://editiontracker.com): special edition consoles, controllers, games and collectibles, with release dates, prices and where to buy.

- `data/releases.json` holds every release. The site is built from it and published with GitHub Pages.
- A scheduled news check reads public news feeds and proposes updates as pull requests. Nothing is published until a pull request is reviewed and merged.

## Alerts

Every page has a "Get alerts" form (Buttondown). Each box a subscriber ticks becomes a Buttondown tag: `type:nintendo`, `type:playstation` and so on for a whole category, or `item:<id>` for one release.

After each change to `main` goes live, `scripts/alerts.mjs` compares the old and new `data/releases.json` and emails only the people who asked:

- New release: its category's subscribers.
- Status change, new release date, preorders opening: that release's subscribers and its category's.
- Price change or new timeline entry: that release's subscribers.

It needs the `BUTTONDOWN_API_KEY` repository secret and Buttondown's Tags add-on. Put `[no alerts]` in a commit message to skip a push, and anything that changes more than 8 releases at once is treated as a bulk edit and not sent.

Edition Tracker isn't affiliated with Nintendo, Sony, Microsoft or any store.

Fonts: [Barlow](https://github.com/jpt/barlow), under the SIL Open Font License (see `static/fonts/OFL.txt`).
