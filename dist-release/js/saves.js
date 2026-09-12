(function (global) {
  'use strict';

  var DEFAULTS = {
    bestScore: 0,
    soundOn: true,
    gamesPlayed: 0
  };

  var state = {
    bestScore: 0,
    soundOn: true,
    gamesPlayed: 0
  };

  var writeTimer = null;
  var DEBOUNCE_MS = 400;
  var ready = false;

  function merge(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof data.bestScore === 'number' && data.bestScore >= 0) {
      state.bestScore = Math.floor(data.bestScore);
    }
    if (typeof data.soundOn === 'boolean') state.soundOn = data.soundOn;
    if (typeof data.gamesPlayed === 'number' && data.gamesPlayed >= 0) {
      state.gamesPlayed = Math.floor(data.gamesPlayed);
    }
  }

  function scheduleWrite() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, DEBOUNCE_MS);
  }

  function flush() {
    writeTimer = null;
    if (!global.SdkBridge || typeof global.SdkBridge.setData !== 'function') return;
    global.SdkBridge.setData({
      bestScore: state.bestScore,
      soundOn: state.soundOn,
      gamesPlayed: state.gamesPlayed
    });
  }

  function load() {
    return Promise.resolve()
      .then(function () {
        if (!global.SdkBridge || typeof global.SdkBridge.getData !== 'function') {
          return {};
        }
        return global.SdkBridge.getData(['bestScore', 'soundOn', 'gamesPlayed']);
      })
      .then(function (data) {
        merge(data);
        ready = true;
        return state;
      })
      .catch(function () {
        ready = true;
        return state;
      });
  }

  function getBest() { return state.bestScore; }
  function getSoundOn() { return state.soundOn; }
  function getGamesPlayed() { return state.gamesPlayed; }

  function setBest(score) {
    var s = Math.floor(Number(score) || 0);
    if (s > state.bestScore) {
      state.bestScore = s;
      scheduleWrite();
    }
    return state.bestScore;
  }

  function setSoundOn(on) {
    state.soundOn = !!on;
    scheduleWrite();
    return state.soundOn;
  }

  function incGamesPlayed() {
    state.gamesPlayed += 1;
    scheduleWrite();
    return state.gamesPlayed;
  }

  function getAll() {
    return {
      bestScore: state.bestScore,
      soundOn: state.soundOn,
      gamesPlayed: state.gamesPlayed
    };
  }

  global.Saves = {
    DEFAULTS: DEFAULTS,
    load: load,
    flush: flush,
    getBest: getBest,
    setBest: setBest,
    getSoundOn: getSoundOn,
    setSoundOn: setSoundOn,
    getGamesPlayed: getGamesPlayed,
    incGamesPlayed: incGamesPlayed,
    getAll: getAll,
    isReady: function () { return ready; }
  };
})(typeof window !== 'undefined' ? window : this);
