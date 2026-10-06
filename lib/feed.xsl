<?xml version="1.0" encoding="UTF-8"?>
<!-- Makes /feed.xml readable when someone opens it in a browser. Feed readers ignore this. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" encoding="UTF-8" indent="yes"/>
<xsl:template match="/">
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>RSS feed | Edition Tracker</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<style>
@font-face{font-family:"Barlow";font-weight:400;font-display:swap;src:url(/fonts/barlow-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Barlow";font-weight:600;font-display:swap;src:url(/fonts/barlow-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:"Barlow Condensed";font-weight:800;font-display:swap;src:url(/fonts/barlow-condensed-latin-800-normal.woff2) format("woff2")}
:root{--bg:#fff;--ink:#16181D;--soft:#5B6170;--line:#E3E5EA;--row:#F6F7F9;--red:#D7263D}
@media (prefers-color-scheme:dark){:root{--bg:#121418;--ink:#ECEEF2;--soft:#A2A8B5;--line:#2A2E36;--row:#1A1D23;--red:#FF4D62}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 "Barlow",system-ui,sans-serif}
a{color:inherit}
.wrap{max-width:860px;margin:0 auto;padding:0 18px 40px}
.mast{display:flex;align-items:center;gap:10px;padding:16px 0 14px;border-bottom:3px solid var(--ink);text-decoration:none}
.tag{width:32px;height:22px;background:var(--red);border-radius:3px 11px 11px 3px;position:relative}
.tag::after{content:"";position:absolute;right:6px;top:8px;width:6px;height:6px;border-radius:50%;background:var(--bg)}
.mast b{font:800 2rem/1 "Barlow Condensed","Arial Narrow",sans-serif}
h1{font:800 clamp(2.2rem,7vw,3.4rem)/.95 "Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase;margin:26px 0 10px}
.box{margin:18px 0 26px;padding:18px 20px;border:1.5px solid var(--line);border-radius:8px;background:var(--row)}
.box p{margin:0 0 10px;color:var(--soft)}
.url{display:flex;gap:8px;flex-wrap:wrap}
.url code{flex:1 1 240px;padding:9px 14px;border:1.5px solid var(--line);border-radius:999px;background:var(--bg);font:15px/1.4 ui-monospace,monospace;overflow:auto;white-space:nowrap}
.url button{font:inherit;font-weight:700;padding:9px 18px;border:0;border-radius:999px;background:var(--red);color:#fff;cursor:pointer}
h2{font:800 1.5rem/1.1 "Barlow Condensed","Arial Narrow",sans-serif;margin:30px 0 6px}
ul{list-style:none;margin:0;padding:0}
li{padding:14px 0;border-bottom:1px solid var(--line)}
li a{font-weight:600;text-decoration:none}
li a:hover{text-decoration:underline}
.meta{font-size:.88rem;color:var(--soft)}
.d{margin:4px 0 0;color:var(--soft);font-size:.96rem}
</style>
</head>
<body>
<div class="wrap">
  <a class="mast" href="/"><span class="tag"></span><b>edition tracker</b></a>
  <h1>RSS feed</h1>
  <div class="box">
    <p>This page is for feed readers like Feedly, Inoreader, NetNewsWire or Reeder, and for tools like Discord bots and Slack. Paste the link below into one of them and new and updated releases show up there on their own.</p>
    <p>Would rather get email? <a href="/#alerts">Get alerts</a> instead.</p>
    <div class="url"><code id="u">https://editiontracker.com/feed.xml</code><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('u').textContent).then(()=>{this.textContent='Copied'})">Copy link</button></div>
  </div>
  <h2>Latest changes</h2>
  <ul>
    <xsl:for-each select="rss/channel/item">
      <li>
        <a href="{link}"><xsl:value-of select="title"/></a>
        <div class="meta"><xsl:value-of select="category"/> · <xsl:value-of select="substring(pubDate,6,11)"/></div>
        <p class="d"><xsl:value-of select="description"/></p>
      </li>
    </xsl:for-each>
  </ul>
</div>
</body>
</html>
</xsl:template>
</xsl:stylesheet>
