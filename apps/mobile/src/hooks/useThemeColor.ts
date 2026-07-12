import { Colors } from '../constants/theme';
import { useAppearance } from '../context/AppearanceContext';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const { resolvedAppearance: scheme } = useAppearance();
  const colorFromProps = props[scheme];

  if (colorFromProps) {
    return colorFromProps;
  }
  return Colors[scheme][colorName];
}
