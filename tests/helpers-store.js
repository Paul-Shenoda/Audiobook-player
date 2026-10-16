import { vi } from 'vitest';
import { createPlayerStore } from '../js/services/player-store.js';

/** A real store around a fake engine the test can drive with `emit`. */
export function makeStore() {
  let emit;
  const engine = {
    load: vi.fn((book, e) => {
      emit = e;
    }),
    play: vi.fn(),
    pause: vi.fn(),
    setRate: vi.fn(),
    skip: vi.fn(),
    goToChapter: vi.fn(),
    seekInChapter: vi.fn(),
    setSleep: vi.fn(),
    destroy: vi.fn(),
  };
  const store = createPlayerStore({ createEngine: () => engine });
  return { store, engine, emit: partial => emit(partial) };
}
