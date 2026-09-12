(function (global) {
  'use strict';

  var DICTS = {
    ru: {
      title: 'Неоновые врата',
      titleEn: 'Neon Gates',
      best: 'Рекорд',
      play: 'Играть',
      how: 'Как играть',
      howTitle: 'Как играть',
      howBack: 'Назад',
      howItems: [
        'Управляйте неоновым кораблём влево и вправо.',
        'Пролетайте через светящиеся врата — каждое даёт очко и комбо.',
        'Собирайте энергетические сферы между вратами за бонус.',
        'Не врезайтесь в стенки врат и не вылетайте за экран.',
        'Скорость растёт — держите ритм!',
        'Мобильный: зажмите левую или правую половину экрана.',
        'ПК: стрелки ← → или A/D, либо мышь.'
      ],
      score: 'Очки',
      combo: 'Комбо',
      pause: 'Пауза',
      resume: 'Продолжить',
      toMenu: 'В меню',
      gameOver: 'Игра окончена',
      restart: 'Заново',
      continueAd: '▶ Продолжить (реклама)',
      doubleAd: '×2 очки (реклама)',
      adLabel: 'Реклама…',
      soundOn: '🔊',
      soundOff: '🔇'
    },
    en: {
      title: 'Neon Gates',
      titleEn: 'Неоновые врата',
      best: 'Best',
      play: 'Play',
      how: 'How to Play',
      howTitle: 'How to Play',
      howBack: 'Back',
      howItems: [
        'Steer the neon ship left and right.',
        'Fly through glowing gates — each adds a point and combo.',
        'Collect energy orbs between gates for bonus points.',
        'Do not hit gate walls or leave the screen.',
        'Speed rises — keep the rhythm!',
        'Mobile: hold the left or right half of the screen.',
        'Desktop: Arrow keys or A/D, or move the mouse.'
      ],
      score: 'Score',
      combo: 'Combo',
      pause: 'Paused',
      resume: 'Resume',
      toMenu: 'Menu',
      gameOver: 'Game Over',
      restart: 'Restart',
      continueAd: '▶ Continue (ad)',
      doubleAd: '×2 score (ad)',
      adLabel: 'Ad…',
      soundOn: '🔊',
      soundOff: '🔇'
    }
  };

  var lang = 'ru';

  function detect(preferred) {
    var p = (preferred || '').toLowerCase().slice(0, 2);
    if (p === 'en' || p === 'ru') return p;
    var nav = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage) || 'ru').toLowerCase();
    return nav.indexOf('en') === 0 ? 'en' : 'ru';
  }

  function setLang(l) {
    lang = detect(l);
    return lang;
  }

  function t(key) {
    var d = DICTS[lang] || DICTS.ru;
    return d[key] != null ? d[key] : (DICTS.en[key] != null ? DICTS.en[key] : key);
  }

  function applyDom() {
    var el = function (id) { return document.getElementById(id); };
    var set = function (id, text) { var n = el(id); if (n) n.textContent = text; };
    set('title-main', t('title'));
    set('title-sub', t('titleEn'));
    set('lbl-best', t('best'));
    set('btn-play', t('play'));
    set('btn-how', t('how'));
    set('how-title', t('howTitle'));
    set('btn-how-back', t('howBack'));
    set('lbl-score', t('score'));
    set('lbl-combo', t('combo'));
    set('pause-title', t('pause'));
    set('btn-resume', t('resume'));
    set('btn-pause-menu', t('toMenu'));
    set('go-title', t('gameOver'));
    set('lbl-go-score', t('score'));
    set('lbl-go-best', t('best'));
    set('btn-continue', t('continueAd'));
    set('btn-double', t('doubleAd'));
    set('btn-restart', t('restart'));
    set('btn-go-menu', t('toMenu'));
    set('ad-label', t('adLabel'));
    var list = el('how-list');
    if (list) {
      list.innerHTML = '';
      (t('howItems') || []).forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
    }
  }

  global.I18n = {
    DICTS: DICTS,
    detect: detect,
    setLang: setLang,
    getLang: function () { return lang; },
    t: t,
    applyDom: applyDom
  };
})(typeof window !== 'undefined' ? window : this);
