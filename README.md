# lego-f1-loading

> Lego bricks scatter, snap into an F1 car, and drive off — a loading animation with `start()` / `complete()` / `reset()` / `destroy()`. Zero dependencies.

[![npm version](https://img.shields.io/npm/v/lego-f1-loading)](https://www.npmjs.com/package/lego-f1-loading)
[![npm downloads](https://img.shields.io/npm/dm/lego-f1-loading)](https://www.npmjs.com/package/lego-f1-loading)
[![bundle size](https://img.shields.io/bundlephobia/minzip/lego-f1-loading)](https://bundlephobia.com/package/lego-f1-loading)
[![license](https://img.shields.io/github/license/everything-frontend/lego-f1-loading)](https://github.com/everything-frontend/lego-f1-loading/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/types-included-blue)](https://www.npmjs.com/package/lego-f1-loading)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/lego-f1-loading)

**[Live Demo →](https://www.efjs.dev/lego-f1-loading)**

---

## Install

```bash
npm install lego-f1-loading
```

---

## Quick start

```ts
import legoF1 from 'lego-f1-loading';

const el = document.getElementById('loader')!;
const loader = legoF1(el, {
  scale: 1.2,
  color: '#e8651a',
  text: [
    'Bricks on the floor…',
    'Snapping chassis…',
    'Attaching wheels…',
    'Adding rear wing…',
    'Built — launching!',
  ],
  textInterval: 1500,
});

loader.start();
// later: loader.complete(), loader.reset(), or loader.destroy();
```

---

## API

### `legoF1(container, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scale` | `number` | `1` | Visual scale multiplier (e.g. `0.75`, `1.5`) |
| `color` | `string` | `#e8651a` | Brick accent color |
| `baseColor` | `string` | `#1a1a1a` | Base/shadow brick color |
| `backgroundColor` | `string` | `#f4f6f9` | Scene background (canvas gradient + surface behind it); hex. |
| `text` | `string \| string[]` | `Bricks ready…` | Subtitle under the scene. Array: first = idle/start, middle cycle during assembly, last on complete. |
| `textInterval` | `number` | `2000` | Interval in ms for cycling middle text entries. |

Returns `{ start, complete, reset, setScale, setBackgroundColor, destroy }`.

- **`start()`** — bricks fly together and assemble into an F1 car.
- **`complete()`** — car drives off to the right.
- **`reset()`** — returns to idle (bricks scattered).
- **`setScale(n)`** — resize the scene; updates canvas backing store.
- **`setBackgroundColor(hex)`** — change scene background (same as `backgroundColor` option).
- **`destroy()`** — removes mounted nodes from the container.

---

**Bundle size:** ~2 kB minified + gzip (see [bundlephobia](https://bundlephobia.com/package/lego-f1-loading)).

## License

[MIT](./LICENSE) © [Everything Frontend](https://github.com/everything-frontend)
