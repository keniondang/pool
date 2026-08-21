// Shared mutable app state.
// Modules import S and mutate its fields, so live bindings work across modules.
export const S = {
  config: null,
  meta: null,
  months: {},
  monthStates: {},
  screen: 'today',
  viewMonth: null,
  selDay: null,
  curDay: null,
  selCat: 'foods',
  wiz: { step:1, year:2026, month:null, draft:null }
};
