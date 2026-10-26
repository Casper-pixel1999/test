import { EventEmitter, once } from 'node:events';
import { promisify } from 'node:util';
import SteamUser from 'steam-user';
import SteamCommunity from 'steamcommunity';
import SteamTotp from 'steam-totp';
import TradeOfferManager from 'steam-tradeoffer-manager';

const WEB_SESSION_REFRESH_MS = 60 * 60 * 1000;

/**
 * Авторизация в Steam:
 *  1) refresh token (живёт ~200 дней) -> логин без пароля и без 2FA;
 *  2) fallback: логин+пароль+TOTP-код из shared_secret;
 *  3) webSession -> cookies для steamcommunity / tradeoffer-manager / наших HTTP-запросов;
 *  4) мобильные подтверждения подписываются identity_secret — только для объектов,
 *     которые создал сам бот (никаких "подтвердить всё").
 */
export class SteamSession extends EventEmitter {
  constructor({ accountName, password, maFile, tokenStore, proxyUrl, logger, notifier }) {
    super();
    this.accountName = accountName || maFile.accountName;
    this.password = password;
    this.ma = maFile;
    this.tokenStore = tokenStore;
    this.log = logger.child({ mod: 'steam-session' });
    this.notifier = notifier;
    this.timeOffset = 0;
    this.sessionID = null;
    this.cookies = [];

    // Тот же IP, что и у HTTP-запросов аккаунта (STEAM_ACCOUNT_PROXY).
    this.client = new SteamUser({ httpProxy: proxyUrl ?? undefined, renewRefreshTokens: true, autoRelogin: true });
    this.community = new SteamCommunity();
    this.manager = new TradeOfferManager({
      steam: this.client,
      community: this.community,
      language: 'en',
      pollInterval: 30_000,
    });
    this.#bindEvents();
  }

  get steamId() {
    return this.client.steamID?.getSteamID64() ?? this.ma.steamId;
  }

  /** Часы сервера могут не совпадать с нашими — коды TOTP считаем со смещением. */
  async syncTime() {
    try {
      const [offset] = await promisify((cb) => SteamTotp.getTimeOffset((err, off, lat) => cb(err, [off, lat])))();
      this.timeOffset = offset;
    } catch (err) {
      // Не фатально: при часах, синхронизированных по NTP, смещение ~0
      this.log.warn({ err: err.message }, 'не удалось синхронизировать время со Steam, используем локальные часы');
    }
  }

  authCode() {
    return SteamTotp.generateAuthCode(this.ma.sharedSecret, this.timeOffset);
  }

  now() {
    return SteamTotp.time(this.timeOffset);
  }

  async login() {
    await this.syncTime();
    const refreshToken = await this.tokenStore.load();

    if (refreshToken) {
      try {
        await this.#logOnAndWait({ refreshToken });
        return;
      } catch (err) {
        this.log.warn({ eresult: err.eresult, msg: err.message }, 'refresh token отклонён, логин по паролю');
        await this.tokenStore.clear();
      }
    }

    if (!this.password) throw new Error('Нет валидного refresh token и не задан STEAM_PASSWORD');
    await this.#logOnAndWait({ accountName: this.accountName, password: this.password, twoFactorCode: this.authCode() });
  }

  async #logOnAndWait(details) {
    this.client.logOn(details);
    // events.once отклоняет промис, если раньше придёт событие 'error'
    await once(this.client, 'webSession');
  }

  #bindEvents() {
    this.client.on('loggedOn', () => this.log.info({ steamId: this.steamId }, 'logged on'));

    // steam-user сам выдаёт новый refresh token — сохраняем зашифрованным
    this.client.on('refreshToken', (token) =>
      this.tokenStore.save(token).catch((err) => this.log.error({ err: err.message }, 'не удалось сохранить refresh token')));

    // Срабатывает, если код 2FA не подошёл (рассинхрон времени / код уже использован)
    this.client.on('steamGuard', (domain, callback, lastCodeWrong) => {
      if (domain) {
        this.log.error('Запрошен email-код Steam Guard: аккаунт без мобильного аутентификатора не поддерживается');
        return;
      }
      const delay = lastCodeWrong ? 30_000 : 0; // ждём следующее 30-секундное окно TOTP
      setTimeout(() => this.syncTime().then(() => callback(this.authCode())), delay);
    });

    this.client.on('webSession', (sessionID, cookies) => {
      this.sessionID = sessionID;
      this.cookies = cookies;
      this.community.setCookies(cookies);
      this.manager.setCookies(cookies, (err) => {
        if (err) this.log.error({ err: err.message }, 'tradeoffer-manager setCookies failed');
      });
      this.log.info('web session ready');
      this.emit('ready');
    });

    // steamcommunity сообщит, когда cookies протухли — просим новые
    this.community.on('sessionExpired', () => {
      this.log.warn('web session expired, re-login');
      this.client.webLogOn();
    });
    setInterval(() => this.client.steamID && this.client.webLogOn(), WEB_SESSION_REFRESH_MS).unref();

    this.client.on('error', (err) => {
      this.log.error({ eresult: err.eresult, msg: err.message }, 'steam-user error');
      this.notifier?.error(`Steam client error: ${err.message}`);
    });
    this.client.on('disconnected', (eresult, msg) => this.log.warn({ eresult, msg }, 'disconnected'));

    // Антискам: автоматически принимаем ТОЛЬКО входящие офферы, где мы ничего не отдаём
    // (вывод предметов с площадок). Всё остальное — отклоняем и алертим.
    this.manager.on('newOffer', (offer) => {
      const gift = offer.itemsToGive.length === 0 && offer.itemsToReceive.length > 0 && !offer.isGlitched();
      if (gift) {
        offer.accept((err) => {
          if (err) this.log.error({ offerId: offer.id, err: err.message }, 'accept failed');
          else this.emit('itemsReceived', offer.itemsToReceive);
        });
        return;
      }
      this.log.warn({ offerId: offer.id, partner: offer.partner.getSteamID64() }, 'подозрительный оффер — отклоняем');
      this.notifier?.error(`Отклонён оффер ${offer.id}: у нас запрашивают ${offer.itemsToGive.length} предм.`);
      offer.decline(() => {});
    });
  }

  /** Строка Cookie для наших HTTP-запросов к steamcommunity.com */
  cookieHeader() {
    return this.cookies.map((c) => c.split(';')[0]).join('; ');
  }

  /** Все мобильные подтверждения (подписаны identity_secret, tag "conf"). */
  async getConfirmations() {
    const time = this.now();
    const key = SteamTotp.getConfirmationKey(this.ma.identitySecret, time, 'conf');
    return promisify(this.community.getConfirmations.bind(this.community))(time, key);
  }

  /** Подтвердить ровно одно подтверждение (tag "allow"). */
  async acceptConfirmation(conf) {
    const time = this.now();
    const key = SteamTotp.getConfirmationKey(this.ma.identitySecret, time, 'allow');
    return promisify(conf.respond.bind(conf))(time, key, true);
  }

  /** Подтверждение по id объекта (trade offer id / listing id), который создал бот. */
  async acceptConfirmationForObject(objectId) {
    return promisify(this.community.acceptConfirmationForObject.bind(this.community))(this.ma.identitySecret, objectId);
  }
}
