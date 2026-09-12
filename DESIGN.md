# Neon Gates / Неоновые врата — Design

## Concept
Hypercasual portrait arcade: steer a glowing triangular ship through neon rectangular gates that scroll toward the player. Pass openings to score and build combo; hit a gate wall or leave the screen to fail. Collect floating energy orbs between gates for bonus points. Difficulty rises via scroll speed and tighter openings.

## Session loop
1. Menu: Play, How to Play, sound toggle, best score (cloud + local).
2. Play: continuous rAF loop; left/right steer (touch halves, arrows/A-D, mouse).
3. Fail → GameplayAPI.stop + mute → interstitial policy → Game Over panel.
4. Game Over: score, best, Restart, optional Rewarded Continue (once per run), optional Rewarded ×2 score.
5. Continue restores ship once via `onRewarded` only; Restart starts a fresh run.

## Controls
- Mobile: hold/tap left or right half of the canvas.
- Desktop: `ArrowLeft`/`ArrowRight` or `KeyA`/`KeyD` (code-based), mouse move / drag, on-screen zones.

## Progression
- Base scrollSpeed ~0.22 → caps ~0.55 as score grows.
- Gate opening width ~0.38 → floor ~0.22.
- Combo increments on consecutive gate passes; score gains scale lightly with combo.
- Orbs: +2..+7 depending on combo.

## Ad economy
- Interstitial: after game over, before free restart UI settles. Skip on the very first death of a session. Otherwise show when every 2nd death **or** ≥60s since last interstitial. Always `GameplayAPI.stop` + mute before ad; restore after.
- Rewarded Continue: one per run; grant continue **only** in `onRewarded`.
- Rewarded Double: optional ×2 score once per game-over flow; grant only in `onRewarded`.
- UI buttons disabled while ads show.

## Saves (cloud)
`bestScore`, `soundOn`, `gamesPlayed` via player `getData`/`setData` (debounced), mock uses localStorage.

## Uniqueness
Neon cyber aesthetic with procedural canvas art (no heavy assets), combo-gated scoring, orb bonuses between gates, and polished fail juice (particles + screen shake). Tiny archive, portrait-first with ≤2:1 letterboxing, ru/en i18n matching console titles.

## Technical notes
- States: MENU / PLAY / PAUSE / GAMEOVER / AD.
- LoadingAPI.ready after first menu paint + audio unlock attempt.
- Do not start GameplayAPI before ready and Play.
- WebAudio beeps; mute on pause / ads / visibility.
