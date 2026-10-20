# Edition Tracker

Source for [editiontracker.com](https://editiontracker.com): special edition consoles, controllers, games and collectibles, with release dates, prices and where to buy.

- `data/releases.json` holds every release. The site is built from it and published with GitHub Pages.
- A scheduled news check reads public news feeds and proposes updates as pull requests. Nothing is published until a pull request is reviewed and merged.

## Brand and type

Every release has a `category` (its brand row on the homepage: Nintendo, PlayStation, Xbox and so on, listed in `categories`) and a `type`, what kind of thing it is (consoles and handhelds, controllers, accessories, game editions, figures and amiibo, LEGO, other collectibles, listed in `types`). The homepage has a row of buttons for each, and they work together, so "PlayStation" plus "Controllers" shows only DualSense editions. A type with no releases gets no button. The news check picks the type for each new release it proposes.

A release can also have a `brand`, the company that makes it ("Nintendo", "Sony", "HORI"). It isn't shown on the page; it goes into the page's data for Google (the "brand" of the Product). Leave it out when you don't know it for sure. The news check only fills it in when its source names the maker.

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

**From your phone:** GitHub app (or github.com) > Actions > **Post a restock** > Run workflow. Type part of the release's name (or its id) and the link to the product page. The store is read from the link, so leave the Store box blank unless it says it can't tell. Add where you saw it if you like. Tick *Dry run* first to see exactly what would happen, the email and the Bluesky and X posts included, without changing anything. A real run saves the restock to `main`, sends the email within seconds, posts it to Bluesky and X (and Discord, if set up), and starts a fresh deploy. If something is wrong it changes nothing and says why on the run page.

- The link has to be on the store's own website. A store that sells from more than one site gets a `domains` list in `stores` (Xbox has `microsoft.com`). Tracking and affiliate tags (`utm_*`, `irclickid`, `tag` and so on) are removed from every link you paste, links to Amazon are refused, and the data check rejects them if they're added by hand.
- A second restock at the same store on the same day is logged once, however the link was pasted. A release that sells out and comes back the same day can be logged again after **Sold out again**. A *reported* restock from the news check doesn't count as already logged, so you can still log it yourself once you've checked the store.
- **Sold out again** (also under Actions) switches a release back to "Sold out" so the page stops saying "Back in stock". It emails nobody.
- **Resend restock email** (also under Actions) is only for when a restock saved but its email step failed (open that run to see). It emails for the latest change on `main` if that change is a restock. If the first email did go out it sends it twice, so check Buttondown > Emails first. Tick *Dry run* to see what it would send.
- **The news check can propose restocks too.** When a news site or subreddit reports a release back in stock at a store on the list, the daily pull request includes it as a *reported* restock: the report is its source, the log links the store's search for the release (or the store's own product page, if the report's text has one), and the status becomes "Back in stock". Merging it sends the "Reported back in stock" email, which says the report may be hours old, to the people following that release (not the whole category, since reports can come several a week; a restock you check yourself still goes to the category too). The release page, the homepage and the feed all say "Reported", and any restock two or more days old says it may be sold out by now. A report that is more than two days old by the time you merge the pull request isn't emailed or posted, because it would only send people to a sold-out listing; the release page still shows it. The pull request says the last day to merge for it to go out, or that it's already too old. A reported restock is never dated newer than the report itself: the date is the earlier of the day the AI read and the day the report came out (New York time), and a report of stock "coming Friday" is dropped because it hasn't happened yet. Restocks the news check proposes are the only ones it can touch: it can't choose "Back in stock" as a status, and a store's own link is only used when it appears in the report's text, with everything after the `?` removed (the pull request shows the exact link under "restock link" so you can look before you merge). Anything copied from a headline, and the AI's own words about it, is shown in the pull request as plain code, so a headline can't add headings, links, images or checkboxes to it.

## Prices and resellers

A release page with one plain price shows "MSRP $519.99. Don't pay more." A price range, TBA and rumors get no MSRP line. If `price` isn't the MSRP (a bundle, say), set `msrp` on the release: `"msrp": "$149.99"`.

To show what resellers are asking, fill in `resale` by hand from the listings you looked at:

```json
"resale": { "low": "$800", "high": "$1,000", "checked": "2026-10-09", "where": "eBay" }
```

The page shows "Resellers are asking $800 to $1,000 on eBay (checked Oct 9, 2026). That's 54% to 92% over MSRP." The percentages are worked out from the MSRP, and only shown when the price is over it. `high` and `where` are optional. A check older than 30 days says "may be out of date". Leave `resale` out and nothing shows. Only enter what you actually saw.

## How to get one

A release can have a short "How to get one" box, filled in by hand from what you've checked. It only shows the fields that have something in them, and nothing at all when none do:

```json
"howToGet": {
  "where": "Online at the Nintendo Store, and some stores in person at launch.",
  "limit": "One per customer.",
  "membership": "Members get a day of early access.",
  "tips": ["Sign in to each store ahead of time.", "Save your address and card."]
}
```

`where`, `limit` and `membership` are short text (under 400 characters) and `tips` is up to 8 short sentences. Leave a field out, or blank, to hide it. The data check rejects anything else in there, so a typo can't silently hide a field. Only write what you've seen on the store's own page or in a source.

## No ads, no affiliate links

The site has neither, and the validator rejects an `affiliateUrl`. What it costs to run is on the About page, from `data/costs.json` (a row with an empty `price` is hidden, so fill in "Domain name" when you know it). To show a tip link on the About page, set `support.url` in `site.config.json`; leave it empty and no link shows.

## Social posts

After each change to `main` goes live, `scripts/social.mjs` posts release news to Bluesky and X: new releases, and big changes (preorders opening, a release date, out now, sold out). Posts are built from the data with fixed wording and link to the release page (not on X, see below). Price changes, timeline notes and rumors aren't posted, except timeline notes about stock (a restock, extra units, a new wave), which are posted as "Stock news". `[no alerts]` or `[no posts]` in a commit message skips posting, and so does any change touching more than 8 releases.

The **Scheduled posts** action also posts "Out today" for each release on its release day, and on Thursdays a "Coming out this week" list linking the calendar. It tries hourly from 9am New York time and posts once a day. The **Post to social** action posts a message of your own.

**Posts on X have no link.** X's API charges $0.20 for a post with a link in it and about 2 cents for one without, so the X version of every post leaves the link off. It ends with the site's name written out ("Details: editiontracker dot com", with "dot" instead of a point, because X turns anything that looks like a web address into a link; `lib/tlds.js` is the list of address endings like com, uk and shop that it uses to tell an address from a missing space after a full stop) and one or two hashtags taken from the release's category and platform (#Nintendo #Switch2, #PlayStation #PS5 and so on; the list is in `lib/xpost.js`, and a category or platform that isn't on it just gets no hashtag). The Bluesky post keeps its link and preview card. A message typed into **Post to social** goes to X with its links taken out. The log of every run shows what X would get under "On X, without the link". To make the site clickable from X, put `https://editiontracker.com` in the website box of the X profile. The account's own Usage page in the X developer console confirmed those prices in October 2026: a plain post shows as "PostCreate" (about 2 cents), and a post with a link as "ContentCreateWithUrl" ($0.20).

