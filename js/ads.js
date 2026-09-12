(function (global) {
  'use strict';

  var MIN_INTERVAL_MS = 60000;
  var lastInterstitialAt = 0;
  var deathsThisSession = 0;
  var adShowing = false;
  var uiDisabled = false;

  var adButtons = [
    'btn-play', 'btn-how', 'btn-sound', 'btn-how-back',
    'btn-pause', 'btn-resume', 'btn-pause-menu', 'btn-pause-sound',
    'btn-continue', 'btn-double', 'btn-restart', 'btn-go-menu'
  ];

  function setButtonsDisabled(disabled) {
    uiDisabled = !!disabled;
    adButtons.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.disabled = disabled;
      if (disabled) el.classList.add('disabled');
      else el.classList.remove('disabled');
    });
  }

  function showAdScreen(show) {
    var ad = document.getElementById('screen-ad');
    if (!ad) return;
    if (show) ad.classList.add('active');
    else ad.classList.remove('active');
  }

  function shouldShowInterstitial() {
    // NOT on very first death of a session
    if (deathsThisSession <= 1) return false;
    var now = Date.now();
    var elapsed = now - lastInterstitialAt;
    // min 60s between OR every 2nd death
    var everySecond = deathsThisSession % 2 === 0;
    if (everySecond && elapsed >= MIN_INTERVAL_MS) return true;
    if (elapsed >= MIN_INTERVAL_MS && deathsThisSession > 1) return true;
    // every 2nd death even if interval not met? Spec: "min 60s between interstitials OR every 2nd death"
    // Interpret: show if (deaths > 1) AND (every 2nd death OR 60s passed)
    if (deathsThisSession > 1 && everySecond) return true;
    return false;
  }

  /**
   * Call on fail before showing game-over restart freely.
   * Returns Promise that resolves when interstitial flow (or skip) completes.
   */
  function onGameOverInterstitial(hooks) {
    hooks = hooks || {};
    deathsThisSession += 1;

    if (!shouldShowInterstitial()) {
      return Promise.resolve({ shown: false });
    }

    adShowing = true;
    setButtonsDisabled(true);
    showAdScreen(true);

    if (global.SdkBridge) {
      global.SdkBridge.gameplayStop();
      global.SdkBridge.setMute(true);
    }
    if (hooks.onBeforeAd) hooks.onBeforeAd();

    lastInterstitialAt = Date.now();

    return global.SdkBridge.showFullscreen({
      onOpen: function () {
        if (hooks.onOpen) hooks.onOpen();
      },
      onClose: function () {
        if (hooks.onClose) hooks.onClose();
      },
      onError: function () {
        if (hooks.onError) hooks.onError();
      }
    }).then(function (shown) {
      adShowing = false;
      showAdScreen(false);
      setButtonsDisabled(false);
      if (global.SdkBridge) {
        // unmute according to user preference — caller restores
        if (hooks.onAfterAd) hooks.onAfterAd();
      }
      return { shown: !!shown };
    });
  }

  /**
   * Rewarded continue — grant ONLY in onRewarded.
   */
  function showRewardedContinue(hooks) {
    hooks = hooks || {};
    adShowing = true;
    setButtonsDisabled(true);
    showAdScreen(true);

    if (global.SdkBridge) {
      global.SdkBridge.gameplayStop();
      global.SdkBridge.setMute(true);
    }
    if (hooks.onBeforeAd) hooks.onBeforeAd();

    var granted = false;

    return global.SdkBridge.showRewarded({
      onOpen: function () { if (hooks.onOpen) hooks.onOpen(); },
      onRewarded: function () {
        granted = true;
        if (hooks.onRewarded) hooks.onRewarded();
      },
      onClose: function () { if (hooks.onClose) hooks.onClose(); },
      onError: function () { if (hooks.onError) hooks.onError(); }
    }).then(function () {
      adShowing = false;
      showAdScreen(false);
      setButtonsDisabled(false);
      if (hooks.onAfterAd) hooks.onAfterAd();
      return { rewarded: granted };
    });
  }

  function showRewardedDouble(hooks) {
    return showRewardedContinue(hooks);
  }

  function isAdShowing() { return adShowing; }
  function isUiDisabled() { return uiDisabled; }

  function resetSession() {
    deathsThisSession = 0;
  }

  global.Ads = {
    onGameOverInterstitial: onGameOverInterstitial,
    showRewardedContinue: showRewardedContinue,
    showRewardedDouble: showRewardedDouble,
    isAdShowing: isAdShowing,
    isUiDisabled: isUiDisabled,
    setButtonsDisabled: setButtonsDisabled,
    resetSession: resetSession,
    getDeaths: function () { return deathsThisSession; }
  };
})(typeof window !== 'undefined' ? window : this);
