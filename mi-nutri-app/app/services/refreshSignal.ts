// Señal de actualización de meals entre add-food e index.
// Usa callbacks síncronos a nivel módulo para evitar depender de
// eventos de navegación o focus, que son poco fiables en la web.

type UpdatePayload = { meals: any; dateKey: string; ts: number };
type Listener = (payload: UpdatePayload) => void;

// TTL: entregamos _pending solo si tiene menos de 15 segundos.
// Esto evita que React Strict Mode (doble montaje) consuma el pending
// en la primera pasada dejando la segunda sin datos.
const PENDING_TTL = 15_000;

let _pending: UpdatePayload | null = null;
const _listeners = new Set<Listener>();

/** Llámalo desde add-food justo después de guardar en AsyncStorage. */
export function signalMealSaved(meals: any, dateKey: string) {
  _pending = { meals, dateKey, ts: Date.now() };
  _listeners.forEach(fn => fn(_pending!));
}

/**
 * Index llama esto en useEffect([]).
 * Si ya había un pending reciente (index estaba desmontado cuando se guardó,
 * o React Strict Mode desmontó/remontó el efecto), el callback se ejecuta
 * inmediatamente con ese dato. NO limpiamos _pending aquí para que el segundo
 * montaje de Strict Mode también lo reciba.
 */
export function subscribeMealUpdates(fn: Listener): () => void {
  _listeners.add(fn);
  if (_pending && Date.now() - _pending.ts < PENDING_TTL) {
    fn(_pending);
    // Intencionalmente NO limpiamos _pending para que Strict Mode
    // (doble-montaje) también pueda entregarlo en la segunda pasada.
  }
  return () => _listeners.delete(fn);
}

/** Limpia el pending manualmente (p.ej. cuando el usuario ya vio los datos). */
export function clearPendingMealSignal() {
  _pending = null;
}
