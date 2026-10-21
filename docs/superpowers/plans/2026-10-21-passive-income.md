# Passive Income Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Пользователь выбрал последовательное выполнение в текущем чате.

**Goal:** Калькулятор «Моя цифра», персональное сохранение и актуальный FAQ.

**Architecture:** Чистый модуль `capital-core.js` рассчитывает и проверяет сценарий. Контроллер `capital-ui.js` управляет формой и состоянием сохранения через callback; index.html связывает его с текущей сессией. Существующие финансовые расчёты не меняются.

**Tech Stack:** Vanilla JS, существующие HTML/CSS и Supabase auth metadata, node:test.

## Global Constraints

- Спецификация: docs/superpowers/specs/2026-10-21-passive-income-design.md.
- Два режима, рубли, срок 0–720 месяцев, фиксированный взнос в конце месяца.
- Доходность накопления и выплат раздельна, после налогов и комиссий; инфляция постоянна.
- Сохранение покупательной способности включено по умолчанию, ставки не предзаполнены.
- Метаданные: только finora_capital_plan version 1; никаких изменений кошельков и бюджета.
- Classic/Pixel, мобильный/настольный экран, FAQ в том же изменении.
- Без push, PR, миграций и публикации до отдельного разрешения.

## Task 1: Формулы и валидация

**Files:** js/capital-core.js, tests/capital-core.test.mjs.
**Interface:** FinoraCapitalCore.defaults(), validate(raw) → {values,errors}; calculate(raw) → {values,errors,result}; restore(saved) → {values,invalid}. CommonJS/browser export.

- [ ] Убедиться в linked worktree и ветке feature/passive-income-calculator, выполнить 121 исходный тест.
- [ ] Сначала тесты: 100000 в месяц при 10%, без инфляции → 12000000; с инфляцией 5%, сохранением и нулевым сроком → 24000000. Проверить обратный режим, нулевые ставки, отрицательный рост, уже достигнутую цель, недостижимость, границы и пустые значения.

```js
assert.equal(core.calculate({...base, monthlyIncome:100000, payoutPercent:10}).result.capital,12000000);
assert.equal(core.calculate({...base, monthlyIncome:100000, payoutPercent:10,inflationPercent:5}).result.capital,24000000);
```

- [ ] Запустить node --test tests/capital-core.test.mjs и увидеть падение до реализации.
- [ ] Реализовать согласованные формулы; независимый помесячный тест проверяет взнос:

```js
let balance = initial;
for(let m=0;m<n;m++) balance = balance*(1+i)+payment;
assert.ok(Math.abs(balance-target)<0.01);
```

- [ ] Пустое значение, boolean, NaN, Infinity, превышение границ дают ошибки полей; не заменять их нулём. Проверять активные поля режима, а не скрытые черновики. Для хранения нормализовать неактивные поля в допустимые числа или пустую строку; при загрузке проверять все присутствующие поля и version.
- [ ] Для очень малой ставки использовать expm1/log1p. Ограничить результаты Number.MAX_SAFE_INTEGER. В returned result суммы не округлять; округление только при отображении.
- [ ] Запустить тесты и зафиксировать формулы отдельным коммитом.

## Task 2: Контроллер и сохранение

**Files:** js/capital-ui.js, tests/capital-ui.test.mjs.
**Interface:** create({core,getContext,savePlan,onChange}) → {state,edit(field,value),load(saved),reset(),save()}. getContext → {userId,generation}; savePlan(payload,context) → Promise<boolean>; onChange(state) обновляет UI.

- [ ] Написать падающие тесты: ошибка оставляет ввод; повтор сохраняет только нормализованный payload; смена аккаунта отвергает старое завершение; ввод во время сохранения не помечается сохранённым; повторный save заблокирован; load при грязном черновике не перезаписывает его.

```js
const saving = controller.save();
controller.edit('monthlyIncome','200000');
resolve(true); await saving;
assert.equal(controller.state.dirty,true);
```

- [ ] Реализовать revision для ввода, epoch для reset, busy и snapshot контекста. Сравнивать epoch, userId и generation перед применением результата. load только для нового/чистого состояния; USER_UPDATED не должен менять черновик. Некорректный saved → defaults + пояснение.
- [ ] Не копировать весь user_metadata; вызывать callback с одним сценарием и version 1. Пока сохранение идёт, редактирование допустимо, второй save запрещён. Не сохранять математически недостижимый/невалидный сценарий.
- [ ] Прогнать покрывающие тесты и зафиксировать контроллер.

## Task 3: UI, FAQ, приёмка

**Files:** index.html, styles/themes.css, js/faq-content.js, sw.js, tests/service-worker.test.mjs, tests/theme-bootstrap.test.mjs.

- [ ] Сначала тесты app-интеграции: загрузка ключа аккаунта, обновление только finora_capital_plan, reset при смене владельца, отсутствие затирания USER_UPDATED. В VM harness подключить реальный модуль и минимальную DOM-фикстуру либо тестировать boundary callback отдельно, сохранив существующий harness.
- [ ] Подключить core и UI; добавить блок ниже существующих калькуляторов. Видимые label, сообщения ошибок с aria-describedby, результаты с явной датировкой сумм. Верх: два режима; слева цель/капитал и инфляция, справа накопление для целевого режима. Расширенные параметры — details с переключателем сохранения покупательной способности.
- [ ] Пустой результат показывает, какие поля нужно заполнить, а не нулевые финансовые итоги. До первого взаимодействия ошибки не окрашивать. Неверные поля отмечать после ввода/попытки сохранить. Суммы форматировать Intl.NumberFormat('ru-RU'), капитал и взнос Math.ceil.
- [ ] Подключить callback к savePlanningProfile('finora_capital_plan', payload), перед сохранением проверить context. Загружать при смене auth identity; не выполнять автосохранение при входе. На sign-out сбрасывать состояние. Не менять существующие обработчики расчётов.
- [ ] «Как считается» вызывает FAQ calc, не showPage и не сбрасывает формы. Дополнить FAQ формулами, допущениями, сохранением и границами CSV.
- [ ] Добавить новые JS в ASSETS и поднять кеш v8. Актуализировать тест obsolete caches.
- [ ] Прогнать полный набор node --test tests/*.test.mjs, синтаксис модулей и inline scripts, git diff --check.
- [ ] Локальный синтетический аккаунт: оба режима, сохранение и повторная загрузка, ошибки, Classic/Pixel, узкий и настольный экраны, FAQ без потери ввода. Скриншоты только синтетические.
- [ ] Детектор интерфейса один раз, исправления одним проходом, повторная проверка затронутого. Финальный обзор диффа и отчёт с фактическими границами проверки; локальный коммит, без публикации.