**Restocks** get their own post, whenever a restock is logged by the phone action or merged from the news check: "Back in stock: <release> at <store>", the MSRP, and a link to the release page ("Reported back in stock" for one from a news report). They go to Bluesky and to X (`social.restockToX` is `true` in `site.config.json`; set it to `false` to keep restocks off X), and to a Discord channel when the `DISCORD_WEBHOOK_URL` secret is set. On X a restock post has no link, so it costs about 2 cents; it reads "Back in stock: <release> at <store>", the MSRP, "Store links: editiontracker dot com", and the hashtags #Restock plus the release's category and platform. The phone action posts to all of them right after the email, using the same `X_*` secrets as the deploy. If a post fails (an expired key or no X credit left, say) the run still finishes, the restock is still saved and emailed, and the run page shows a warning that says which post failed.

**Best Buy stock check (automatic restocks).** Every hourly run of the news check (one request an hour) asks Best Buy's free Products API whether the releases in `config/stock-check.json` can be bought online (each entry is a release id and the SKU, the number in the product link). The news itself is still only read twice a day. A product that can be bought while the site shows that release as sold out or out becomes a proposed "reported" restock in the news pull request, with Best Buy's product page as the source, and the pull request mentions you so GitHub notifies you; check it and merge it like the rest (the pull request says by when to merge for the email and posts to go out). Each product is proposed once while it stays in stock: close the pull request and it isn't proposed again until Best Buy says it's gone and it comes back. It needs the `BESTBUY_API_KEY` secret (free key at developer.bestbuy.com); without it that part is skipped. To see what Best Buy says for each product without changing anything, run **Best Buy stock check** from the Actions tab with "Just show" ticked. Instant mode, where the **Best Buy stock check** action polls every few minutes and starts **Post a restock** by itself, is built but switched off; the comment at the top of `.github/workflows/stock-check.yml` says how to turn it on.

**Discord (optional).** Make a server and a read-only `#restock-alerts` channel (turn off Send Messages for everyone). Then channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL, and save that link as a repository secret named `DISCORD_WEBHOOK_URL` (repo > Settings > Secrets and variables > Actions > New repository secret). The link works like a password, so it's never printed and only a real Discord webhook link is accepted. Posts can't ping anyone. Without the secret nothing is posted to Discord. To show a "Discord" link in the footer, put the server's invite link (`https://discord.gg/...`, set to never expire) in `social.discord` in `site.config.json`; leave it empty and nothing shows.

Bluesky needs the `BLUESKY_APP_PASSWORD` secret (the handle is in `site.config.json`). X needs `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`. Without them the step only logs what it would post.

## Later (ideas, not built)

- **Retailer alert aggregator.** The site signs up for each official retailer's "notify me when available" on the releases it tracks, using an email address that belongs to the site, so a visitor subscribes once here instead of making an account at five stores. An inbound-mail step would read the retailer's alert and run the same restock flow ("Reported, per <store>'s own alert"). It needs a mailbox that can run code (Cloudflare Email Workers or a Google Apps Script), a GitHub token kept in that service (ask before adding any secret), a reader for each retailer's alert emails (they all look different), and a check that an email really came from the store. What could go wrong:
  - Many of these alerts are one-time, so someone has to sign up again after each one, per store and per release.
  - A store's terms may not allow its notify feature to power a public service. Read each store's terms first.
  - An alert can fire when an outside seller has stock, so an automatic email needs a human check or very careful wording.
  - A forged email must never be able to trigger a public alert.

  Start with one store, with the alert going to a private channel for a one-tap approval, before anything goes straight to subscribers. Don't say on the site that we do this until it works.
- **Instant stock checking** (a bot that loads product pages every few minutes) isn't recommended: it's fragile, some stores forbid it, and it clashes with "no bots".
- **A total line on the About page** ("about $14 to $17 a month before X posts"), if you want one. It's written by hand in `data/costs.json` (`total`), so it would need updating when a cost changes.

Edition Tracker isn't affiliated with Nintendo, Sony, Microsoft or any store.

Fonts: [Barlow](https://github.com/jpt/barlow), under the SIL Open Font License (see `static/fonts/OFL.txt`).
