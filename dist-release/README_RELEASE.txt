Neon Gates / Неоновые врата — Yandex Games release package
==========================================================

ZIP CONTENTS (upload this zip or its root files to the console):
  index.html
  css/style.css
  js/i18n.js
  js/saves.js
  js/sdk-bridge.js
  js/ads.js
  js/game.js
  assets/   (placeholder)
  README_RELEASE.txt

Do NOT upload: promo/, DESIGN.md, CONSOLE_TEXTS.md, CHECKLIST.md, .git

CONSOLE DRAFT SETTINGS
- Cloud saves: ON (bestScore, soundOn, gamesPlayed)
- Languages: Russian + English
- Age: 0+
- Platforms: Mobile + Desktop (HTML5)
- Orientation: Portrait primary
- Ads: Interstitial + Rewarded Video

HOW TO TEST LOCALLY
1. Serve the folder over HTTP (Yandex SDK path /sdk.js will 404 — mock activates automatically):
     cd dist-release && python3 -m http.server 8080
2. Open http://localhost:8080/
3. Mock ads: fullscreen ~0.6s, rewarded ~0.8s; callbacks fire so Continue/Double work.
4. On real Yandex: host serves /sdk.js; bridge uses live YaGames.init and adv APIs.

DEBUG / QA NOTES
- First death of a browser session: no interstitial.
- Later deaths: interstitial every 2nd death or after 60s gap.
- Continue works once per run; reward applied only if onRewarded fires.
- Toggle sound on menu; best score persists via localStorage mock / cloud on platform.
- Desktop: Arrow keys or A/D; mouse moves ship. Mobile: hold left/right half.

PROMO ART
See /promo for icon-512, cover-800x470, shot-1..3 SVG mockups for console media.
