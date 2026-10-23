import './styles/main.css';
import { Game } from './core/Game';

(window as unknown as { __avStarted: boolean }).__avStarted = true;

const game = new Game();
(window as unknown as { game: Game }).game = game;
// Wait for display fonts so canvas-drawn sponsor decals use the condensed typeface.
const fontsReady = document.fonts?.ready ?? Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => game.start());
