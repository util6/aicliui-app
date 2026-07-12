import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppearance, type AppearancePreference } from '../../context/AppearanceContext';
import {
  changeLanguage,
  getLanguagePreference,
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
} from '../../i18n';
import { useThemeColor } from '../../hooks/useThemeColor';
import { ThemedText } from '../ui/ThemedText';

type PreferenceSheet = 'appearance' | 'language' | null;

const APPEARANCE_PREFERENCES: AppearancePreference[] = ['system', 'light', 'dark'];

export function PreferenceSettingsCard() {
  const { t } = useTranslation();
  const { preference: appearancePreference, setPreference: setAppearancePreference } = useAppearance();
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>('system');
  const [activeSheet, setActiveSheet] = useState<PreferenceSheet>(null);
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const textSecondary = useThemeColor({}, 'textSecondary');

  useEffect(() => {
    let active = true;
    getLanguagePreference().then((preference) => {
      if (active) setLanguagePreference(preference);
    });
    return () => {
      active = false;
    };
  }, []);

  const selectAppearance = async (preference: AppearancePreference) => {
    await setAppearancePreference(preference);
    setActiveSheet(null);
  };

  const selectLanguage = async (preference: LanguagePreference) => {
    setLanguagePreference(preference);
    await changeLanguage(preference);
    setActiveSheet(null);
  };

  return (
    <View style={styles.section}>
      <ThemedText type='caption' style={styles.sectionTitle}>
        {t('settings.preferences').toUpperCase()}
      </ThemedText>
      <View style={[styles.card, { backgroundColor: surface }]}>
        <PreferenceRow
          testID='appearance-setting'
          icon='contrast-outline'
          label={t('settings.appearance')}
          value={appearanceLabel(appearancePreference, t)}
          borderColor={border}
          textSecondary={textSecondary}
          onPress={() => setActiveSheet('appearance')}
        />
        <PreferenceRow
          testID='language-setting'
          icon='language-outline'
          label={t('settings.language')}
          value={languageLabel(languagePreference, t)}
          borderColor='transparent'
          textSecondary={textSecondary}
          onPress={() => setActiveSheet('language')}
        />
      </View>

      <SelectionSheet
        visible={activeSheet === 'appearance'}
        title={t('settings.appearance')}
        closeLabel={t('common.close')}
        options={APPEARANCE_PREFERENCES}
        selected={appearancePreference}
        label={(preference) => appearanceLabel(preference, t)}
        testIDPrefix='preference-appearance'
        surface={surface}
        border={border}
        tint={tint}
        textSecondary={textSecondary}
        onSelect={selectAppearance}
        onClose={() => setActiveSheet(null)}
      />
      <SelectionSheet
        visible={activeSheet === 'language'}
        title={t('settings.language')}
        closeLabel={t('common.close')}
        options={[...LANGUAGE_PREFERENCES]}
        selected={languagePreference}
        label={(preference) => languageLabel(preference, t)}
        testIDPrefix='preference-language'
        surface={surface}
        border={border}
        tint={tint}
        textSecondary={textSecondary}
        onSelect={selectLanguage}
        onClose={() => setActiveSheet(null)}
      />
    </View>
  );
}

type PreferenceRowProps = {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  borderColor: string;
  textSecondary: string;
  onPress: () => void;
};

function PreferenceRow({ testID, icon, label, value, borderColor, textSecondary, onPress }: PreferenceRowProps) {
  return (
    <TouchableOpacity
      accessibilityRole='button'
      accessibilityLabel={label}
      testID={testID}
      style={[styles.row, { borderBottomColor: borderColor }]}
      onPress={onPress}
      activeOpacity={0.72}
    >
      <Ionicons name={icon} size={20} color={textSecondary} />
      <View style={styles.rowText}>
        <ThemedText>{label}</ThemedText>
        <ThemedText type='caption' style={{ color: textSecondary }}>
          {value}
        </ThemedText>
      </View>
      <Ionicons name='chevron-forward-outline' size={18} color={textSecondary} />
    </TouchableOpacity>
  );
}

type SelectionSheetProps<T extends string> = {
  visible: boolean;
  title: string;
  closeLabel: string;
  options: T[];
  selected: T;
  label: (option: T) => string;
  testIDPrefix: string;
  surface: string;
  border: string;
  tint: string;
  textSecondary: string;
  onSelect: (option: T) => Promise<void>;
  onClose: () => void;
};

function SelectionSheet<T extends string>({
  visible,
  title,
  closeLabel,
  options,
  selected,
  label,
  testIDPrefix,
  surface,
  border,
  tint,
  textSecondary,
  onSelect,
  onClose,
}: SelectionSheetProps<T>) {
  return (
    <Modal visible={visible} animationType='slide' transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: surface }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: border }]}>
            <ThemedText style={styles.sheetTitle}>{title}</ThemedText>
            <TouchableOpacity
              accessibilityRole='button'
              accessibilityLabel={closeLabel}
              style={styles.closeButton}
              onPress={onClose}
            >
              <Ionicons name='close-outline' size={24} color={textSecondary} />
            </TouchableOpacity>
          </View>
          {options.map((option, index) => (
            <TouchableOpacity
              accessibilityRole='radio'
              accessibilityState={{ checked: option === selected }}
              testID={`${testIDPrefix}-${option}`}
              key={option}
              style={[
                styles.option,
                index < options.length - 1 && { borderBottomColor: border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              onPress={() => void onSelect(option)}
              activeOpacity={0.72}
            >
              <ThemedText style={styles.optionLabel}>{label(option)}</ThemedText>
              {option === selected && <Ionicons name='checkmark-outline' size={22} color={tint} />}
            </TouchableOpacity>
          ))}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function appearanceLabel(
  preference: AppearancePreference,
  t: (key: string) => string,
): string {
  return t(`settings.appearance${capitalize(preference)}`);
}

function languageLabel(preference: LanguagePreference, t: (key: string) => string): string {
  const keyByPreference: Record<LanguagePreference, string> = {
    system: 'settings.languageSystem',
    'en-US': 'settings.languageEnglish',
    'zh-CN': 'settings.languageChinese',
    'de-DE': 'settings.languageGerman',
    'ru-RU': 'settings.languageRussian',
    'uk-UA': 'settings.languageUkrainian',
  };
  return t(keyByPreference[preference]);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: {
    paddingHorizontal: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  optionLabel: {
    flex: 1,
  },
});
