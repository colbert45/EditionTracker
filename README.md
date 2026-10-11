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

## Restocks

When something comes back in stock at a store, log it by hand. A release can carry `restocks`, a list of `{ date, store, url, source }`: `store` is a key from `stores`, `url` is the store's own product page, `source` is where you saw it (or `null`). The release page then shows the status "Back in stock" and a "Restock history" list, and the homepage lists it first. No entries, no history section. People following that release or its category get one "Back in stock" email with the store's link first.

**From your phone:** GitHub app (or github.com) > Actions > **Post a restock** > Run workflow. Type part of the release's name (or its id) and the link to the product page. The store is read from the link, so leave the Store box blank unless it says it can't tell. Add where you saw it if you like. Tick *Dry run* first to see exactly what would happen, email included, without changing anything. A real run saves the restock to `main`, sends the email within seconds, and starts a fresh deploy. If something is wrong it changes nothing and says why on the run page.

- The link has to be on the store's own website. A store that sells from more than one site gets a `domains` list in `stores` (Xbox has `microsoft.com`). Tracking and affiliate tags (`utm_*`, `irclickid`, `tag` and so on) are removed from every link you paste, links to Amazon are refused, and the data check rejects them if they're added by hand.
- A second restock at the same store on the same day is logged once, however the link was pasted. A release that sells out and comes back the same day can be logged again after **Sold out again**.
- **Sold out again** (also under Actions) switches a release back to "Sold out" so the page stops saying "Back in stock". It emails nobody.
- **Resend restock email** (also under Actions) is only for when a restock saved but its email step failed (open that run to see). It emails for the latest change on `main` if that change is a restock. If the first email did go out it sends it twice, so check Buttondown > Emails first. Tick *Dry run* to see what it would send.
- **The news check can propose restocks too.** When a news site or subreddit reports a release back in stock at a store on the list, the daily pull request includes it as a *reported* restock: the report is its source, the log links the store's search for the release (or the store's own product page, if the report's text has one), and the status becomes "Back in stock". Merging it sends the "Reported back in stock" email, which says the report may be hours old. The release page, the homepage and the feed all say "Reported", and any restock two or more days old says it may be sold out by now. Restocks the news check proposes are the only ones it can touch: it can't choose "Back in stock" as a status, and a store's own link is only used when it appears in the report's text.

## Prices and resellers

A release page with one plain price shows "MSRP $519.99. Don't pay more." A price range, TBA and rumors get no MSRP line. If `price` isn't the MSRP (a bundle, say), set `msrp` on the release: `"msrp": "$149.99"`.

To show what resellers are asking, fill in `resale` by hand from the listings you looked at:

```json
"resale": { "low": "$800", "high": "$1,000", "checked": "2026-10-09", "where": "eBay" }
```

The page shows "Resellers are asking $800 to $1,000 on eBay (checked Oct 9, 2026). That's 54% to 92% over MSRP." The percentages are worked out from the MSRP, and only shown when the price is over it. `high` and `where` are optional. A check older than 30 days says "may be out of date". Leave `resale` out and nothing shows. Only enter what you actually saw.

## No ads, no affiliate links

The site has neither, and the validator rejects an `affiliateUrl`. What it costs to run is on the About page, from `data/costs.json` (a row with an empty `price` is hidden, so fill in "Domain name" when you know it). To show a tip link on the About page, set `support.url` in `site.config.json`; leave it empty and no link shows.

## Social posts

After each change to `main` goes live, `scripts/social.mjs` posts release news to Bluesky and X: new releases, and big changes (preorders opening, a release date, out now, sold out). Posts are built from the data with fixed wording and link to the release page. Price changes, timeline notes and rumors aren't posted, except timeline notes about stock (a restock, extra units, a new wave), which are posted as "Stock news". `[no alerts]` or `[no posts]` in a commit message skips posting, and so does any change touching more than 8 releases.

The **Scheduled posts** action also posts "Out today" for each release on its release day, and on Thursdays a "Coming out this week" list linking the calendar. It tries hourly from 9am New York time and posts once a day. The **Post to social** action posts a message of your own.

**Restocks** get their own post, whenever a restock is logged by the phone action or merged from the news check: "Back in stock: <release> at <store>", the MSRP, and a link to the release page ("Reported back in stock" for one from a news report). They go to Bluesky, and to a Discord channel when the `DISCORD_WEBHOOK_URL` secret is set. They don't go to X unless `social.restockToX` is `true` in `site.config.json`, because X charges $0.20 for every post that has a link. The phone action posts to Bluesky and Discord right after the email.

**Discord (optional).** Make a server and a read-only `#restock-alerts` channel (turn off Send Messages for everyone). Then channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL, and save that link as a repository secret named `DISCORD_WEBHOOK_URL` (repo > Settings > Secrets and variables > Actions > New repository secret). The link works like a password, so it's never printed and only a real Discord webhook link is accepted. Posts can't ping anyone. Without the secret nothing is posted to Discord.

Bluesky needs the `BLUESKY_APP_PASSWORD` secret (the handle is in `site.config.json`). X needs `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`. Without them the step only logs what it would post.

Edition Tracker isn't affiliated with Nintendo, Sony, Microsoft or any store.

Fonts: [Barlow](https://github.com/jpt/barlow), under the SIL Open Font License (see `static/fonts/OFL.txt`).
