/*
 * Lampa: виправлення "TypeError: onerror is not a function".
 *
 * Плагін Flixio (бейджі якості на картках) викликає Lampa.Parser.get без
 * третього аргументу — обробника помилки. Коли торрент-парсер (jac.red) не
 * встигає відповісти, ядро Lampa викликає undefined і показує червоне вікно.
 * Тут ми підставляємо порожній обробник, якщо його не передали.
 */
(function () {
    'use strict';

    function patch() {
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

    if (!patch()) {
        var tries = 0;
        var timer = setInterval(function () {
            if (patch() || ++tries > 100) clearInterval(timer);
        }, 100);
    }
})();
