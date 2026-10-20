# lampa-fix

Плагін для [Lampa](https://lampa.mx): виправляє вікно помилки
`TypeError: onerror is not a function`, яке з'являється, коли плагін
(наприклад, Flixio з бейджами якості) викликає `Lampa.Parser.get` без
обробника помилки, а торрент-парсер не відповідає.

Підключення в Lampa → Налаштування → Розширення → Додати плагін:

```
https://cdn.jsdelivr.net/gh/theInfinityofspace/lampa-fix@main/parser-onerror-fix.js
```
