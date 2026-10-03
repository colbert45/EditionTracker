# Edition Tracker

The code behind [editiontracker.com](https://editiontracker.com), a site tracking special edition consoles, controllers, games and collectibles.

- **`data/releases.json`** holds every release. It's the only file you need to edit.
- Every change to `main` rebuilds the site and publishes it to GitHub Pages within a couple of minutes (the **Deploy site** action). It also rebuilds once a day so countdowns stay current.
- The **News check** action reads news and subreddit feeds four times a day. When it finds something, it opens a pull request with proposed edits. **Nothing goes live until you merge that pull request.**

## Reviewing a news-check pull request

1. GitHub emails you when one opens. You can also find it under the **Pull requests** tab.
2. Read the description. Each proposed change shows what it would change (before and after) and links to its sources. Open the sources and check them.
3. Click **Files changed** to see the exact edits to `releases.json`.
4. To fix something before approving it, go to **Files changed**, click **⋯** next to `data/releases.json`, choose **Edit file**, make the change and click **Commit changes** (keep "Commit directly to the news-check/... branch").
5. Wait for the green check. Fixes you push run the **Check** action, which confirms the file is valid and the site builds. (The bot's own edits are checked inside the news-check run, so you won't see a separate check on those.)
6. To approve, click **Merge pull request**, then **Confirm merge**. The site updates a couple of minutes later.
7. To reject everything, click **Close pull request**. Those headlines won't be suggested again.
8. To keep some changes and drop others, edit the file as in step 4 to remove the parts you don't want, then merge.

While a news-check pull request is open, later runs add to it and post a comment for each new batch, so there's only ever one to review.

## Adding or editing a release yourself

All in the browser, no tools needed:

1. Open `data/releases.json` on GitHub and click the pencil icon (**Edit this file**).
2. Make your change (see the fields below). The easiest way to add a release is to copy an existing one, from its `{` to its `},`, paste it after another release, and change the values.
3. Set `"updated"` at the top of the file to today's date. That's the "Updated" date in the site header.
4. Click **Commit changes**. Pick **Create a new branch and start a pull request**, then **Propose changes**, then **Create pull request**.
5. Wait for the **Check** action. If it fails, click **Details**. It lists each problem in plain words (for example `items[3] (xbox-series-x25): releaseDate must be null or a date like "2026-10-29"`). Fix it the same way.
6. Click **Merge pull request**. The site updates a couple of minutes later.

(You can also commit straight to `main` for a quick typo fix. If the file is broken, the deploy fails and the live site stays as it was.)

### Release fields

| Field | What it is |
|---|---|
| `id` | The page address: `switch-2-zelda-40th` → editiontracker.com/switch-2-zelda-40th/. Lowercase letters, numbers and dashes. Don't change it once the page is live, or old links break. |
| `name`, `platform`, `price` | Shown as written. Use `"TBA"` for an unknown price. |
| `category` | One of the keys in `categories`: `nintendo`, `playstation`, `xbox`, `pc`, `collect`. |
| `status` | `rumor`, `announced`, `preorder`, `out` or `soldout`. |
| `releaseDate` | `"2026-10-29"` once the exact day is known, otherwise `null`. |
| `releaseWindow` | Shown when there's no exact date: `"Spring 2027"`, `"2027"`, `"TBA"`. Use `null` once there's a `releaseDate`. |
| `preordersOpened` | Date or `null`. |
| `searchQuery` | What the store search links search for. |
| `image`, `imageCredit` | Optional photo. See below. |
| `art` | The illustration used when there's no photo: `type` is one of `hybrid`, `pad`, `case`, `mystery`, `joycons`, `figure`, `bricks`, `tower`, `keyboard`, `dock`, `phonepad`, `handheld`, `ps5`. `colors` is three colors (main, accent, detail). |
| `notes` | Paragraphs, one string each. |
| `inTheBox` | List of items, or `[]` to hide that section. |
| `stores` | `{ "store": "bestbuy", "listed": true, "affiliateUrl": null }`. `listed: false` shows "Not listed yet". Store keys are in `stores` at the top of the file. |
| `timeline` | `{ "date": "2026-09-08", "text": "..." }`, shown newest first. |
| `sources` | `{ "label": "Push Square", "url": "https://..." }`, at least one. |

### Photos

Set `"image"` to a full `https://` link, or upload the photo to `static/images/` (on GitHub: open the `static` folder, then **Add file → Upload files**, and name the folder `images/` in the path) and use `"/images/your-file.jpg"`. `imageCredit` is required whenever there's an image, and it's shown under the photo (for example `"Photo: Nintendo"`). The photo replaces the illustration on the page, in the list and in the Reddit/Discord preview. Only use photos you're allowed to use, such as official press images.

### Affiliate links

Set `affiliateUrl` on a store and the "Check stock" link goes there instead of the store search. Those links get `rel="sponsored"`, and the page shows a one-line affiliate disclosure under the store list (the FTC and most affiliate programs, including Amazon's, require one).

## One-time setup

### 1. GitHub Pages and the domain

In the repository on GitHub, go to **Settings → Pages**:

1. Under **Build and deployment → Source**, choose **GitHub Actions**.
2. Under **Custom domain**, type `editiontracker.com` and click **Save**.
3. Once the DNS check passes (see below), tick **Enforce HTTPS**. GitHub needs some time to issue the certificate after DNS works, usually under an hour, occasionally up to a day. The box stays greyed out until then.

Recommended: verify the domain at **your profile picture → Settings → Pages → Add a domain**. GitHub gives you a TXT record to add in Porkbun. It stops anyone else from using editiontracker.com on GitHub Pages.

### 2. DNS records in Porkbun

At porkbun.com, go to **Account → Domain Management**. Next to editiontracker.com, click **DNS**.

First delete Porkbun's default parking records (an **ALIAS** record for the bare domain and a **CNAME** for `*`, both pointing to `pixie.porkbun.com`). Then add:

| Type | Host | Answer |
|---|---|---|
| A | *(leave blank)* | 185.199.108.153 |
| A | *(leave blank)* | 185.199.109.153 |
| A | *(leave blank)* | 185.199.110.153 |
| A | *(leave blank)* | 185.199.111.153 |
| AAAA | *(leave blank)* | 2606:50c0:8000::153 |
| AAAA | *(leave blank)* | 2606:50c0:8001::153 |
| AAAA | *(leave blank)* | 2606:50c0:8002::153 |
| AAAA | *(leave blank)* | 2606:50c0:8003::153 |
| CNAME | www | colbert45.github.io |

Leave TTL at the default. Don't turn on Porkbun URL forwarding for this domain. `www.editiontracker.com` will redirect to `editiontracker.com` automatically.

### 3. Let the news check open pull requests

**Settings → Actions → General → Workflow permissions**: tick **Allow GitHub Actions to create and approve pull requests**, then click **Save**. (The bot only creates pull requests. It never approves or merges them.)

### 4. Secrets for the news check

**Settings → Secrets and variables → Actions → New repository secret**:

- `ANTHROPIC_API_KEY` (required for proposals). Create one at console.anthropic.com. Claude reads the headlines and drafts the edits. Without it, the news check still runs and lists relevant headlines in the run summary, but proposes no edits. Expect a few dollars to roughly $20 a month at four runs a day, depending on how busy the news is. To spend less, add a repository *variable* (the **Variables** tab on the same page) named `NEWS_MODEL`, set to a cheaper Claude model ID such as `claude-sonnet-5-5`.
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME` (optional). Reddit only permits automated reading through its official API, under its [Data API Terms](https://redditinc.com/policies/data-api-terms), and its robots.txt blocks other bots. Create a "script" app at reddit.com/prefs/apps while logged in as your Reddit account, and request API access if Reddit asks you to. Until those secrets exist, Reddit is skipped and the news sites still work.

### 5. Analytics

The site loads [Plausible](https://plausible.io), which uses no cookies, so you don't need a cookie banner. Sign up and add the site `editiontracker.com`. That's all; it also counts "Check stock" clicks as outbound links. To use Cloudflare Web Analytics instead (free), create a site there for editiontracker.com, copy the token from the snippet it gives you, then in `site.config.json` set `"provider": "cloudflare"` and paste the token into `"token"`. Set `"provider": "none"` to turn analytics off.

## Feeds and their terms

`config/feeds.json` lists the feeds. The news check:

- requests each feed once per run (four times a day), with a user agent that names the site, and honors `ETag`/`Last-Modified` so unchanged feeds aren't downloaded again
- reads `robots.txt` first and skips any feed it disallows
- uses only the headline, the feed's own short summary and the link. It never downloads full articles, and nothing from a feed is published. Claude drafts the notes in the site's own words, and you review them.
- uses Reddit only through the official API, with your app credentials

Before adding a site, check its terms allow this kind of use. If a site ever asks you to stop, delete its line.

## Working on your computer (optional)

Requires Node.js 22.

```
npm ci
npm run validate   # check releases.json
npm run build      # build the site into _site/
npm run serve      # preview at http://localhost:8080
npm test
```

`design/edition-tracker.html` is the approved design that the site is generated from. The illustrations in `lib/art.js` and the styles in `lib/design.css` are copied from it unchanged.
