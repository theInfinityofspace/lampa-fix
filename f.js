/*
 * Lampa-плагін для ТВ у спальні.
 *  1. Виправляє "TypeError: onerror is not a function" (див. parser-onerror-fix.js).
 *  2. Передає історію переглядів на головний екран ТВ (лаунчер com.calm.tvhome),
 *     який слухає лише локальну адресу 127.0.0.1:8977 — дані не залишають ТВ.
 */
(function () {
    'use strict';

    // ---------- 1. onerror за замовчуванням для Lampa.Parser.get ----------
    function patchParser() {
        if (!window.Lampa || !Lampa.Parser || typeof Lampa.Parser.get !== 'function') return false;
        if (Lampa.Parser.get.__onerrorFix) return true;
        var original = Lampa.Parser.get;
        var wrapped = function (params, oncomplite, onerror) {
            if (typeof oncomplite !== 'function') oncomplite = function () {};
            if (typeof onerror !== 'function') onerror = function () {};
            return original.call(this, params, oncomplite, onerror);
        };
        wrapped.__onerrorFix = true;
        Lampa.Parser.get = wrapped;
        return true;
    }

    // ---------- 2. Історія для головного екрана ----------
    var ENDPOINT = 'http://127.0.0.1:8977/history?data=';
    var lastSent = '';
    var lastSentAt = 0;

    function poster(card) {
        if (card.img && /^https?:\/\//.test(card.img)) return card.img;
        var path = card.poster_path || card.backdrop_path;
        if (!path) return '';
        try {
            if (Lampa.TMDB && typeof Lampa.TMDB.image === 'function') return Lampa.TMDB.image('t/p/w300' + path);
        } catch (e) {}
        return 'https://image.tmdb.org/t/p/w300' + path;
    }

    function collect() {
        var list = (Lampa.Favorite.get({ type: 'history' }) || []).slice(0, 20);
        return list.map(function (c) {
            return {
                id: c.id,
                tv: !!(c.name || c.first_air_date || c.number_of_seasons),
                t: c.title || c.name || '',
                p: poster(c)
            };
        });
    }

    function sync() {
        if (!window.Lampa || !Lampa.Favorite || !Lampa.Reguest) return;
        var json;
        try { json = JSON.stringify(collect()); } catch (e) { return; }
        // Надсилаємо при зміні, а також раз на 10 хв — якщо лаунчер перезапускався.
        if (json === lastSent && Date.now() - lastSentAt < 600000) return;
        var net = new Lampa.Reguest();
        if (typeof net.timeout === 'function') net.timeout(3000);
        net.silent(ENDPOINT + encodeURIComponent(json), function () {
            lastSent = json;
            lastSentAt = Date.now();
        }, function () { /* лаунчер недоступний — спробуємо пізніше */ }, false, { dataType: 'text' });
    }

    function start() {
        patchParser();
        sync();
        setInterval(sync, 15000);
    }

    if (!patchParser()) {
        var tries = 0;
        var timer = setInterval(function () {
            if (patchParser() || ++tries > 100) clearInterval(timer);
        }, 100);
    }
    if (window.appready) start();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
    else setTimeout(start, 5000);
})();
