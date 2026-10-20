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

    function tmdbImage(size, path) {
        if (!path) return '';
        try {
            if (Lampa.TMDB && typeof Lampa.TMDB.image === 'function') return Lampa.TMDB.image('t/p/' + size + path);
        } catch (e) {}
        return 'https://image.tmdb.org/t/p/' + size + path;
    }

    function poster(card) {
        if (card.img && /^https?:\/\//.test(card.img)) return card.img;
        return tmdbImage('w300', card.poster_path);
    }

    function year(card) {
        return ((card.release_date || card.first_air_date || '') + '').slice(0, 4);
    }

    // Ті самі ключі, що й у ядрі Lampa (WatchedHistory і хеш серії в Timeline).
    function episodeHash(c, s, e) {
        return Lampa.Utils.hash([s, s > 10 ? ':' : '', e, c.original_title].join(''));
    }

    function percentOf(hash) {
        try { return (Lampa.Timeline.view(hash) || {}).percent || 0; } catch (err) { return 0; }
    }

    var scanCache = {}; // id -> {at, value}: перебір серій робимо не частіше ніж раз на 2 хв

    function progress(c, isTv) {
        if (!Lampa.Utils || !Lampa.Timeline) return {};
        if (!isTv) {
            try { return { pr: (Lampa.Timeline.watched(c, true) || {}).percent || 0 }; } catch (err) { return {}; }
        }
        var last = Lampa.Storage.get('online_watched_last', '{}') || {};
        var keys = [c.original_name, c.original_title];
        for (var k = 0; k < keys.length; k++) {
            var f = keys[k] && last[Lampa.Utils.hash(keys[k])];
            if (f && f.episode) return { se: f.season || 1, ep: f.episode, pr: percentOf(episodeHash(c, f.season || 1, f.episode)) };
        }
        var cached = scanCache[c.id];
        if (cached && Date.now() - cached.at < 120000) return cached.value;
        var best = {};
        var seasons = Math.min(c.number_of_seasons || 8, 30);
        for (var s = 1; s <= seasons; s++) {
            for (var e = 1; e <= 40; e++) {
                var p = percentOf(episodeHash(c, s, e));
                if (p) best = { se: s, ep: e, pr: p };
            }
        }
        scanCache[c.id] = { at: Date.now(), value: best };
        return best;
    }

    function collect() {
        var list = (Lampa.Favorite.get({ type: 'history' }) || []).slice(0, 20);
        return list.map(function (c) {
            var isTv = !!(c.name || c.first_air_date || c.number_of_seasons);
            var item = {
                id: c.id,
                tv: isTv,
                t: c.title || c.name || '',
                y: year(c),
                p: poster(c),
                b: tmdbImage('w500', c.backdrop_path) // кадр 16:9 для картки на головному екрані
            };
            var pg = progress(c, isTv); // se/ep — на якій серії зупинились, pr — відсоток перегляду
            if (pg.se) item.se = pg.se;
            if (pg.ep) item.ep = pg.ep;
            if (pg.pr) item.pr = Math.round(pg.pr);
            return item;
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
