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

    // ---------- 3. Новинки (розділ «Релізи» Lampa: вийшли в цифровій якості) ----------
    var RELEASES = 'http://127.0.0.1:8977/releases?data=';
    var releasesSentAt = 0;

    // Лише гарантовано висока якість: 4K, Blu-ray/Remux, явні 1080p/FHD.
    // WEB-DL не беремо: CUB не вказує роздільність, тож це може бути й 720p.
    var GOOD_QUALITY = /^(4k|2160p?|uhd|fhd|1080p?|bluray|blu-ray|bdremux|remux)$/i;

    function syncReleases() {
        if (!window.Lampa || !Lampa.Api || typeof Lampa.Api.relise !== 'function' || !Lampa.Reguest) return;
        if (releasesSentAt && Date.now() - releasesSentAt < 6 * 3600000) return; // раз на 6 годин
        var collected = [];
        var page = 1;
        function load() {
            Lampa.Api.relise({ page: page }, function (data) {
                ((data && data.results) || []).forEach(function (c) {
                    if (c && c.id && c.source === 'tmdb' && (c.backdrop_path || c.poster_path) &&
                        GOOD_QUALITY.test(((c.release_quality || '') + '').replace(/\s/g, ''))) collected.push(c);
                });
                // Добираємо до 20 гідних релізів, але не більше 8 сторінок.
                if (collected.length < 20 && page < 8 && data && data.results && data.results.length) { page++; load(); }
                else send(collected.slice(0, 20));
            }, function () { if (collected.length) send(collected.slice(0, 20)); });
        }
        function send(cards) {
            var list = cards.map(function (c) {
                var isTv = !!(c.name || c.first_air_date);
                return {
                    id: c.id,
                    tv: isTv,
                    t: c.title || c.name || '',
                    y: year(c),
                    p: poster(c),
                    b: tmdbImage('w500', c.backdrop_path),
                    q: (c.release_quality || '') + '',
                    r: c.imdb_rating ? (+c.imdb_rating).toFixed(1) : ''
                };
            });
            if (!list.length) return;
            var net = new Lampa.Reguest();
            if (typeof net.timeout === 'function') net.timeout(3000);
            net.silent(RELEASES + encodeURIComponent(JSON.stringify(list)), function () {
                releasesSentAt = Date.now();
            }, function () { /* лаунчер недоступний — спробуємо пізніше */ }, false, { dataType: 'text' });
        }
        load();
    }

    // ---------- 4. Зараз дивляться (що найчастіше відкривають користувачі Lampa за тиждень) ----------
    // Джерело — той самий сервіс, що й рядок «Спільнота дивиться на тижні» (плагін CommunityWatches).
    var WATCHING = 'http://127.0.0.1:8977/watching?data=';
    var TOP_URL = 'https://wh.lme.isroot.in/v2/top?period=7d&top=desc&page=1&per_page=60'; // з запасом: беремо лише фільми
    var watchingSentAt = 0;

    function tmdbDetails(type, id, done) {
        var key = (Lampa.TMDB && typeof Lampa.TMDB.key === 'function') ? Lampa.TMDB.key() : '';
        var lang = Lampa.Storage.get('language', 'uk');
        var url = Lampa.TMDB.api(type + '/' + id + '?api_key=' + key + '&language=' + lang);
        var net = new Lampa.Reguest();
        if (typeof net.timeout === 'function') net.timeout(8000);
        net.silent(url, function (d) { done(d && d.id ? d : null); }, function () { done(null); });
    }

    function syncWatching() {
        if (!window.Lampa || !Lampa.Reguest || !Lampa.TMDB || typeof Lampa.TMDB.api !== 'function') return;
        if (watchingSentAt && Date.now() - watchingSentAt < 6 * 3600000) return; // раз на 6 годин
        new Lampa.Reguest().silent(TOP_URL, function (top) {
            var ids = ((top && top.items) || []).map(function (x) { return (x.id || '').split(':'); })
                .filter(function (p) { return p[0] === 'movie' && p[1]; }) // лише фільми, без серіалів
                .slice(0, 20);
            var result = new Array(ids.length), left = ids.length;
            if (!left) return;
            ids.forEach(function (p, i) {
                tmdbDetails(p[0], p[1], function (c) {
                    if (c && (c.backdrop_path || c.poster_path)) {
                        result[i] = {
                            id: c.id,
                            tv: p[0] === 'tv',
                            t: c.title || c.name || '',
                            y: year(c),
                            p: tmdbImage('w300', c.poster_path),
                            b: tmdbImage('w500', c.backdrop_path)
                        };
                    }
                    if (--left === 0) {
                        var list = result.filter(Boolean);
                        if (!list.length) return;
                        var net = new Lampa.Reguest();
                        if (typeof net.timeout === 'function') net.timeout(3000);
                        net.silent(WATCHING + encodeURIComponent(JSON.stringify(list)), function () {
                            watchingSentAt = Date.now();
                        }, function () {}, false, { dataType: 'text' });
                    }
                });
            });
        }, function () {});
    }

    function start() {
        patchParser();
        sync();
        setInterval(sync, 15000);
        setTimeout(syncReleases, 8000);
        setTimeout(syncWatching, 12000);
        setInterval(function () { syncReleases(); syncWatching(); }, 60000); // перевірка щохвилини, надсилання — раз на 6 год
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
