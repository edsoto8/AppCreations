import type { ThreeEvent } from '@react-three/fiber';
import type { EntityRef } from '../../simulation/types';
import { useUi } from '../../store';

/** Pointer handlers that make an object hoverable (tooltip) and selectable. */
export function pickHandlers(ref: EntityRef | (() => EntityRef | null), label: string | (() => string)) {
  const resolve = () => (typeof ref === 'function' ? ref() : ref);
  const text = () => (typeof label === 'function' ? label() : label);
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const r = resolve();
      if (!r) return;
      document.body.style.cursor = 'pointer';
      useUi.getState().setHover({ ref: r, label: text(), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const h = useUi.getState().hover;
      const r = resolve();
      if (!r) return;
      if (!h || Math.abs(h.x - e.nativeEvent.clientX) + Math.abs(h.y - e.nativeEvent.clientY) > 6 || h.ref.id !== r.id) {
        useUi.getState().setHover({ ref: r, label: text(), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
      }
    },
    onPointerOut: () => {
      document.body.style.cursor = '';
      useUi.getState().setHover(null);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const r = resolve();
      if (r) useUi.getState().select(r);
    },
  };
}
