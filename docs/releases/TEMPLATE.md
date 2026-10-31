# 发布说明模板

中文在前，英文在后，两段讲同一件事。每节 1–3 行，只写"对用户意味着什么"；不列 commit，不复述代码。

## 这版做了什么

- 一两句用户看得见的结果，说人话。

## 怎么做到的

- 最多三条，按能力分组（`search` / `scopes` / `engines` / `limits` / `page`），不按文件。

## 升级

```sh
dsh plugin --profile <profile> add @fishdivinity/dsh-local-search
```

## 兼容

- DSH 版本范围；Windows 前提；引擎前提有无变化；配置键有没有迁移。

## 完整变更

[CHANGELOG.md](../../CHANGELOG.md)

---

## What changed

- The same one or two user-visible outcomes, in plain English.

## How

- Same grouping, at most three lines.

## Upgrade

```sh
dsh plugin --profile <profile> add @fishdivinity/dsh-local-search
```

## Compatibility

- DSH range, Windows requirement, any engine or config-key change.

## Full changelog

[CHANGELOG.en.md](../../CHANGELOG.en.md)

---
 
注意：
- 正文是摘要（3–5 行，用户感知到什么），`CHANGELOG.md` 是一行一条的全量清单（含文档与 CI）。别把同一批要点在两处写两遍——那样读者点进去没有新信息。
- 两半各链自己的 changelog：中文链 `CHANGELOG.md`，英文链 `CHANGELOG.en.md`；少写一个，读者就会点进另一种语言。
- 写相对路径，发布工作流会在发布前展开成 `https://github.com/<owner>/<repo>/blob/<tag>/<path>`——Release 页没有文件路径做基准，相对链接在那儿会 404。**不要手写 `blob/main`**：main 上的 CHANGELOG 会裁切，老读者点进去就看不到自己那一版（发布脚本会拦）。
