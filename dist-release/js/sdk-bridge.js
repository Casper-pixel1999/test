(function (global) {
  'use strict';

  var LS_KEY = 'neon_gates_ysdk_player';
  var readyFlag = false;
  var paused = false;
  var pauseListeners = [];
  var initPromise = null;

  global.__gameMuted = false;

  function loadScript(src, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (global.YaGames) {
        resolve();
        return;
      }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('sdk timeout'));
      }, timeoutMs || 4000);
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error('sdk load error'));
      };
      document.head.appendChild(s);
    });
  }

  function createMockYsdk() {
    var lang = (typeof navigator !== 'undefined' && (navigator.language || 'ru') || 'ru').slice(0, 2);
    var store = {};
    try {
      store = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    } catch (e) {
      store = {};
    }

    function persist() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {}
    }

    var mock = {
      environment: { i18n: { lang: lang } },
      features: {
        LoadingAPI: {
          ready: function () { /* mock */ }
        },
        GameplayAPI: {
          start: function () { /* mock */ },
          stop: function () { /* mock */ }
        }
      },
      getPlayer: function () {
        return Promise.resolve({
          getData: function (keys) {
            var out = {};
            if (!keys) {
              out = Object.assign({}, store);
            } else {
              (keys || []).forEach(function (k) {
                if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
              });
            }
            return Promise.resolve(out);
          },
          setData: function (data, flush) {
            Object.keys(data || {}).forEach(function (k) { store[k] = data[k]; });
            persist();
            return Promise.resolve();
          }
        });
      },
      adv: {
        showFullscreenAdv: function (opts) {
          opts = opts || {};
          var cb = opts.callbacks || {};
          setTimeout(function () {
            if (cb.onOpen) cb.onOpen();
            setTimeout(function () {
              if (cb.onClose) cb.onClose(true);
            }, 600);
          }, 80);
        },
        showRewardedVideo: function (opts) {
          opts = opts || {};
          var cb = opts.callbacks || {};
          setTimeout(function () {
            if (cb.onOpen) cb.onOpen();
            setTimeout(function () {
              if (cb.onRewarded) cb.onRewarded();
              if (cb.onClose) cb.onClose(true);
            }, 800);
          }, 80);
        }
      },
      on: function () { /* no events in mock */ }
    };
    return mock;
  }

  function setPaused(v) {
    v = !!v;
    if (paused === v) return;
    paused = v;
    if (paused) global.__gameMuted = true;
    pauseListeners.forEach(function (fn) {
      try { fn(paused); } catch (e) {}
    });
  }

  function wirePause(ysdk) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) setPaused(true);
      else setPaused(false);
    });
    global.addEventListener('blur', function () { setPaused(true); });
    global.addEventListener('focus', function () {
      if (!document.hidden) setPaused(false);
    });
    if (ysdk && typeof ysdk.on === 'function') {
      try {
        ysdk.on('game_api_pause', function () { setPaused(true); });
        ysdk.on('game_api_resume', function () { setPaused(false); });
      } catch (e) {}
    }
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = loadScript('/sdk.js', 4000)
      .then(function () {
        if (!global.YaGames || typeof global.YaGames.init !== 'function') {
          throw new Error('YaGames missing');
        }
        return global.YaGames.init();
      })
      .then(function (ysdk) {
        global.ysdk = ysdk;
        wirePause(ysdk);
        return ysdk;
      })
      .catch(function () {
        var mock = createMockYsdk();
        global.ysdk = mock;
        wirePause(mock);
        return mock;
      });
    return initPromise;
  }

  function ready() {
    if (readyFlag) return;
    readyFlag = true;
    try {
      if (global.ysdk && global.ysdk.features && global.ysdk.features.LoadingAPI &&
          typeof global.ysdk.features.LoadingAPI.ready === 'function') {
        global.ysdk.features.LoadingAPI.ready();
      }
    } catch (e) {}
  }

  function gameplayStart() {
    try {
      if (global.ysdk && global.ysdk.features && global.ysdk.features.GameplayAPI &&
          typeof global.ysdk.features.GameplayAPI.start === 'function') {
        global.ysdk.features.GameplayAPI.start();
      }
    } catch (e) {}
  }

  function gameplayStop() {
    try {
      if (global.ysdk && global.ysdk.features && global.ysdk.features.GameplayAPI &&
          typeof global.ysdk.features.GameplayAPI.stop === 'function') {
        global.ysdk.features.GameplayAPI.stop();
      }
    } catch (e) {}
  }

  function getLang() {
    try {
      if (global.ysdk && global.ysdk.environment && global.ysdk.environment.i18n) {
        return global.ysdk.environment.i18n.lang || 'ru';
      }
    } catch (e) {}
    return (typeof navigator !== 'undefined' && navigator.language || 'ru').slice(0, 2);
  }

  var playerCache = null;

  function withPlayer() {
    if (playerCache) return Promise.resolve(playerCache);
    if (!global.ysdk || typeof global.ysdk.getPlayer !== 'function') {
      return Promise.reject(new Error('no player'));
    }
    return global.ysdk.getPlayer().then(function (p) {
      playerCache = p;
      return p;
    });
  }

  function getData(keys) {
    return withPlayer().then(function (p) {
      return p.getData(keys);
    }).catch(function () { return {}; });
  }

  function setData(data) {
    return withPlayer().then(function (p) {
      return p.setData(data, true);
    }).catch(function () {});
  }

  function showFullscreen(callbacks) {
    callbacks = callbacks || {};
    return new Promise(function (resolve) {
      var settled = false;
      function done(wasShown) {
        if (settled) return;
        settled = true;
        resolve(!!wasShown);
      }
      try {
        if (!global.ysdk || !global.ysdk.adv || typeof global.ysdk.adv.showFullscreenAdv !== 'function') {
          done(false);
          return;
        }
        global.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onOpen: function () { if (callbacks.onOpen) callbacks.onOpen(); },
            onClose: function (wasShown) {
              if (callbacks.onClose) callbacks.onClose(wasShown);
              done(wasShown);
            },
            onError: function (e) {
              if (callbacks.onError) callbacks.onError(e);
              done(false);
            }
          }
        });
      } catch (e) {
        if (callbacks.onError) callbacks.onError(e);
        done(false);
      }
    });
  }

  function showRewarded(callbacks) {
    callbacks = callbacks || {};
    return new Promise(function (resolve) {
      var rewarded = false;
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        resolve(rewarded);
      }
      try {
        if (!global.ysdk || !global.ysdk.adv || typeof global.ysdk.adv.showRewardedVideo !== 'function') {
          done();
          return;
        }
        global.ysdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: function () { if (callbacks.onOpen) callbacks.onOpen(); },
            onRewarded: function () {
              rewarded = true;
              if (callbacks.onRewarded) callbacks.onRewarded();
            },
            onClose: function (wasShown) {
              if (callbacks.onClose) callbacks.onClose(wasShown);
              done();
            },
            onError: function (e) {
              if (callbacks.onError) callbacks.onError(e);
              done();
            }
          }
        });
      } catch (e) {
        if (callbacks.onError) callbacks.onError(e);
        done();
      }
    });
  }

  function isPaused() { return paused; }

  function setMute(m) {
    global.__gameMuted = !!m;
  }

  function onPauseChange(fn) {
    if (typeof fn === 'function') pauseListeners.push(fn);
  }

  global.SdkBridge = {
    init: init,
    ready: ready,
    gameplayStart: gameplayStart,
    gameplayStop: gameplayStop,
    getLang: getLang,
    getData: getData,
    setData: setData,
    showFullscreen: showFullscreen,
    showRewarded: showRewarded,
    isPaused: isPaused,
    setMute: setMute,
    onPauseChange: onPauseChange
  };
})(typeof window !== 'undefined' ? window : this);
