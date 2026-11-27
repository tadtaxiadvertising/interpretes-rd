export const STUDIO_HISTORY_LIMIT = 20;
export type StudioHistory<T> = { past: T[]; future: T[] };
export const emptyStudioHistory = <T>(): StudioHistory<T> => ({past:[],future:[]});
export function rememberStudioEdit<T>(history: StudioHistory<T>, before: T): StudioHistory<T> {
  return {past:[...history.past,before].slice(-STUDIO_HISTORY_LIMIT),future:[]};
}
export function stepStudioHistory<T>(history: StudioHistory<T>, current: T, direction: 'undo'|'redo'): StudioHistory<T> {
  if (direction==='undo') return history.past.length ? {
    past:history.past.slice(0,-1),future:[...history.future,current].slice(-STUDIO_HISTORY_LIMIT),
  } : history;
  return history.future.length ? {
    past:[...history.past,current].slice(-STUDIO_HISTORY_LIMIT),future:history.future.slice(0,-1),
  } : history;
}
export function mapStudioHistory<T>(history: StudioHistory<T>, map:(value:T)=>T): StudioHistory<T> {
  return {past:history.past.map(map),future:history.future.map(map)};
}
