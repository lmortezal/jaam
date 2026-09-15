export const NODE = {
  width: 240,
  height: 132,
  icon: 18,
  labelWidth: 208,
  fontSize: 12,
};
export function shortLabel(value: string, limit = 31) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
