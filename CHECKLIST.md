# Yandex Games Moderation Checklist — Neon Gates

| Requirement | Status | How |
|-------------|--------|-----|
| `/sdk.js` loaded first | DONE | `index.html` `<script src="/sdk.js">` then CSS/JS order |
| YaGames.init via bridge | DONE | `sdk-bridge.js` init + mock fallback |
| LoadingAPI.ready after first paint | DONE | `game.js` `firstPaintThenReady` after menu |
| GameplayAPI start/stop | DONE | start on Play/Resume/Continue; stop on fail/pause/menu/ads |
| Pause on visibility / game_api_pause | DONE | bridge `visibilitychange`, blur/focus, ysdk.on |
| Mute on pause/ads | DONE | `window.__gameMuted` + WebAudio gate |
| Interstitial policy | DONE | `ads.js`: skip first death; 60s OR every 2nd death |
| Rewarded only in onRewarded | DONE | continue/double granted in onRewarded callback |
| Cloud saves | DONE | `saves.js` bestScore, soundOn, gamesPlayed |
| i18n ru+en | DONE | `i18n.js` + SdkBridge lang |
| Portrait + letterbox ≤2:1 | DONE | resize with visualViewport + aspect clamp |
| Touch preventDefault / no select | DONE | CSS + gesture/contextmenu/selectstart/touchmove |
| No alert / debug overlays | DONE | none in UI |
| Large CTA buttons / contrast | DONE | `style.css` min 52–58px neon buttons |
| Safe-area insets | DONE | `#game-root` env(safe-area-inset-*) |
| Procedural tiny assets | DONE | canvas-only; SVG promos only |
| Desktop + mobile controls | DONE | halves, Arrow/A-D codes, mouse |
| Sound toggle persisted | DONE | Saves.soundOn |
| Game Over: score, best, restart, rewarded | DONE | GO panel + Ads |
| Age 0+ content | DONE | no violence/gambling/adult |
| Archive structure | DONE | `dist-release/` + zip |
