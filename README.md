# Edition Tracker

Source for [editiontracker.com](https://editiontracker.com): special edition consoles, controllers, games and collectibles, with release dates, prices and where to buy.

- `data/releases.json` holds every release. The site is built from it and published with GitHub Pages.
- A scheduled news check reads public news feeds and proposes updates as pull requests. Nothing is published until a pull request is reviewed and merged.

## Preorder dates

A release can carry `preordersStart`, the date its preorders are announced to open (the news check fills it in). The release page shows "Opens <date>". On that day the **Preorder dates** action opens a pull request switching it to "Preorders open"; it never merges, so check the store and merge it yourself.

## Alerts

Every page has a "Get alerts" form (Buttondown). Each box a subscriber ticks becomes a Buttondown tag: `type:nintendo`, `type:playstation` and so on for a whole category, or `item:<id>` for one release.

After each change to `main` goes live, `scripts/alerts.mjs` compares the old and new `data/releases.json` and emails only the people who asked:

- New release: its category's subscribers.
- Status change, new release date, preorders opening: that release's subscribers and its category's.
- Price change or new timeline entry: that release's subscribers.

The form also has a "Weekly roundup" box (tag `roundup`), ticked by default. Every Thursday the **Weekly roundup** action drafts an email in Buttondown listing everything that changed in the last 7 days, addressed only to subscribers with that tag. It stays a draft until you send it from Buttondown. Subscribers can untick it later from the manage link in any email.

It needs the `BUTTONDOWN_API_KEY` repository secret and Buttondown's Tags add-on. Put `[no alerts]` in a commit message to skip a push, and anything that changes more than 8 releases at once is treated as a bulk edit and not sent.

## Social posts

After each change to `main` goes live, `scripts/social.mjs` posts release news to Bluesky and X: new releases, and big changes (preorders opening, a release date, out now, sold out). Posts are built from the data with fixed wording and link to the release page. Price changes, timeline notes and rumors aren't posted, except timeline notes about stock (a restock, extra units, a new wave), which are posted as "Stock news". `[no alerts]` or `[no posts]` in a commit message skips posting, and so does any change touching more than 8 releases.

The **Scheduled posts** action also posts "Out today" for each release on its release day, and on Thursdays a "Coming out this week" list linking the calendar. It tries hourly from 9am New York time and posts once a day. The **Post to social** action posts a message of your own.

Bluesky needs the `BLUESKY_APP_PASSWORD` secret (the handle is in `site.config.json`). X needs `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`. Without them the step only logs what it would post.

Edition Tracker isn't affiliated with Nintendo, Sony, Microsoft or any store.

Fonts: [Barlow](https://github.com/jpt/barlow), under the SIL Open Font License (see `static/fonts/OFL.txt`).
